export function watchInlineMusicHost(
  media: MediaQueryList,
  onHostChange: (host: HTMLElement | null) => void
): () => void {
  const updateHost = () => {
    onHostChange(
      media.matches
        ? document.getElementById("inline-music-player-host")
        : null
    );
  };
  const observer = new MutationObserver(updateHost);

  updateHost();
  observer.observe(document.body, { childList: true, subtree: true });
  media.addEventListener("change", updateHost);

  return () => {
    observer.disconnect();
    media.removeEventListener("change", updateHost);
  };
}
