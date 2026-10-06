// Babel config for both Metro (device/virtual-device bundling) and Jest
// (babel-jest picks this file up automatically -- see jest.config.json,
// which deliberately sets no `transform` of its own so there is exactly one
// place JSX/TS transform rules are defined).
module.exports = {
  presets: ['module:metro-react-native-babel-preset'],
  plugins: [
    // @amazon-devices/react-native-w3cmedia's KeplerVideoView expects the
    // classic (`React.createElement`) JSX runtime rather than the automatic
    // one metro-react-native-babel-preset defaults to on RN 0.72 -- without
    // this plugin, any file that renders it fails at bundle time with a
    // missing-React-in-scope error rather than at typecheck time, because
    // tsconfig.json's `"jsx": "react-native"` setting has no automatic-vs-
    // classic runtime distinction of its own to catch it. Declared here,
    // once, rather than in every screen that ends up importing that
    // component.
    '@babel/plugin-transform-react-jsx',
  ],
};
