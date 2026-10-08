import type { CSSProperties, ReactNode } from "react";

/** Fixture data only: neutral titles and procedural gradients. No real titles, artwork or people. */
export const FIXTURE_TITLES = [
  "Test Movie A",
  "Test Movie B",
  "Sample Series 1",
  "Sample Series 2",
  "Test Movie C",
  "Sample Series 3",
  "Test Movie D",
  "Sample Series 4",
  "Test Movie E",
  "Sample Series 5",
  "Test Movie F",
  "Sample Series 6",
] as const;

const HUES = [352, 28, 200, 262, 152, 312, 48, 222, 8, 172, 292, 92];

/** A procedural gradient standing in for artwork. */
export function artStyle(index: number): CSSProperties {
  const hue = HUES[index % HUES.length]!;
  return {
    background: `linear-gradient(145deg, hsl(${hue} 46% 38%), hsl(${(hue + 40) % 360} 52% 20%))`,
  };
}

export function Art({ index, children }: { index: number; children?: ReactNode }) {
  return (
    <span className="sb-art" style={artStyle(index)}>
      {children}
    </span>
  );
}

export function Caption({ children }: { children: ReactNode }) {
  return <p className="sb-caption">{children}</p>;
}

/** Pseudo-state selectors for storybook-addon-pseudo-states. */
export const focusOn = (selector: string) => ({ pseudo: { focusVisible: [selector], focus: [selector] } });
export const hoverOn = (selector: string) => ({ pseudo: { hover: [selector] } });
