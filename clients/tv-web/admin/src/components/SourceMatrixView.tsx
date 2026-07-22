import { useMemo, useState } from "react";
import type {
  SourceInstanceResponse,
  SourceMatrixFile,
  SourceMatrixResponse,
  Work,
  WorkDetail,
} from "@streamarr-tv/api-client";
import { describeApiError } from "@streamarr-tv/api-client";
import { useApiClient } from "../lib/ApiClientProvider";
import { KIND_LABELS } from "./PosterCard";

type MatrixSort = "source" | "type" | "folder";

interface MatrixRow {
  key: string;
  label: string;
  level: number;
  files: SourceMatrixFile[];
  expandable?: boolean;
  work?: Work;
  children?: MatrixRow[];
}

function detailRows(detail: WorkDetail, files: SourceMatrixFile[], level: number): MatrixRow[] {
  const children = detail.children;
  if (children === "Movie") return [];
  if ("Series" in children) {
    return children.Series.map(({ season, episodes }) => {
      const episodeRows = episodes.map(({ episode }) => ({
        key: `episode:${episode.id}`,
        label: `E${String(episode.episode_number).padStart(2, "0")} ${episode.title ?? "Untitled episode"}`,
        level: level + 1,
        files: files.filter((file) => typeof file.leaf_selector === "object" && "episode" in file.leaf_selector
          && file.leaf_selector.episode.season === season.season_number
          && file.leaf_selector.episode.episode === episode.episode_number),
      }));
      return {
        key: `season:${season.id}`,
        label: season.title ?? `Season ${season.season_number}`,
        level,
        files: episodeRows.flatMap((row) => row.files),
        expandable: episodeRows.length > 0,
        children: episodeRows,
      };
    });
  }
  if ("Artist" in children) {
    return children.Artist.map(({ album, tracks }) => {
      const trackRows = tracks.map(({ track }) => ({
        key: `track:${track.id}`,
        label: `${track.disc_number}.${String(track.track_number).padStart(2, "0")} ${track.title}`,
        level: level + 1,
        files: files.filter((file) => typeof file.leaf_selector === "object" && "track" in file.leaf_selector
          && file.leaf_selector.track.disc === track.disc_number
          && file.leaf_selector.track.track === track.track_number),
      }));
      return {
        key: `album:${album.id}`,
        label: album.title,
        level,
        files: trackRows.flatMap((row) => row.files),
        expandable: trackRows.length > 0,
        children: trackRows,
      };
    });
  }
  return children.Author.map(({ book }, index) => ({
    key: `book:${book.id}`,
    label: book.title,
    level,
    files: files.filter((file) => typeof file.leaf_selector === "object" && "book" in file.leaf_selector
      && file.leaf_selector.book.index === index),
  }));
}

function workRows(
  works: Work[],
  filesByWork: Map<string, SourceMatrixFile[]>,
  details: Record<string, WorkDetail>,
  level: number,
  keyPrefix: string,
): MatrixRow[] {
  return works.map((work) => {
    const files = filesByWork.get(work.id) ?? [];
    const detail = details[work.id];
    return {
      key: `${keyPrefix}:work:${work.id}`,
      label: work.title,
      level,
      files,
      work,
      expandable: work.kind !== "movie",
      children: detail ? detailRows(detail, files, level + 1) : undefined,
    };
  });
}

const WORK_KINDS = ["movie", "series", "site", "artist", "author"] as const;

function typeRows(
  items: Work[],
  filesByWork: Map<string, SourceMatrixFile[]>,
  details: Record<string, WorkDetail>,
  level = 0,
  keyPrefix = "type",
): MatrixRow[] {
  return WORK_KINDS.flatMap((kind) => {
    const works = items.filter((work) => work.kind === kind);
    if (works.length === 0) return [];
    const children = workRows(works, filesByWork, details, level + 1, `${keyPrefix}:${kind}`);
    return [{
      key: `${keyPrefix}:kind:${kind}`,
      label: KIND_LABELS[kind],
      level,
      files: children.flatMap((row) => row.files),
      expandable: true,
      children,
    }];
  });
}

