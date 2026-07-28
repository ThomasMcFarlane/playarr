/**
 * Composition root for Playarr on HarmonyOS NEXT (brief section 3.2's
 * layer diagram: `net/` and `auth/` sit above `core/`; `pages/` built in
 * later slices consume the singletons below rather than constructing their
 * own `PlayarrClient` / `SessionManager` / `ServerDirectory` instances).
 *
 * `bootstrapAppContainer` must be called exactly once, from
 * `entryability/EntryAbility.ets#onWindowStageCreate`, before any page
 * reads the getters below. In order, it:
 *
 * 1. Wires `auth/SettingsStore.ets` to the ability context
 *    (`initSettingsStore`) -- every `SettingsStore` getter/setter throws if
 *    called before this.
 * 2. Installs `device/DeviceProfileService.ets` on the window stage. Its
 *    initial `DeviceProfile` publish into `AppStorage` happens
 *    SYNCHRONOUSLY, inline, before `installDeviceProfileService` returns
 *    (see that file's own header comment) -- so it is safe to read back
 *    immediately afterwards, no `await` needed.
 * 3. Reads that just-published `DeviceProfile.platformWireName` as the ONE
 *    `clientPlatform` value used for the rest of the process's lifetime
 *    (brief section 6.1: this must never change mid-session, even across a
 *    later window resize) -- falling back to
 *    `core/AppConfig.ts#resolveClientPlatform` only in the defensive case
 *    where step 2 failed and left `AppStorage` empty (that function never
 *    throws back to its own caller, so a failure there is otherwise silent).
 * 4. Constructs one `ServerDirectory`, one `SessionManager` (wired to that
 *    `ServerDirectory`), one `PlayarrClient` (wired to both, as its
 *    `ActiveServerProvider` / `AccessTokenProvider` respectively) and one
 *    `DeviceAuthService` (wired to all three, for the pairing screen).
 *    `net/HttpTransport.ets` is a plain function module, not a class --
 *    there is nothing to instantiate for it; `PlayarrClient` and
 *    `SessionManager` each import and call it directly.
 * 5. Hydrates `ServerDirectory` and `SessionManager` from persisted state
 *    (`SettingsStore` / `SecretStore`) and starts `SessionManager`'s
 *    proactive-refresh timer.
 *
 * Deliberately NOT a DI framework: a few module-level variables, one async
 * setup function, and a getter per singleton that fails loudly if called
 * before `bootstrapAppContainer` has run -- consistent with
 * `SettingsStore.ets`'s own "call init first, or throw" discipline.
 *
 * `getDeviceAuthService()` exists for exactly one reason: `checks/arkts.mjs`
 * (offline validator Check 4) forbids any file under `pages/` from
 * importing `net/` or `auth/` directly (brief section 3.1's layer rule), so
 * `pages/Pairing.ets` cannot construct or import `auth/DeviceAuthService.ets`
 * itself. Routing it through this composition root, exactly like the three
 * getters above, keeps that page's only import path clean while still
 * handing it the one shared instance rather than a fresh, disconnected one.
 */

import { common } from '@kit.AbilityKit';
import { window } from '@kit.ArkUI';

import { resolveClientPlatform } from './core/AppConfig.ts';
import { DeviceProfile } from './core/DeviceProfile.ts';

import { initSettingsStore } from './auth/SettingsStore';
import { ServerDirectory } from './auth/ServerDirectory';
import { SessionManager } from './auth/SessionManager';
import { PlayarrClient } from './net/PlayarrClient';
import { DeviceAuthService } from './auth/DeviceAuthService';
import { installDeviceProfileService, DEVICE_PROFILE_STORAGE_KEY } from './device/DeviceProfileService';

let serverDirectoryInstance: ServerDirectory | null = null;
let sessionManagerInstance: SessionManager | null = null;
let playarrClientInstance: PlayarrClient | null = null;
let deviceAuthServiceInstance: DeviceAuthService | null = null;

/**
 * The `clientPlatform` wire name to boot with: the `DeviceProfile`
 * `device/DeviceProfileService.ets` just published into `AppStorage`, or
 * (defensively, if nothing was published) `resolveClientPlatform('phone')`
 * -- never the TV identity by accident.
 */
function resolveBootClientPlatform(): string {
  const profile = AppStorage.get<DeviceProfile>(DEVICE_PROFILE_STORAGE_KEY);
  if (profile !== undefined) {
    return profile.platformWireName;
  }
  return resolveClientPlatform('phone');
}

/**
 * Wires up and hydrates every singleton this composition root owns -- see
 * the file header for the exact order of operations. Call exactly once,
 * from `EntryAbility#onWindowStageCreate`.
 */
export async function bootstrapAppContainer(context: common.Context, windowStage: window.WindowStage): Promise<void> {
  initSettingsStore(context);
  installDeviceProfileService(windowStage);

  const clientPlatform = resolveBootClientPlatform();

  const directory = new ServerDirectory();
  const session = new SessionManager(directory, clientPlatform);
  const client = new PlayarrClient(directory, session, clientPlatform);
  const deviceAuth = new DeviceAuthService(client, directory, session);

  serverDirectoryInstance = directory;
  sessionManagerInstance = session;
  playarrClientInstance = client;
  deviceAuthServiceInstance = deviceAuth;

  await directory.initialize();
  await session.initialize();
  session.startProactiveRefreshTimer();
}

function requireInstance<T>(instance: T | null, accessorName: string): T {
  if (instance === null) {
    throw new Error('AppContainer: bootstrapAppContainer(...) must run before ' + accessorName + '() is called');
  }
  return instance;
}

/** The single `ServerDirectory` instance every page/repository built in a later slice must use. */
export function getServerDirectory(): ServerDirectory {
  return requireInstance(serverDirectoryInstance, 'getServerDirectory');
}

/** The single `SessionManager` instance every page/repository built in a later slice must use. */
export function getSessionManager(): SessionManager {
  return requireInstance(sessionManagerInstance, 'getSessionManager');
}

/** The single `PlayarrClient` instance every page/repository built in a later slice must use. */
export function getPlayarrClient(): PlayarrClient {
  return requireInstance(playarrClientInstance, 'getPlayarrClient');
}

/** The single `DeviceAuthService` instance `pages/Pairing.ets` must use --
 * see this file's header comment for why a page cannot import
 * `auth/DeviceAuthService.ets` itself. */
export function getDeviceAuthService(): DeviceAuthService {
  return requireInstance(deviceAuthServiceInstance, 'getDeviceAuthService');
}
