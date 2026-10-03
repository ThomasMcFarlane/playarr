/**
 * End-of-playback state machine and helpers (docs/architecture/end-of-playback.md).
 *
 * This file lives under `core/` and is deliberately plain TypeScript: no
 * ArkUI, no `@kit.*` / `@ohos.*` imports, no decorators. It is Linux
 * testable with `node --test`. `pages/Player.ets` feeds it events (engine
 * ended, one-second ticks, user choices) and performs the returned command;
 * it owns no clock and no I/O.
 */

import { Work } from "./Types/Work";
import { AlbumDetail, SeasonDetail } from "./Types/WorkDetail";

/** Spec section 4: the countdown is 10 whole seconds. */
export const END_SCREEN_COUNTDOWN_SECONDS: number = 10;

/** Spec section 5: the suggestions row never shows more than 12 tiles. */
export const END_SCREEN_MAX_SUGGESTIONS: number = 12;

/** Spec section 11: a resume position within 5 s of the end counts as watched. */
export const WATCHED_TAIL_MS: number = 5000;

/** One playable entry of the up-next queue (an episode, for series). */
export interface QueueItem {
  mediaFileId: string;
  workId: string;
  title: string;
  /** True for audio tracks: they chain with no card and no countdown (spec section 11). */
  immediate: boolean;
}

export type EndPhase = "playing" | "endCard" | "upNext";

export type EndCommand = "none" | "replay" | "playNext" | "exit";

/**
 * Flattens a series into the playable episodes AFTER the one whose file is
 * `currentMediaFileId`, in season then episode order. Episodes without a
 * synced file are skipped. Empty when the current file is not found.
 */
export function buildSeriesQueue(
  workId: string,
  seriesTitle: string,
  seasons: SeasonDetail[],
  currentMediaFileId: string
): QueueItem[] {
  const orderedSeasons: SeasonDetail[] = seasons.slice().sort(
    (a: SeasonDetail, b: SeasonDetail): number => a.season.season_number - b.season.season_number
  );
  const queue: QueueItem[] = [];
  let passedCurrent: boolean = false;
  for (const season of orderedSeasons) {
    const episodes = season.episodes.slice().sort(
      (a, b): number => a.episode.episode_number - b.episode.episode_number
    );
    for (const detail of episodes) {
      const fileId: string | null =
        detail.media_file_id === undefined || detail.media_file_id === null ? null : detail.media_file_id;
      if (fileId === null) {
        continue;
      }
      if (!passedCurrent) {
        if (fileId === currentMediaFileId) {
          passedCurrent = true;
        }
        continue;
      }
      const episodeTitle: string =
        detail.episode.title === undefined || detail.episode.title === null || detail.episode.title.length === 0
          ? "Episode " + String(detail.episode.episode_number)
          : detail.episode.title;
      const label: string =
        "S" + String(season.season.season_number) + ":E" + String(detail.episode.episode_number);
      const item: QueueItem = {
        mediaFileId: fileId,
        workId: workId,
        title: seriesTitle.length > 0 ? seriesTitle + " " + label + " " + episodeTitle : label + " " + episodeTitle,
        immediate: false,
      };
      queue.push(item);
    }
  }
  return queue;
}

/**
 * Flattens an artist's albums into the playable tracks after the one whose
 * file is `currentMediaFileId` (album order as given, disc then track
 * number). Tracks chain immediately, with no end card until the queue ends.
 */
export function buildAlbumQueue(
  workId: string,
  albums: AlbumDetail[],
  currentMediaFileId: string
): QueueItem[] {
  const queue: QueueItem[] = [];
  let passedCurrent: boolean = false;
  for (const album of albums) {
    const tracks = album.tracks.slice().sort(
      (a, b): number =>
        a.track.disc_number !== b.track.disc_number
          ? a.track.disc_number - b.track.disc_number
          : a.track.track_number - b.track.track_number
    );
    for (const detail of tracks) {
      const fileId: string | null =
        detail.media_file_id === undefined || detail.media_file_id === null ? null : detail.media_file_id;
      if (fileId === null) {
        continue;
      }
      if (!passedCurrent) {
        if (fileId === currentMediaFileId) {
          passedCurrent = true;
        }
        continue;
      }
      const item: QueueItem = {
        mediaFileId: fileId,
        workId: workId,
        title: detail.track.title,
        immediate: true,
      };
      queue.push(item);
    }
  }
  return queue;
}

