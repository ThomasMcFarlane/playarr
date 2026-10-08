import { addons } from "storybook/manager-api";
import { themes } from "storybook/theming";

// The manager (sidebar and toolbar) defaults to dark; the preview theme itself follows the Theme toolbar item.
addons.setConfig({ panelPosition: "right", theme: themes.dark });
