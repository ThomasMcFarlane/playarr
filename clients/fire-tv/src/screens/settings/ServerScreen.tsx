/**
 * `/settings/server` (design doc §7: "Show group, sign out, forget
 * server"). Ported against tv-web's `settings/Server.tsx`, narrowed
 * deliberately -- stated explicitly, per this task's own instructions --
 * to what this task's brief actually asks for and what this app's current
 * `ApiClientProvider` can actually support.
 *
 * tv-web's `Server.tsx` also has an "add another server" form (server URL +
 * username + password, `connectServer`) and a joined-server disconnect list
 * (`connectedServers`/`disconnectServer`). Both come from tv-web's
 * `useAuth()`, which is that app's OWN `ApiClientProvider` -- NOT the one
 * this project has (`src/api/ApiClientProvider.tsx`'s own top-of-file
 * comment is explicit that "joined-server fan-out" was deliberately
 * dropped from this app's v1, design doc §4.5). There is no
 * `connectServer`/`connectedServers` here to call. This is not a gap this
 * screen quietly papers over: design doc §7 itself lists no TV client
 * as having a keyboard-first login path at all ("/login, /signup -> ...
 * Packaged TVs link via QR; there is no keyboard-first login path") --
 * manually typing a second server's URL, username and password via D-pad
 * is exactly that path, and this app deliberately has none. Everything
 * this screen surfaces instead is either already real in this app
 * (`useApiBaseUrl`, `useAuthFailed`) or real, exported, DOM-free logic
 * this app already depends on (`@playarr-tv/domain`'s `readKnownServers`/
 * `forgetGroup`, `@playarr-tv/device-auth`'s `TokenStore`).
 *
 * Sign-out and forget-server are two DIFFERENT actions, matching design
 * doc §5.4/§5.5's own distinction exactly, not blurred into one button:
 *
 *  - **Sign out** clears the current session (`TokenStore.clear()`) and
 *    marks `authFailed`, then navigates to `LinkScreen` -- the same
 *    "clear session, but keep deviceId and knownServerGroup" recovery path
 *    design doc §5.4 describes for a hard refresh failure, just
 *    user-initiated instead of error-triggered. Re-linking this device
 *    against the SAME server group afterwards should not need the address
 *    re-entered -- §5.5 rule 4 ("once a group is known, only ever re-prompt
 *    for credentials, never for an address") is exactly why the known
 *    server group survives this action.
 *  - **Forget this server group** is the separate, explicit manual reset
 *    `knownServers.ts`'s own `forgetGroup` doc comment calls "the only
 *    recovery path if a group becomes fully defunct" -- it does NOT sign
 *    the current session out; it only clears the remembered address list,
 *    so a future reconnect (after some other event signs this device out)
 *    prompts for a server address again instead of retrying stale ones.
 *
 * `navigation` is an explicit prop rather than a `useNavigation()` call, and
 * there is no `platform/focus.tsx` `TvFocusScope` wrapper -- both match the
 * convention `LibraryScreen.tsx`/`SearchScreen.tsx`/`NotFoundScreen.tsx`
 * (concurrent sibling screens) already settled on. See
 * `SettingsIndexScreen.tsx`'s top comment for the full rationale, including
 * the real, reproducible `TvFocusScope` rendering bug that convention
 * avoids.
 */
import React, {useState} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {forgetGroup, readKnownServers, type KnownServerGroup} from '@playarr-tv/domain';
import {TokenStore} from '@playarr-tv/device-auth';
import {useApiBaseUrl, useAuthFailed} from '../../api/ApiClientProvider';
import {colour} from '../../theme/tokens';
import {focusRing, layout, text} from '../../theme/styles';
import {ROUTES, type RouteName} from '../../navigation/routes';

export interface ServerScreenNavigation {
  goBack: () => void;
  navigate: (route: RouteName) => void;
}

export interface ServerScreenProps {
  navigation: ServerScreenNavigation;
}

export interface KnownServerRow {
  url: string;
  isLastGood: boolean;
}

/**
 * Pure and exported on its own: turns a `KnownServerGroup | undefined` into
 * the rows this screen renders, in the same priority order
 * `resolveReachableServer` (`@playarr-tv/domain`) would try them in --
 * `lastGoodUrl` first (deduplicated against `servers`), then `servers` in
 * their own stored order. An absent group renders no rows at all, which is
 * the correct "nothing remembered yet" state, not an error.
 */
export function summariseKnownServers(group: KnownServerGroup | undefined): readonly KnownServerRow[] {
  if (!group) return [];
  const rows: KnownServerRow[] = [];
  const seen = new Set<string>();

  if (group.lastGoodUrl) {
    rows.push({url: group.lastGoodUrl, isLastGood: true});
    seen.add(group.lastGoodUrl);
  }
  for (const server of group.servers) {
    if (seen.has(server.url)) continue;
    seen.add(server.url);
    rows.push({url: server.url, isLastGood: false});
  }
  return rows;
}

interface ActionButtonProps {
  label: string;
  tone?: 'default' | 'danger';
  autoFocus?: boolean;
  onPress: () => void;
}

