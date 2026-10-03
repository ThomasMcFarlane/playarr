import { useMemo } from "react";
import { useTvNavigation } from "../lib/useTvNavigation";

const COLUMNS = 24;
const ROWS = 30;
const CARD_W = 140;
const CARD_H = 200;
const GAP = 12;

/**
 * Dev-only dense focus grid for measuring directional navigation under 4K +
 * CPU throttle. Uses the same `useTvNavigation` bridge as production screens,
 * with ~720 focusable cards (no API / artwork dependency).
 */
export function NavPerfHarnessPage() {
  useTvNavigation("/__nav-perf");

  const cards = useMemo(() => {
    const items: { id: string; col: number; row: number }[] = [];
    for (let row = 0; row < ROWS; row += 1) {
      for (let col = 0; col < COLUMNS; col += 1) {
        items.push({ id: `${row}:${col}`, col, row });
      }
    }
    return items;
  }, []);

  return (
    <div
      className="app-main tv-library tv-directory"
      data-nav-perf-harness
      style={{
        position: "fixed",
        inset: 0,
        overflow: "auto",
        padding: 24,
        background: "var(--bg, #121212)",
        color: "var(--text, #f7f5f4)",
      }}
      data-tv-scroll-container
      data-tv-scroll-axis="vertical"
      data-navigation-scroll-key="nav-perf:grid"
    >
      <h1 style={{ margin: "0 0 16px", fontSize: 28 }}>Nav perf harness</h1>
      <p style={{ margin: "0 0 24px", opacity: 0.75 }}>
        {cards.length} focusable cards · use arrow keys
      </p>
      <div
        className="tv-title-grid"
        style={{
          position: "relative",
          width: COLUMNS * (CARD_W + GAP),
          height: ROWS * (CARD_H + GAP),
        }}
      >
        {cards.map((card, index) => (
          <a
            key={card.id}
            href={`#${card.id}`}
            className="tv-title-card"
            data-tv-focus-default={index === 0 ? true : undefined}
            data-navigation-focus-key={`nav-perf:${card.id}`}
            data-nav-perf-card={card.id}
            style={{
              position: "absolute",
              left: card.col * (CARD_W + GAP),
              top: card.row * (CARD_H + GAP),
              width: CARD_W,
              height: CARD_H,
              display: "flex",
              alignItems: "flex-end",
              padding: 10,
              boxSizing: "border-box",
              borderRadius: 12,
              background: "rgba(255,255,255,0.08)",
              color: "inherit",
              textDecoration: "none",
              outline: "none",
            }}
            onFocus={(event) => {
              event.currentTarget.style.boxShadow = "0 0 0 3px #cf3157";
            }}
            onBlur={(event) => {
              event.currentTarget.style.boxShadow = "none";
            }}
          >
            <strong style={{ fontSize: 14 }}>{card.id}</strong>
          </a>
        ))}
      </div>
    </div>
  );
}
