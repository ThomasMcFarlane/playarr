export interface CastHandoffSteps {
  /** Halts local playback before the receiver takes over. */
  pauseLocal: () => void;
  /** Puts local playback back when the handoff fails. */
  resumeLocal: () => void;
  /** Drops the half-started cast session. */
  endSession: () => void;
  /** Everything that can fail after local playback paused. */
  start: () => Promise<void>;
}

/**
 * Pauses local playback, runs the cast start, and on any failure ends the
 * session and resumes local playback before rethrowing so the caller can
 * show its quiet inline error.
 */
export async function runCastHandoff(steps: CastHandoffSteps): Promise<void> {
  steps.pauseLocal();
  try {
    await steps.start();
  } catch (error) {
    try {
      steps.endSession();
    } catch {
      // The session may already be gone; resuming matters more.
    }
    steps.resumeLocal();
    throw error;
  }
}
