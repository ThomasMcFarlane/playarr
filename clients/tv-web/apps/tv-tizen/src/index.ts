import "./tizen.css";
import { loadPackagedConfig } from "./tizen-runtime.mjs";
import { installLegacyHas } from "../../../tooling/legacy-has.mjs";

// Chromium 94 (Tizen 7) has no :has(); the build rewrites those rules for this runtime.
installLegacyHas();

// The native wrapper packages the complete routed Playarr application. The
// compile-time platform constant makes the shared web runtime select Tizen
// identity, HashRouter navigation, and the AVPlay engine.
void loadPackagedConfig().finally(() => import("../../../web/src/main"));