function ActionButton({label, tone = 'default', autoFocus, onPress}: ActionButtonProps): React.ReactElement {
  const [focused, setFocused] = React.useState(false);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hasTVPreferredFocus={autoFocus}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      style={[
        styles.actionButton,
        tone === 'danger' ? styles.actionButtonDanger : null,
        focused ? focusRing.ring : null,
      ]}
    >
      <Text style={[text.bodyEmphasis, tone === 'danger' ? styles.actionLabelDanger : styles.actionLabel]}>
        {label}
      </Text>
    </Pressable>
  );
}

function BackButton({onPress}: {onPress: () => void}): React.ReactElement {
  const [focused, setFocused] = React.useState(false);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Back to Settings"
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      style={[styles.backButton, focused ? focusRing.ring : null]}
    >
      <Text style={[text.body, styles.backLabel]}>{'‹ Settings'}</Text>
    </Pressable>
  );
}

export function ServerScreen({navigation}: ServerScreenProps): React.ReactElement {
  const [apiBaseUrl] = useApiBaseUrl();
  const {markAuthFailed} = useAuthFailed();

  // Read once at mount, the same lazy-init tv-web's `Server.tsx` uses for
  // its own `hasKnownServerGroup` flag -- this screen is the only place
  // that changes it (via `handleForgetServer` below), so a plain `useState`
  // initialiser is enough; there is no external event that could make this
  // stale while the screen is mounted.
  const [knownGroup, setKnownGroup] = useState<KnownServerGroup | undefined>(readKnownServers);
  const knownServers = summariseKnownServers(knownGroup);

  function handleSignOut(): void {
    new TokenStore().clear();
    markAuthFailed();
    // `navigate` (rather than `reset`) bubbles up to whichever ancestor
    // navigator actually owns `ROUTES.link` once `RootNavigator.tsx` (a
    // later, not-yet-built step) exists -- `reset` would only be able to
    // reset THIS screen's own local navigator, which may not contain
    // `Link` at all depending on how that later step nests the settings
    // stack.
    navigation.navigate(ROUTES.link);
  }

  function handleForgetServer(): void {
    forgetGroup();
    setKnownGroup(undefined);
  }

  const hasKnownServers = knownServers.length > 0;

  return (
    <View style={layout.appScreen}>
      <BackButton onPress={navigation.goBack} />

      <View style={styles.header}>
        <Text style={[text.caption, styles.kicker]}>Make it yours</Text>
        <Text style={text.title}>Server connection</Text>
        <Text style={[text.body, styles.description]}>
          Combine libraries from multiple servers in one Playarr interface.
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={text.bodyEmphasis}>Connected server</Text>
        <Text style={[text.body, styles.serverUrl]}>{apiBaseUrl}</Text>
        <Text style={[text.caption, styles.hint]}>
          {apiBaseUrl} remains the primary server for profile and player preferences.
        </Text>

        {hasKnownServers ? (
          <View style={styles.knownServersSection}>
            <Text style={text.bodyEmphasis}>Remembered server addresses</Text>
            {knownServers.map((server) => (
              <View key={server.url} style={styles.knownServerRow}>
                <Text style={text.body}>{server.url}</Text>
                {server.isLastGood ? <Text style={[text.caption, styles.badge]}>Last used</Text> : null}
              </View>
            ))}
            <Text style={[text.caption, styles.hint]}>
              Clears every address remembered for this account's server group. You may be asked for a
              server address again next time.
            </Text>
            <View style={styles.actionRow}>
              <ActionButton label="Forget this server group" autoFocus onPress={handleForgetServer} />
            </View>
          </View>
        ) : null}

        <View style={styles.actionRow}>
          <ActionButton label="Sign out" tone="danger" autoFocus={!hasKnownServers} onPress={handleSignOut} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backButton: {
    alignSelf: 'flex-start',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: colour.surfaceStrong,
    marginBottom: 20,
  },
  backLabel: {
    color: colour.inkSoft,
  },
  header: {
    marginBottom: 32,
  },
  kicker: {
    color: colour.stageKicker,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  description: {
    color: colour.inkSoft,
    marginTop: 8,
    maxWidth: 640,
  },
  card: {
    backgroundColor: colour.surface,
    borderRadius: 12,
    padding: 24,
    maxWidth: 900,
  },
  serverUrl: {
    color: colour.ink,
    marginTop: 8,
  },
  hint: {
    color: colour.inkMuted,
    marginTop: 8,
  },
  knownServersSection: {
    marginTop: 28,
  },
  knownServerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
  },
  badge: {
    color: colour.success,
    marginLeft: 12,
    textTransform: 'uppercase',
  },
  actionRow: {
    flexDirection: 'row',
    marginTop: 20,
  },
  actionButton: {
    paddingVertical: 12,
    paddingHorizontal: 22,
    borderRadius: 8,
    backgroundColor: colour.surfaceStrong,
  },
  actionButtonDanger: {
    backgroundColor: colour.dangerSoft,
  },
  actionLabel: {
    color: colour.ink,
  },
  actionLabelDanger: {
    color: colour.danger,
  },
});
