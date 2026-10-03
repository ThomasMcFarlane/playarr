import type { RemotePlayerControls } from "./commands";

/**
 * The active player registers itself here so the remote host (which lives in
 * the app shell) can read its state and drive it without prop drilling.
 */
let activePlayer: RemotePlayerControls | null = null;
const listeners = new Set<() => void>();

export function setRemotePlayer(player: RemotePlayerControls | null): void {
  activePlayer = player;
  for (const listener of listeners) listener();
}

export function getRemotePlayer(): RemotePlayerControls | null {
  return activePlayer;
}

export function subscribeRemotePlayer(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
