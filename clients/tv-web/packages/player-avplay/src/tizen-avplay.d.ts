/** Samsung TV globals injected by the platform runtime. */

interface TizenWebApis {
  avplay: import("./index").TizenAvplayApi;
  appcommon?: import("./index").TizenAppCommonApi;
}

interface TizenRuntime {
  filesystem?: import("./index").TizenFilesystemApi;
}

declare const webapis: TizenWebApis;
declare const tizen: TizenRuntime;
