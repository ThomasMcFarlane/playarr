import { useMemo, useState } from "react";
import type {
  SourceMatrixFile,
  SourceMatrixResponse,
  Work,
  WorkDetail,
} from "@streamarr-tv/api-client";
import { describeApiError } from "@streamarr-tv/api-client";
import { useApiClient } from "../lib/ApiClientProvider";
import { KIND_LABELS } from "./PosterCard";

type MatrixSort = "library" | "folder";

interface MatrixRow {
  key: string;
  label: string;
  level: number;
  files: SourceMatrixFile[];
  expandable?: boolean;
  work?: Work;
  children?: MatrixRow[];
}

function detailRows(detail: WorkDetail, files: SourceMatrixFile[]): MatrixRow[] {
  const children = detail.children;
  if (children === "Movie") return [];
  if ("Series" in children) {
    return children.Series.map(({ season, episodes }) => {
      const episodeRows = episodes.map(({ episode }) => ({
        key: `episode:${episode.id}`,
        label: `E${String(episode.episode_number).padStart(2, "0")} ${episode.title ?? "Untitled episode"}`,
        level: 3,
        files: files.filter((file) => file.leaf_ref.leaf_kind === "episode" && file.leaf_ref.leaf_id === episode.id),
      }));
      return {
        key: `season:${season.id}`,
        label: season.title ?? `Season ${season.season_number}`,
        level: 2,
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
        level: 3,
        files: files.filter((file) => file.leaf_ref.leaf_kind === "track" && file.leaf_ref.leaf_id === track.id),
      }));
      return {
        key: `album:${album.id}`,
        label: album.title,
        level: 2,
        files: trackRows.flatMap((row) => row.files),
        expandable: trackRows.length > 0,
        children: trackRows,
      };
    });
  }
  return children.Author.map(({ book }) => ({
    key: `book:${book.id}`,
    label: book.title,
    level: 2,
    files: files.filter((file) => file.leaf_ref.leaf_kind === "book" && file.leaf_ref.leaf_id === book.id),
  }));
}

function folderRows(files: SourceMatrixFile[]): MatrixRow[] {
  interface Node { key: string; label: string; files: SourceMatrixFile[]; children: Map<string, Node> }
  const root: Node = { key: "folder:/", label: "Physical folders", files: [], children: new Map() };
  for (const file of files) {
    const path = file.mapped_path.replaceAll("\\", "/");
    const segments = path.split("/").filter(Boolean);
    let node = root;
    for (const [index, segment] of segments.entries()) {
      const key = `${node.key}/${segment}`;
      let child = node.children.get(segment);
      if (!child) {
        child = { key, label: segment, files: [], children: new Map() };
        node.children.set(segment, child);
      }
      child.files.push(file);
      node = child;
      if (index === segments.length - 1) child.children.clear();
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
  return [...root.children.values()]
    .sort((left, right) => left.label.localeCompare(right.label))
    .map((child) => convert(child, 0));
}

function Cell({ files }: { files: SourceMatrixFile[] }) {
  if (files.length === 0) return <span className="source-matrix-empty" aria-label="Not present">—</span>;
  if (files.length > 1) {
    return <span className="source-matrix-presence" title={files.map((file) => file.mapped_path).join("\n")}>✓ {files.length} files</span>;
  }
  const file = files[0]!;
  return (
    <span className="source-matrix-file" title={file.path === file.mapped_path ? file.path : `Reported: ${file.path}\nMapped: ${file.mapped_path}`}>
      <strong>✓ {file.mapped_path}</strong>
      <small>{file.container.toUpperCase()} · {file.codec} · {(file.size_bytes / 1_073_741_824).toFixed(2)} GB</small>
    </span>
  );
}

export function SourceMatrixView({
  items,
  matrix,
  sort,
}: {
  items: Work[];
  matrix: SourceMatrixResponse;
  sort: MatrixSort;
}) {
  const client = useApiClient();
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [details, setDetails] = useState<Record<string, WorkDetail>>({});
  const [loadingWork, setLoadingWork] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const sources = useMemo(
    () => [...matrix.sources].sort((left, right) => left.priority - right.priority || left.name.localeCompare(right.name)),
    [matrix.sources]
  );
  const rows = useMemo<MatrixRow[]>(() => {
    const itemIds = new Set(items.map((work) => work.id));
    const relevantFiles = matrix.files.filter((file) => itemIds.has(file.work_id));
    const filesByWork = new Map<string, SourceMatrixFile[]>();
    for (const file of relevantFiles) {
      const files = filesByWork.get(file.work_id) ?? [];
      files.push(file);
      filesByWork.set(file.work_id, files);
    }
    if (sort === "folder") return folderRows(relevantFiles);
    const kinds = ["movie", "series", "site", "artist", "author"] as const;
    return kinds.flatMap((kind) => {
      const works = items.filter((work) => work.kind === kind);
      if (works.length === 0) return [];
      return [{
        key: `kind:${kind}`,
        label: KIND_LABELS[kind],
        level: 0,
        files: works.flatMap((work) => filesByWork.get(work.id) ?? []),
        expandable: true,
        children: works.map((work) => {
          const files = filesByWork.get(work.id) ?? [];
          const detail = details[work.id];
          const children = detail ? detailRows(detail, files) : undefined;
          return {
            key: `work:${work.id}`,
            label: work.title,
            level: 1,
            files,
            work,
            expandable: work.kind !== "movie",
            children,
          };
        }),
      }];
    });
  }, [details, items, matrix.files, sort]);

  function visibleRows(input: MatrixRow[]): MatrixRow[] {
    return input.flatMap((row) => [
      row,
      ...(row.expandable && expanded.has(row.key) && row.children ? visibleRows(row.children) : []),
    ]);
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
  return (
    <div
      className="source-matrix-scroll"
      data-tv-scroll-container
      data-tv-scroll-axis="both"
      data-navigation-scroll-key="admin-library-source-matrix"
    >
      {loadError && <p className="error-text source-matrix-message" role="alert">{loadError}</p>}
      <table className="source-matrix-table">
        <thead><tr><th className="source-matrix-item-column">{sort === "library" ? "Library / media" : "Mapped physical folder"}</th>{sources.map((source) => <th key={source.id}><strong>{source.name}</strong><small>{source.kind}</small></th>)}</tr></thead>
        <tbody>
          {displayedRows.length === 0 && (
            <tr><td colSpan={sources.length + 1} className="source-matrix-no-results">No media items match this view.</td></tr>
          )}
          {displayedRows.map((row) => (
            <tr key={row.key}>
              <th style={{ "--matrix-level": row.level } as React.CSSProperties}>
                <button type="button" className="source-matrix-tree-button" disabled={!row.expandable} aria-expanded={row.expandable ? expanded.has(row.key) : undefined} onClick={() => void toggle(row)}>
                  <span aria-hidden="true">{row.expandable ? (expanded.has(row.key) ? "▾" : "▸") : ""}</span>
                  {row.label}{loadingWork === row.work?.id ? " …" : ""}
                </button>
              </th>
              {sources.map((source) => <td key={source.id}><Cell files={row.files.filter((file) => file.source_instance_id === source.id)} /></td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export type { MatrixSort };
