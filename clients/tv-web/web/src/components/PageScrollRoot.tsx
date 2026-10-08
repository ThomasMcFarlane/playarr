import type { ReactNode } from "react";

/** The native vertical viewport shared by every authenticated route. */
export function PageScrollRoot({
  scrollKey,
  routeMotion,
  children,
}: {
  scrollKey: string;
  /** Route transition token (see lib/routeMotion.ts); CSS animates the page body only. */
  routeMotion?: string;
  children: ReactNode;
}) {
  return (
    <main
      className="app-main"
      data-tv-scroll-container
      data-tv-scroll-axis="vertical"
      data-navigation-scroll-key={scrollKey}
      data-route-motion={routeMotion}
    >
      {children}
    </main>
  );
}
