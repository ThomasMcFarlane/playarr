import type { StorybookConfig } from "@storybook/react-vite";

// Playarr web Storybook. It renders the real components with the real stylesheets and tokens
// (src/styles/*.css), using fixture data only: no real titles, no network, no secrets.
const config: StorybookConfig = {
  stories: ["../stories/**/*.stories.@(ts|tsx)"],
  addons: [
    "@storybook/addon-docs",
    "@storybook/addon-a11y",
    "@storybook/addon-themes",
    "storybook-addon-pseudo-states",
  ],
  framework: { name: "@storybook/react-vite", options: {} },
  core: { disableTelemetry: true },
  typescript: { check: false },
};

export default config;
