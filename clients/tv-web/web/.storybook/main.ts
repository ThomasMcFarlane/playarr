import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { StorybookConfig } from "@storybook/react-vite";

const webRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

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
  // Components call useApiClient(); stories get a fixture client instead of the network-backed provider.
  viteFinal: (config) => {
    const mock = join(webRoot, "stories/mocks/ApiClientProvider.tsx");
    config.plugins = [
      ...(config.plugins ?? []),
      {
        name: "playarr-storybook-api-client-mock",
        enforce: "pre",
        resolveId(source: string, importer?: string) {
          if (/(^|\/)lib\/ApiClientProvider$/.test(source) || /^\.\/ApiClientProvider$/.test(source)) {
            return importer === mock ? null : mock;
          }
          return null;
        },
      },
    ];
    return config;
  },
};

export default config;
