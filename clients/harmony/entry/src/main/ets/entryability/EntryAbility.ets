/**
 * Stage-model ability lifecycle for Playarr on HarmonyOS NEXT.
 *
 * `module.json5` names this ability `mainElement` and gives it the
 * `entity.system.home` skill, so the system launches it as the app's entry
 * point. Its one job today is to load the single root page registered in
 * `profile/main_pages.json` / `profile/router_map.json` (`pages/Index.ets`).
 *
 * `onWindowStageCreate` also runs the whole `net`/`auth`/`device` bootstrap
 * (brief sections 3.2 and 9 Slice 3) via `AppContainer.ets#bootstrapAppContainer`
 * -- constructing the app's one `ServerDirectory`, `SessionManager` and
 * `PlayarrClient`, and installing `device/DeviceProfileService.ets` on
 * this window stage. That call is fire-and-forget from THIS method's own
 * point of view (its declared return type stays `void`, matching the base
 * `UIAbility` lifecycle signature); any bootstrap failure is caught and
 * logged rather than left as an unhandled rejection. Later slices (pages,
 * repositories) read the resulting singletons back via `AppContainer.ets`'s
 * getters rather than constructing their own instances.
 *
 * Immersive window setup described in the implementation brief (section
 * 2.5) belongs to a later design-system change; this keeps the ability
 * buildable and loadable in the meantime without guessing at that work.
 *
 * Also wires `util/Sandbox.ets` (brief 4.11's sidecar-subtitle download
 * path) to this ability's context, the same "call init first" discipline as
 * `AppContainer.ets#bootstrapAppContainer`'s own `initSettingsStore` call --
 * `Sandbox` is not a `net`/`auth`/`device` concern, so it is wired here
 * directly rather than folded into `bootstrapAppContainer`. A stale-file
 * sweep runs immediately afterwards (fire-and-forget, like the bootstrap
 * call above it) so downloads left over from a killed or crashed previous
 * run do not accumulate across app starts.
 */

import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';
import { BusinessError } from '@kit.BasicServicesKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { window } from '@kit.ArkUI';

import { bootstrapAppContainer } from '../AppContainer';
import { initSandbox, cleanupStaleSandboxFiles } from '../util/Sandbox';
import { logError } from '../util/Log';

const LOG_DOMAIN: number = 0x0000;
const LOG_TAG: string = 'EntryAbility';

export default class EntryAbility extends UIAbility {
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    hilog.info(LOG_DOMAIN, LOG_TAG, '%{public}s', 'onCreate');
  }

  onDestroy(): void {
    hilog.info(LOG_DOMAIN, LOG_TAG, '%{public}s', 'onDestroy');
  }

  onWindowStageCreate(windowStage: window.WindowStage): void {
    hilog.info(LOG_DOMAIN, LOG_TAG, '%{public}s', 'onWindowStageCreate');

    bootstrapAppContainer(this.context, windowStage).catch((err: Error): void => {
      logError(LOG_TAG, 'AppContainer bootstrap failed: ' + err.message);
    });

    initSandbox(this.context);
    cleanupStaleSandboxFiles().catch((err: Error): void => {
      logError(LOG_TAG, 'stale sandbox cleanup failed: ' + err.message);
    });

    windowStage.loadContent('pages/Index', (err: BusinessError) => {
      if (err.code) {
        hilog.error(
          LOG_DOMAIN,
          LOG_TAG,
          'failed to load content, code %{public}d message %{public}s',
          err.code,
          err.message
        );
        return;
      }
      hilog.info(LOG_DOMAIN, LOG_TAG, '%{public}s', 'content loaded');
    });
  }

  onWindowStageDestroy(): void {
    hilog.info(LOG_DOMAIN, LOG_TAG, '%{public}s', 'onWindowStageDestroy');
  }

  onForeground(): void {
    hilog.info(LOG_DOMAIN, LOG_TAG, '%{public}s', 'onForeground');
  }

  onBackground(): void {
    hilog.info(LOG_DOMAIN, LOG_TAG, '%{public}s', 'onBackground');
  }
}