/** Similar works minus the finished one, de-duplicated, capped (spec section 5). */
export function pickSuggestions(similar: Work[], currentWorkId: string, max: number): Work[] {
  const seen: Map<string, boolean> = new Map<string, boolean>();
  const result: Work[] = [];
  for (const work of similar) {
    if (result.length >= max) {
      break;
    }
    if (work.id === currentWorkId || seen.has(work.id)) {
      continue;
    }
    seen.set(work.id, true);
    result.push(work);
  }
  return result;
}

/** A start position within 5 s of the end replays from 0 (`0` means "from the start"). */
export function normaliseResumeMs(resumeMs: number, durationMs: number): number {
  if (resumeMs <= 0) {
    return 0;
  }
  if (durationMs > 0 && resumeMs >= durationMs - WATCHED_TAIL_MS) {
    return 0;
  }
  return resumeMs;
}

export class EndOfPlaybackMachine {
  phase: EndPhase = "playing";
  secondsRemaining: number = 0;
  countdownCancelled: boolean = false;
  /** True while the app is backgrounded or covered: ticks do nothing. */
  paused: boolean = false;

  private readonly hasNext: boolean;
  private readonly autoplayNext: boolean;
  private readonly countdownSeconds: number;
  private readonly immediateNext: boolean;

  constructor(
    hasNext: boolean,
    autoplayNext: boolean = true,
    countdownSeconds: number = END_SCREEN_COUNTDOWN_SECONDS,
    immediateNext: boolean = false
  ) {
    this.immediateNext = immediateNext;
    this.hasNext = hasNext;
    this.autoplayNext = autoplayNext;
    this.countdownSeconds = Math.max(1, countdownSeconds);
  }

  /** True when the host should deliver one-second ticks. */
  countdownRunning(): boolean {
    return this.phase === "upNext" && this.autoplayNext;
  }

  /**
   * The engine reached the end. Ignored unless the item was playing.
   * Returns `playNext` only for an immediate (audio) chain, where no card
   * is shown at all.
   */
  onEnded(): EndCommand {
    if (this.phase !== "playing") {
      return "none";
    }
    if (!this.hasNext) {
      this.phase = "endCard";
      return "none";
    }
    if (this.immediateNext) {
      return "playNext";
    }
    this.phase = "upNext";
    this.secondsRemaining = this.countdownSeconds;
    return "none";
  }

  /** One second elapsed. Returns `playNext` when the countdown completes. */
  tick(): EndCommand {
    if (!this.countdownRunning() || this.paused) {
      return "none";
    }
    this.secondsRemaining = this.secondsRemaining - 1;
    if (this.secondsRemaining > 0) {
      return "none";
    }
    this.secondsRemaining = 0;
    return "playNext";
  }

  /** Stop the countdown and stay on the ended card; sticky until a new playback. */
  cancelCountdown(): void {
    if (this.phase !== "upNext") {
      return;
    }
    this.phase = "endCard";
    this.countdownCancelled = true;
    this.secondsRemaining = 0;
  }

  /** Play now, or Play next from the ended card. */
  playNow(): EndCommand {
    if (this.phase !== "playing" && this.hasNext) {
      return "playNext";
    }
    return "none";
  }

  /** Restart the finished item; the machine can end again afterwards. */
  replay(): EndCommand {
    if (this.phase === "playing") {
      return "none";
    }
    this.phase = "playing";
    this.secondsRemaining = 0;
    this.countdownCancelled = false;
    return "replay";
  }

  exit(): EndCommand {
    return this.phase === "playing" ? "none" : "exit";
  }
}
