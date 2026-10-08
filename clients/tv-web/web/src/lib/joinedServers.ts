import { QueryCache } from "@playarr-tv/api-client";
import type {
  AccessTokenRequest,
  ApiClient,
  BrowseCatalogParams,
  LanguageFacetEntry,
  CatalogPage,
  Work,
  WorkDetail,
} from "@playarr-tv/api-client";

export interface ConnectedServerClient {
  url: string;
  label: string;
  client: ApiClient;
  getAccessToken: (request?: AccessTokenRequest) => Promise<string | undefined>;
}

export interface JoinedWorkSource extends ConnectedServerClient {
  work: Work;
}

const sourcesByWorkId = new Map<string, JoinedWorkSource[]>();
const serverByMediaFileId = new Map<string, ConnectedServerClient>();

export function clearJoinedServerRegistry(): void {
  sourcesByWorkId.clear();
  serverByMediaFileId.clear();
}

function registerDetailMedia(server: ConnectedServerClient, detail: WorkDetail): void {
  if (detail.media_file_id) serverByMediaFileId.set(detail.media_file_id, server);
  if (typeof detail.children !== "object") return;
  const children = "Series" in detail.children
    ? detail.children.Series.flatMap((season) => season.episodes)
    : "Artist" in detail.children
      ? detail.children.Artist.flatMap((album) => album.tracks)
      : "Author" in detail.children
        ? detail.children.Author.flatMap((book) => [book])
        : [];
  for (const child of children) {
    if (child.media_file_id) serverByMediaFileId.set(child.media_file_id, server);
  }
}

function providerKey(provider: Work["external_refs"][number]["provider"]): string {
  return typeof provider === "string" ? provider : `other:${provider.other}`;
}

function fallbackIdentity(work: Work): string {
  const title = work.title.normalize("NFKC").trim().toLocaleLowerCase();
  const year = work.release_date?.slice(0, 4) ?? "";
  return `fallback:${work.kind}:${title}:${year}`;
}

export function workIdentityKeys(work: Work): string[] {
  const externalKeys = work.external_refs.map(
    (reference) =>
      `external:${providerKey(reference.provider)}:${reference.external_id.trim().toLocaleLowerCase()}`
  );
  return externalKeys.length > 0 ? externalKeys : [fallbackIdentity(work)];
}

function registerSources(sources: JoinedWorkSource[]): Work {
  const representative = sources[0]!.work;
  for (const source of sources) {
    sourcesByWorkId.set(source.work.id, sources);
  }
  sourcesByWorkId.set(representative.id, sources);
  return representative;
}

export function joinServerWorks(
  rows: ReadonlyArray<{ server: ConnectedServerClient; works: Work[] }>
): Work[] {
  const groups: JoinedWorkSource[][] = [];
  const groupByIdentity = new Map<string, JoinedWorkSource[]>();

  for (const { server, works } of rows) {
    for (const work of works) {
      const keys = workIdentityKeys(work);
      const matching = [
        ...new Set(
          keys.flatMap((key) => {
            const group = groupByIdentity.get(key);
            return group ? [group] : [];
          })
        ),
      ];
      const source: JoinedWorkSource = { ...server, work };
      let group = matching[0];
      if (!group) {
        group = [source];
        groups.push(group);
      } else {
        if (!group.some((member) => member.url === server.url)) group.push(source);
        for (const merged of matching.slice(1)) {
          if (merged === group) continue;
          group.push(...merged);
          groups.splice(groups.indexOf(merged), 1);
        }
      }
      for (const member of group) {
        for (const key of workIdentityKeys(member.work)) groupByIdentity.set(key, group);
      }
    }
  }

  return groups.map(registerSources);
}

export function getJoinedWorkSources(workId: string): JoinedWorkSource[] {
  return sourcesByWorkId.get(workId) ?? [];
}

function successfulValues<T>(results: PromiseSettledResult<T>[]): T[] {
  const values = results.flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : []
  );
  if (values.length === 0) {
    const failure = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected"
    );
    throw failure?.reason ?? new Error("No connected server returned a response.");
  }
  return values;
}

async function discoverSources(
  servers: ConnectedServerClient[],
  workId: string
): Promise<{ detail: WorkDetail; sources: JoinedWorkSource[] }> {
  const known = getJoinedWorkSources(workId);
  if (known.length > 0) {
    const detail = await known[0]!.client.getWork(known[0]!.work.id);
    registerDetailMedia(known[0]!, detail);
    return { detail, sources: known };
  }

  const details = successfulValues(
    await Promise.allSettled(
      servers.map(async (server) => ({ server, detail: await server.client.getWork(workId) }))
    )
  );
  const first = details[0]!;
  registerDetailMedia(first.server, first.detail);
  const candidates = await Promise.allSettled(
    servers.map(async (server) => ({
      server,
      works: await server.client.searchCatalog(first.detail.work.title, 50),
    }))
  );
  const targetKeys = new Set(workIdentityKeys(first.detail.work));
  const candidateValues = candidates.flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : []
  );
  const matching = candidateValues.flatMap(({ server, works }) =>
    works
      .filter((work) => workIdentityKeys(work).some((key) => targetKeys.has(key)))
      .map((work) => ({ ...server, work }))
  );
  const firstSource = { ...first.server, work: first.detail.work };
  const sources = [
    ...new Map(
      [firstSource, ...matching].map((source) => [source.url, source])
    ).values(),
  ];
  registerSources(sources);
  return { detail: first.detail, sources };
}

