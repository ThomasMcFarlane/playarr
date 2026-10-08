/**
 * Pure helpers for unified discovery and the watchlist. The server computes
 * identity, source attribution and the action list (see
 * docs/architecture/discovery-watchlist.md); the client only maps those onto
 * routes, labels and a primary action so every surface behaves the same.
 */
import type { TranslationKey } from "./i18n/translations";
import { releaseYear } from "./workYear";
import type {
  DiscoveryKind,
  DiscoveryTitle,
  ExternalRef,
  TitleAction,
  TitleSnapshot,
  TitleSource,
  Work,
} from "@playarr-tv/api-client";

export type ActionKind = TitleAction["action"];

/** Highest priority first: resuming beats starting over, requesting beats recording. */
const ACTION_PRIORITY: readonly ActionKind[] = ["resume", "play", "request", "launch", "record"];

export function primaryAction(actions: readonly TitleAction[]): TitleAction | null {
  for (const kind of ACTION_PRIORITY) {
    const match = actions.find((action) => action.action === kind && action.enabled);
    if (match) return match;
  }
  return null;
}

/**
 * Disabled actions worth explaining (those with a reason), in priority order. Record is never explained: live TV
 * recording is not a product surface yet, and its server reason is developer text, not something to show a viewer.
 */
export function explainedDisabledActions(actions: readonly TitleAction[]): TitleAction[] {
  return ACTION_PRIORITY.filter((kind) => kind !== "record").flatMap((kind) =>
    actions.filter((action) => action.action === kind && !action.enabled && action.reason)
  );
}

/**
 * A server that predates discovery answers these routes with its web app's HTML,
 * which fails JSON parsing, or with a 404/405.
 */
export function discoveryUnsupportedByServer(error: unknown): boolean {
  if (error instanceof SyntaxError) return true;
  const status = (error as { status?: unknown } | null)?.status;
  return status === 404 || status === 405;
}

export function snapshotFromTitle(title: DiscoveryTitle): TitleSnapshot {
  const library = title.sources.find((source) => source.source === "library" && source.work_id);
  return {
    kind: title.kind,
    title: title.title,
    year: title.year ?? null,
    work_id: library?.work_id ?? null,
    external_refs: title.external_refs as ExternalRef[],
    poster_url: title.poster_url ?? null,
  };
}

function discoveryKindForWork(kind: Work["kind"]): DiscoveryKind {
  return kind;
}

export function snapshotFromWork(work: Work): TitleSnapshot {
  const poster = work.images.find((image) => image.kind === "poster");
  return {
    kind: discoveryKindForWork(work.kind),
    title: work.title,
    year: releaseYear(work),
    work_id: work.id,
    external_refs: work.external_refs,
    poster_url: poster?.url ?? null,
  };
}

/** Route of the local detail page for a library work, if the title has one. */
export function libraryDetailRoute(title: Pick<DiscoveryTitle, "kind" | "sources">): string | null {
  const workId = title.sources.find((source) => source.source === "library" && source.work_id)?.work_id;
  if (!workId) return null;
  switch (title.kind) {
    case "movie":
      return `/movies/${workId}`;
    case "series":
      return `/series/${workId}`;
    case "site":
      return `/sites/${workId}`;
    case "artist":
      return `/music/${workId}`;
    default:
      return null;
  }
}

/**
 * Titles worth showing beyond the local library results: anything with a
 * non-library source, or (for the games filter) every game.
 */
export function extraTitles<T extends DiscoveryTitle>(titles: readonly T[]): T[] {
  return titles.filter(
    (title) => title.kind === "game" || title.sources.some((source) => source.source !== "library")
  );
}

const SOURCE_KEYS: Record<TitleSource["source"], TranslationKey> = {
  library: "discovery.source.library",
  peer: "discovery.source.peer",
  request: "discovery.source.request",
  live_tv: "discovery.source.live_tv",
  game: "discovery.source.game",
};

const ACTION_KEYS: Record<ActionKind, TranslationKey> = {
  play: "discovery.action.play",
  resume: "discovery.action.resume",
  request: "discovery.action.request",
  record: "discovery.action.record",
  launch: "discovery.action.launch",
};

export function sourceChipKey(source: TitleSource["source"]): TranslationKey {
  return SOURCE_KEYS[source];
}

export function actionLabelKey(action: ActionKind): TranslationKey {
  return ACTION_KEYS[action];
}

export function uniqueSourceKinds(sources: readonly TitleSource[]): TitleSource["source"][] {
  const seen: TitleSource["source"][] = [];
  for (const source of sources) {
    if (!seen.includes(source.source)) seen.push(source.source);
  }
  return seen;
}

/** Player route state for a play/resume action; null when the action has no file to open. */
export function playerTargetFor(action: TitleAction): string | null {
  return action.enabled && action.media_file_id ? `/player/${action.media_file_id}` : null;
}
