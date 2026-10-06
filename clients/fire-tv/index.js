/**
 * Entry point Metro bundles as index.bundle and the Vega runtime loads via
 * manifest.toml's [[components.interactive]] runtime-module (KeplerScript).
 * Deliberately plain JS, not TypeScript: this file is never imported by
 * anything else in the app (it IS the root), so there is nothing for tsc to
 * gain by checking it, and keeping it as the one file untouched by Babel's
 * TypeScript strip keeps the entry point trivially inspectable if a bundle
 * ever needs debugging from the raw source map.
 *
 * The registered name MUST match manifest.toml's
 * [[components.interactive]] id exactly -- that id is how the Vega runtime
 * tells KeplerScript which AppRegistry-registered component to mount.
 */
import {AppRegistry} from 'react-native';
import App from './src/App';
import {name as appName} from './app.json';

AppRegistry.registerComponent(appName, () => App);
