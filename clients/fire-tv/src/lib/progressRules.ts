/**
 * Pure rules for watch progress (PLAYER-SPEC sections 1 and 11), shared by the
 * player screen and its tests. They match the web client: resume only from a
 * part-watched server row, and never write a position for playback that did not
 * start.
 */
export interface ServerProgress {
  state: 'unseen' | 'part_watched' | 'watched';
  position_ms: number;
}

/** Seconds to resume at from the server's row, or undefined to start from the beginning. */
export function resumeSecondsFromServer(progress: ServerProgress | undefined): number | undefined {
  if (!progress || progress.state !== 'part_watched' || !(progress.position_ms > 0)) return undefined;
  return progress.position_ms / 1000;
}

/** A write is allowed only once playback has really started, and never for position 0 unless completed. */
export function shouldWriteProgress(options: {
  positionMs: number;
  completed: boolean;
  playbackStarted: boolean;
}): boolean {
  if (options.completed) return options.playbackStarted;
  return options.playbackStarted && options.positionMs > 0;
}

/** Resolves when `work` settles or after `ms`, so an exit never hangs on a dead network. */
export function settleWithin(work: Promise<unknown>, ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    work.then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      () => {
        clearTimeout(timer);
        resolve();
      }
    );
  });
}
