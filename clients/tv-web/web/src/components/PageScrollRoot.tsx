import type { ReactNode } from "react";

/** The native vertical viewport shared by every authenticated route. */
export function PageScrollRoot({
  scrollKey,
  children,
}: {
  scrollKey: string;
  children: ReactNode;
}) {
  return (
    <main
      className="app-main"
      data-tv-scroll-container
      data-tv-scroll-axis="vertical"
      data-navigation-scroll-key={scrollKey}
    >
      {children}
    </main>
  );
}