export function createJoinedApiClient(servers: ConnectedServerClient[]): ApiClient {
  const primary = servers[0]?.client;
  if (!primary) throw new Error("A joined client requires at least one server.");
  if (servers.length === 1) return primary;

  const joined = Object.create(primary) as ApiClient;
  // A joined client merges several servers: nothing it returns may be cached under one account scope.
  (joined as { queries: QueryCache }).queries = new QueryCache();
  joined.browseCatalog = async (params: BrowseCatalogParams = {}): Promise<CatalogPage> => {
    const offset = params.offset ?? 0;
    const limit = params.limit ?? 50;
    const pages = successfulValues(
      await Promise.allSettled(
        servers.map(async (server) => ({
          server,
          page: await server.client.browseCatalog({
            ...params,
            offset: 0,
            limit: offset + limit,
          }),
        }))
      )
    );
    const joinedItems = joinServerWorks(
      pages.map(({ server, page }) => ({ server, works: page.items }))
    ).sort((left, right) => {
      const sort = params.sort ?? "title";
      const leftValue = sort === "date_added" || sort === "recent"
        ? left.added_at
        : left.sort_title;
      const rightValue = sort === "date_added" || sort === "recent"
        ? right.added_at
        : right.sort_title;
      const comparison = leftValue.localeCompare(rightValue);
      const descending =
        params.order === "desc" ||
        (params.order !== "asc" && (sort === "date_added" || sort === "recent"));
      return descending ? -comparison : comparison;
    });
    return {
      items: joinedItems.slice(offset, offset + limit),
      total: pages.reduce(
        (total, { page }) => total + (page.total ?? page.items.length),
        0
      ),
    };
  };
  joined.catalogLanguages = async (params: BrowseCatalogParams = {}) => {
    const results = successfulValues(
      await Promise.allSettled(servers.map((server) => server.client.catalogLanguages(params)))
    );
    const merge = (lists: LanguageFacetEntry[][]): LanguageFacetEntry[] => {
      const byCode = new Map<string, LanguageFacetEntry>();
      for (const entry of lists.flat()) {
        const existing = byCode.get(entry.code);
        byCode.set(entry.code, existing ? { ...existing, count: existing.count + entry.count } : entry);
      }
      return [...byCode.values()].sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
    };
    return {
      audio: merge(results.map((r) => r.audio)),
      subtitle: merge(results.map((r) => r.subtitle)),
    };
  };
  joined.searchCatalog = async (query: string, limit = 50, options): Promise<Work[]> => {
    const results = successfulValues(
      await Promise.allSettled(
        servers.map(async (server) => ({
          server,
          works: await server.client.searchCatalog(query, limit, options),
        }))
      )
    );
    return joinServerWorks(results).slice(0, limit);
  };
  joined.getWork = async (workId: string): Promise<WorkDetail> =>
    (await discoverSources(servers, workId)).detail;
  joined.listCatalogKinds = async () => [
    ...new Set(
      successfulValues(
        await Promise.allSettled(
          servers.map((server) => server.client.listCatalogKinds())
        )
      ).flat()
    ),
  ];
  joined.getWorkCredits = async (workId) => {
    const source = getJoinedWorkSources(workId)[0];
    return (source?.client ?? primary).getWorkCredits(source?.work.id ?? workId);
  };
  joined.getSimilarWorks = async (workId, limit) => {
    const source = getJoinedWorkSources(workId)[0];
    const works = await (source?.client ?? primary).getSimilarWorks(
      source?.work.id ?? workId,
      limit
    );
    return source ? joinServerWorks([{ server: source, works }]) : works;
  };
  joined.getWorkArtwork = async (workId, kind, size) => {
    const source = getJoinedWorkSources(workId)[0];
    return (source?.client ?? primary).getWorkArtwork(source?.work.id ?? workId, kind, size);
  };
  joined.getAlbumArtwork = async (workId, albumId, kind, size) => {
    const source = getJoinedWorkSources(workId)[0];
    return (source?.client ?? primary).getAlbumArtwork(
      source?.work.id ?? workId,
      albumId,
      kind,
      size
    );
  };
  joined.getMediaChapters = async (mediaFileId) =>
    (serverByMediaFileId.get(mediaFileId)?.client ?? primary).getMediaChapters(
      mediaFileId
    );
  joined.getMediaMetadata = async (mediaFileId) =>
    (serverByMediaFileId.get(mediaFileId)?.client ?? primary).getMediaMetadata(
      mediaFileId
    );
  joined.getMediaPlaybackOptions = async (mediaFileId) =>
    (serverByMediaFileId.get(mediaFileId)?.client ?? primary).getMediaPlaybackOptions(
      mediaFileId
    );
  joined.updateMediaPlaybackOptions = async (mediaFileId, body) =>
    (serverByMediaFileId.get(mediaFileId)?.client ?? primary).updateMediaPlaybackOptions(
      mediaFileId,
      body
    );
  joined.getMediaThumbnail = async (mediaFileId, positionMs) =>
    (serverByMediaFileId.get(mediaFileId)?.client ?? primary).getMediaThumbnail(
      mediaFileId,
      positionMs
    );
  joined.getWatchProgress = async (mediaFileId) =>
    (serverByMediaFileId.get(mediaFileId)?.client ?? primary).getWatchProgress(mediaFileId);
  joined.updateWatchProgress = async (mediaFileId, update) =>
    (serverByMediaFileId.get(mediaFileId)?.client ?? primary).updateWatchProgress(
      mediaFileId,
      update
    );
  joined.listWatchProgress = async () =>
    successfulValues(
      await Promise.allSettled(servers.map((server) => server.client.listWatchProgress()))
    ).flat();
  return joined;
}
