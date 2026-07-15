export function HomePage() {
  return (
    <div style={{ padding: "2rem", color: "#ffffff" }}>
      <h1>Streamarr</h1>
      <p style={{ color: "#a0a0a0", maxWidth: 560 }}>
        Standalone web app placeholder. This page will surface continue-watching
        and recommended shelves once <code>@streamarr-tv/api-client</code> is
        wired to a real backend -- see <code>Library</code> for the data-fetching
        shape that will grow into this page.
      </p>
    </div>
  );
}