function sourceRows(
  items: Work[],
  files: SourceMatrixFile[],
  sources: SourceInstanceResponse[],
  details: Record<string, WorkDetail>,
): MatrixRow[] {
  return sources.flatMap((source) => {
    const sourceFiles = files.filter((file) => file.source_instance_id === source.id);
    if (sourceFiles.length === 0) return [];
    const filesByWork = new Map<string, SourceMatrixFile[]>();
    for (const file of sourceFiles) {
      const workFiles = filesByWork.get(file.work_id) ?? [];
      workFiles.push(file);
      filesByWork.set(file.work_id, workFiles);
    }
    const sourceItems = items.filter((work) => filesByWork.has(work.id));
    const children = typeRows(sourceItems, filesByWork, details, 1, `source:${source.id}`);
    return [{
      key: `source:${source.id}`,
      label: source.name,
      level: 0,
      files: sourceFiles,
      expandable: true,
      children,
    }];
  });
}

function relativeSourcePath(file: SourceMatrixFile, source: SourceInstanceResponse): string {
  const path = file.path.replaceAll("\\", "/");
  const root = source.default_root_folder_id?.replaceAll("\\", "/").replace(/\/$/, "");
  if (!root) return path.replace(/^\//, "");
  if (path === root) return "";
  return path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path.replace(/^\//, "");
}

function folderRows(files: SourceMatrixFile[], sources: SourceInstanceResponse[]): MatrixRow[] {
  interface Node { key: string; label: string; files: SourceMatrixFile[]; children: Map<string, Node> }
  const roots = new Map<string, Node>();
  const sourcesById = new Map(sources.map((source) => [source.id, source]));
  for (const file of files) {
    const source = sourcesById.get(file.source_instance_id);
    if (!source) continue;
    let node = roots.get(source.id);
    if (!node) {
      node = { key: `folder-source:${source.id}`, label: source.name, files: [], children: new Map() };
      roots.set(source.id, node);
    }
    node.files.push(file);
    const segments = relativeSourcePath(file, source).split("/").filter(Boolean);
    for (const segment of segments) {
      const key: string = `${node.key}/${segment}`;
      let child = node.children.get(segment);
      if (!child) {
        child = { key, label: segment, files: [], children: new Map() };
        node.children.set(segment, child);
      }
      child.files.push(file);
      node = child;
    }
  }
  const convert = (node: Node, level: number): MatrixRow => ({
    key: node.key,
    label: node.label,
    level,
    files: node.files,
    expandable: node.children.size > 0,
    children: [...node.children.values()]
      .sort((left, right) => left.label.localeCompare(right.label))
      .map((child) => convert(child, level + 1)),
  });
  return [...roots.values()]
    .sort((left, right) => left.label.localeCompare(right.label))
    .map((root) => convert(root, 0));
}

function Cell({ files }: { files: SourceMatrixFile[] }) {
  if (files.length === 0) return <span className="source-matrix-empty" aria-label="Not present">—</span>;
  if (files.length > 1) {
    return <span className="source-matrix-presence" title={files.map((file) => file.mapped_path).join("\n")}>✓ {files.length} files</span>;
  }
  const file = files[0]!;
  const format = [file.container?.toUpperCase(), file.codec, file.size_bytes === null || file.size_bytes === undefined ? null : `${(file.size_bytes / 1_073_741_824).toFixed(2)} GB`]
    .filter(Boolean)
    .join(" · ");
  return (
    <span className="source-matrix-file" title={file.path === file.mapped_path ? file.path : `Reported: ${file.path}\nMapped: ${file.mapped_path}`}>
      <strong>✓ {file.mapped_path}</strong>
      {format && <small>{format}</small>}
    </span>
  );
}

export function SourceMatrixView({ items, matrix, sort }: { items: Work[]; matrix: SourceMatrixResponse; sort: MatrixSort }) {
  const client = useApiClient();
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [details, setDetails] = useState<Record<string, WorkDetail>>({});
  const [loadingWork, setLoadingWork] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const peers = useMemo(
    () => [...matrix.peers].sort((left, right) => Number(right.is_self) - Number(left.is_self) || left.name.localeCompare(right.name)),
    [matrix.peers],
  );
  const sources = useMemo(
    () => [...matrix.sources].sort((left, right) => left.priority - right.priority || left.name.localeCompare(right.name)),
    [matrix.sources],
  );
  const rows = useMemo<MatrixRow[]>(() => {
    const itemIds = new Set(items.map((work) => work.id));
    const relevantFiles = matrix.files.filter((file) => itemIds.has(file.work_id));
    if (sort === "folder") return folderRows(relevantFiles, sources);
    if (sort === "source") return sourceRows(items, relevantFiles, sources, details);
    const filesByWork = new Map<string, SourceMatrixFile[]>();
    for (const file of relevantFiles) {
      const files = filesByWork.get(file.work_id) ?? [];
      files.push(file);
      filesByWork.set(file.work_id, files);
    }
    return typeRows(items, filesByWork, details);
  }, [details, items, matrix.files, sort, sources]);

  function visibleRows(input: MatrixRow[]): MatrixRow[] {
    return input.flatMap((row) => [row, ...(row.expandable && expanded.has(row.key) && row.children ? visibleRows(row.children) : [])]);
  }

  async function toggle(row: MatrixRow) {
    if (!row.expandable) return;
    if (row.work && !details[row.work.id]) {
      setLoadError(null);
      setLoadingWork(row.work.id);
      try {
        const detail = await client.getWork(row.work.id);
        setDetails((current) => ({ ...current, [row.work!.id]: detail }));
      } catch (error) {
        setLoadError(describeApiError(error));
        return;
      } finally {
        setLoadingWork(null);
      }
    }
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(row.key)) next.delete(row.key); else next.add(row.key);
      return next;
    });
  }

  const displayedRows = visibleRows(rows);
  const firstColumnLabel = sort === "source" ? "Source instance / media" : sort === "type" ? "Media type / media" : "Source / mapped folder";
  return (
    <div className="source-matrix-scroll" data-tv-scroll-container data-tv-scroll-axis="both" data-navigation-scroll-key="admin-library-peer-matrix">
      {loadError && <p className="error-text source-matrix-message" role="alert">{loadError}</p>}
      <table className="source-matrix-table">
        <thead><tr><th className="source-matrix-item-column">{firstColumnLabel}</th>{peers.map((peer) => <th key={peer.id}><strong>{peer.name}</strong><small>{peer.is_self ? "This node" : peer.status.replaceAll("_", " ")}</small></th>)}</tr></thead>
        <tbody>
          {displayedRows.length === 0 && <tr><td colSpan={peers.length + 1} className="source-matrix-no-results">No media items match this view.</td></tr>}
          {displayedRows.map((row) => (
            <tr key={row.key}>
              <th style={{ "--matrix-level": row.level } as React.CSSProperties}>
                <button type="button" className="source-matrix-tree-button" disabled={!row.expandable} aria-expanded={row.expandable ? expanded.has(row.key) : undefined} onClick={() => void toggle(row)}>
                  <span aria-hidden="true">{row.expandable ? (expanded.has(row.key) ? "▾" : "▸") : ""}</span>
                  {row.label}{loadingWork === row.work?.id ? " …" : ""}
                </button>
              </th>
              {peers.map((peer) => <td key={peer.id}><Cell files={row.files.filter((file) => file.peer_node_id === peer.id)} /></td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export type { MatrixSort };
