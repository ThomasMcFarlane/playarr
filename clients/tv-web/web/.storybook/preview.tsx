import type { Decorator, Preview } from "@storybook/react-vite";
import { withThemeByDataAttribute } from "@storybook/addon-themes";
import { MemoryRouter } from "react-router-dom";
import { LanguageProvider } from "../src/lib/i18n/LanguageProvider";
import "../src/styles/fonts.css";
import "../src/styles/global.css";
import "../src/styles/page-layout.css";
import "../src/pages/Calendar.css";
import "../src/pages/Folders.css";
import "./preview.css";

/** The four layouts the product is checked at. Chosen with the Viewport toolbar item. */
export const LAYOUTS = {
  tv1920: { name: "TV 1920x1080", styles: { width: "1920px", height: "1080px" }, type: "desktop" as const },
  tv1280: { name: "TV 1280x720", styles: { width: "1280px", height: "720px" }, type: "desktop" as const },
  desktop: { name: "Desktop 1440x900", styles: { width: "1440px", height: "900px" }, type: "desktop" as const },
  mobile: { name: "Mobile 390x844", styles: { width: "390px", height: "844px" }, type: "mobile" as const },
};

const nested = new URLSearchParams(window.location.search).get("nested") === "1";

/** The app runs on a TV remote: focus rings and lifts follow `data-input-mode="remote"`. */
const withRemoteInput: Decorator = (Story) => {
  document.body.dataset.inputMode = "remote";
  document.documentElement.dataset.platform = "web";
  return <Story />;
};

const withAppProviders: Decorator = (Story) => (
  <MemoryRouter>
    <LanguageProvider>
      <Story />
    </LanguageProvider>
  </MemoryRouter>
);

/**
 * "Compare" toolbar item: renders the same story twice, light above dark, each in its own frame so the
 * root-scoped tokens (`:root[data-theme]`) apply to each independently.
 */
const withCompare: Decorator = (Story, context) => {
  if (nested || context.globals.compare !== "on") return <Story />;
  const base = `iframe.html?id=${encodeURIComponent(context.id)}&viewMode=story&nested=1`;
  return (
    <div>
      {(["light", "dark"] as const).map((theme) => (
        <div key={theme}>
          <p className="sb-frame-label">{theme}</p>
          <iframe className="sb-frame" title={`${context.title} ${context.name} (${theme})`} src={`${base}&globals=theme:${theme}`} />
        </div>
      ))}
    </div>
  );
};

const preview: Preview = {
  decorators: [
    withRemoteInput,
    withAppProviders,
    withThemeByDataAttribute({
      themes: { light: "light", dark: "dark" },
      defaultTheme: "dark",
      attributeName: "data-theme",
    }),
    withCompare,
  ],
  globalTypes: {
    compare: {
      description: "Show light and dark together",
      toolbar: {
        title: "Compare",
        icon: "sidebyside",
        items: [
          { value: "off", title: "Single theme" },
          { value: "on", title: "Light and dark together" },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: { compare: "off", viewport: { value: "tv1920", isRotated: false } },
  parameters: {
    layout: "fullscreen",
    controls: { expanded: false },
    viewport: { options: LAYOUTS },
    backgrounds: { disabled: true },
    // The Pseudo states toolbar item forces :hover, :focus-visible, :active and :focus-within on everything in the page.
    pseudo: { rootSelector: "body" },
    options: { storySort: { order: ["Foundations", "Components", "Pages"] } },
  },
};

export default preview;
