/**
 * The profile-selection screen -- design doc §7: "Six gradient presets
 * rendered at runtime via linear-gradient -- no pre-baked PNGs needed
 * (unlike Roku)". Structural cousin of
 * `clients/tv-web/web/src/pages/Profiles.tsx`, reduced to what this build-
 * order pass can honestly support -- see "Deliberate scope narrowing"
 * below, which matters enough to read before touching this file.
 *
 * ── Deliberate scope narrowing (read this before extending the screen) ──
 *
 * `src/auth/**` -- the profile-session store that would let this device
 * remember a SEPARATE saved login per profile (`playarr.profileSessions.v4`
 * in design doc §5.4, `isSaved`/`switchProfile` in the web app's
 * `ApiClientProvider`) -- does not exist in this build-order pass.
 * `ApiClientProvider.tsx`'s own doc comment already states this gap
 * explicitly for the whole app: "does NOT yet implement... multi-profile
 * switching... needs state... that only exists after a later step builds
 * `src/auth/**`". This screen inherits that same honest limitation rather
 * than inventing a parallel, throwaway session store to paper over it.
 *
 * Concretely, that means: `GET /api/v1/users/profiles` returns every
 * household profile (they are real, independent Streamarr accounts -- see
 * `list_available_profiles_handler`'s own doc comment in
 * `backend/crates/streamarr-api/src/users.rs` -- NOT Netflix-style sub-
 * profiles under one login), but this device has only ONE authenticated
 * session at a time (whichever profile `LinkScreen`'s hosted device-link
 * flow most recently authenticated as). Selecting the CURRENT profile
 * needs no further authentication -- it proceeds straight to
 * `ROUTES.home` (after a PIN check, if `pin_locked`). Selecting ANY other
 * profile cannot complete on this client without a saved session for
 * that profile that does not exist yet, so it routes back to
 * `ROUTES.link` to re-authenticate via the hosted QR flow -- fire-tv has
 * no keyboard-first login screen at all (design doc §7: "there is no
 * keyboard-first login path"), so the hosted link flow is the only
 * available "become this profile" mechanism regardless. This mirrors the
 * web app's own `continueToLogin` fallback for `!profile.isSaved` exactly,
 * just unconditionally rather than only for profiles this device has never
 * saved a session for -- because on THIS client, as of this pass, no
 * profile has ever been "saved" in that sense.
 *
 * The day `src/auth/**` lands with a real profile-session store, this
 * screen's `selectProfile` is exactly where that store's "is this profile
 * saved on this device" check replaces the current "is it the profile we
 * are already authenticated as" check -- the PIN-prompt and navigation
 * plumbing around it do not need to change.
 */
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {useNavigation} from '@amazon-devices/react-navigation__core';
import type {AvailableProfile} from '@playarr-tv/api-client';
import {useApiClient} from '../api/ApiClientProvider';
import {TvFocusScope, useBackHandler} from '../platform';
import {colour} from '../theme/tokens';
import {layout, text as textStyle} from '../theme/styles';
import {sw} from '../theme/scale';
import {ROUTES, type RouteName} from '../navigation/routes';
import {ProfileAvatar} from '../components/ProfileAvatar';
import {TvEmptyState} from '../components/TvEmptyState';

type LoadState = {status: 'loading'} | {status: 'ready'} | {status: 'error'; message: string};

/** Everything this screen needs from a navigation prop -- an explicit generic override on `useNavigation`, deliberately NOT the package's own default `NavigationProp<ReactNavigation.RootParamList>`: that default resolves against a GLOBAL `RootParamList` interface no navigator in this build-order pass has augmented yet (it is declared as the empty `interface RootParamList {}` in `@amazon-devices/react-navigation__core`'s own types), which would make `navigate()` reject every real route name at compile time until `RootNavigator.tsx` (a later step) exists and augments it. This minimal shape is a structural subset of the real thing `RootNavigator`'s eventual `NavigationProp` will satisfy regardless. */
interface ProfilesNavigation {
  navigate: (route: RouteName) => void;
}

function safeFourDigitPin(value: string): string {
  return value.replace(/\D/g, '').slice(0, 4);
}

const styles = StyleSheet.create({
  container: {
    ...layout.appScreen,
  },
  kicker: {
    ...textStyle.caption,
    color: colour.inkMuted,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
  },
  heading: {
    ...textStyle.display,
    marginTop: sw(8),
    marginBottom: sw(40),
  },
  row: {
    flexDirection: 'row',
    gap: sw(28),
    alignItems: 'flex-start',
  },
  choice: {
    alignItems: 'center',
    width: sw(140),
  },
  choiceFocused: {
    transform: [{scale: 1.08}],
  },
  avatarFocusRing: {
    borderWidth: 3,
    borderColor: colour.focusRing,
    borderRadius: 999,
  },
  name: {
    ...textStyle.bodyEmphasis,
    marginTop: sw(12),
    textAlign: 'center',
  },
  status: {
    ...textStyle.caption,
    color: colour.inkMuted,
    marginTop: sw(2),
    textAlign: 'center',
  },
  addGlyph: {
    ...textStyle.display,
    color: colour.inkMuted,
  },
  addTile: {
    width: 96,
    height: 96,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: colour.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sw(10),
    marginTop: sw(24),
  },
  loadingLabel: {
    ...textStyle.caption,
    color: colour.inkMuted,
  },
  pinBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.72)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinDialog: {
    width: 360,
    padding: sw(28),
    borderRadius: 6,
    backgroundColor: colour.surfaceStrong,
    alignItems: 'center',
  },
  pinTitle: {
    ...textStyle.title,
    marginTop: sw(14),
  },
  pinPrompt: {
    ...textStyle.caption,
    color: colour.inkMuted,
    marginTop: sw(4),
  },
  pinInput: {
    ...textStyle.display,
    color: colour.ink,
    marginTop: sw(20),
    letterSpacing: 12,
    textAlign: 'center',
    minWidth: 180,
  },
  pinError: {
    ...textStyle.caption,
    color: colour.danger,
    marginTop: sw(10),
  },
  pinSubmit: {
    marginTop: sw(20),
    paddingVertical: sw(10),
    paddingHorizontal: sw(28),
    borderRadius: 999,
    backgroundColor: colour.accent,
  },
  pinSubmitLabel: {
    ...textStyle.bodyEmphasis,
    color: colour.onAccent,
  },
});

function ProfileChoice({
  profile,
  onSelect,
}: {
  profile: AvailableProfile;
  onSelect: (profile: AvailableProfile) => void;
}) {
  const [focused, setFocused] = useState(false);

  return (
    <Pressable
      style={[styles.choice, focused ? styles.choiceFocused : null]}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={() => onSelect(profile)}
      accessibilityRole="button"
      accessibilityLabel={profile.display_name || profile.username}
    >
      <View style={focused ? styles.avatarFocusRing : null}>
        <ProfileAvatar profileId={profile.id} />
      </View>
      <Text style={styles.name} numberOfLines={1}>
        {profile.display_name || profile.username}
      </Text>
      <Text style={styles.status}>
        {profile.is_current ? 'Current' : profile.pin_locked ? 'PIN required' : 'Sign in required'}
      </Text>
    </Pressable>
  );
}

function AddProfileTile({onPress}: {onPress: () => void}) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      style={[styles.choice, focused ? styles.choiceFocused : null]}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Sign in with another account"
    >
      <View style={[styles.addTile, focused ? styles.avatarFocusRing : null]}>
        <Text style={styles.addGlyph}>+</Text>
      </View>
      <Text style={styles.name}>Sign in</Text>
    </Pressable>
  );
}

export function ProfilesScreen(): React.ReactElement {
  const client = useApiClient();
  const navigation = useNavigation<ProfilesNavigation>();
  const [profiles, setProfiles] = useState<AvailableProfile[]>([]);
  const [loadState, setLoadState] = useState<LoadState>({status: 'loading'});
  const [pinTarget, setPinTarget] = useState<AvailableProfile | null>(null);
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  const [pinSubmitting, setPinSubmitting] = useState(false);
  const pinInputRef = useRef<TextInput>(null);

  // Fetching GET /api/v1/users/profiles is a genuine synchronisation with
  // an external system (the network), the one case the repo's own
  // derive-during-render rule (CLAUDE.md) carves out for useEffect.
  useEffect(() => {
    let cancelled = false;
    setLoadState({status: 'loading'});
    client
      .listAvailableProfiles()
      .then((available) => {
        if (cancelled) return;
        setProfiles(available);
        setLoadState({status: 'ready'});
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setLoadState({
          status: 'error',
          message: error instanceof Error ? error.message : 'Could not load profiles.',
        });
      });
    return () => {
      cancelled = true;
    };
  }, [client]);

  const proceedWithProfile = useCallback(
    (profile: AvailableProfile) => {
      if (profile.is_current) {
        navigation.navigate(ROUTES.home);
        return;
      }
      // See this file's top doc comment: no profile-session store exists
      // yet, so becoming any profile other than the one already
      // authenticated needs a fresh hosted-link authentication.
      navigation.navigate(ROUTES.link);
    },
    [navigation]
  );

  const selectProfile = useCallback(
    (profile: AvailableProfile) => {
      if (profile.pin_locked) {
        setPin('');
        setPinError(null);
        setPinTarget(profile);
        return;
      }
      proceedWithProfile(profile);
    },
    [proceedWithProfile]
  );

  const closePinPrompt = useCallback(() => {
    setPinTarget(null);
    setPin('');
    setPinError(null);
    setPinSubmitting(false);
  }, []);

  useBackHandler(() => {
    if (pinTarget) {
      closePinPrompt();
      return true;
    }
    return false;
  });

  const submitPin = useCallback(async () => {
    if (!pinTarget || pin.length !== 4 || pinSubmitting) return;
    setPinSubmitting(true);
    setPinError(null);
    try {
      const result = await client.verifyProfilePin(pinTarget.id, {pin});
      if (!result.verified) {
        setPinError('Incorrect PIN.');
        setPinSubmitting(false);
        return;
      }
      const profile = pinTarget;
      closePinPrompt();
      proceedWithProfile(profile);
    } catch (error) {
      setPinError(error instanceof Error ? error.message : 'Could not verify PIN.');
      setPinSubmitting(false);
    }
  }, [client, pin, pinTarget, pinSubmitting, closePinPrompt, proceedWithProfile]);

  return (
    <View style={styles.container}>
      <Text style={styles.kicker}>Playarr</Text>
      <Text style={styles.heading}>Who's watching?</Text>

      {loadState.status === 'error' ? (
        <TvEmptyState
          variant="page"
          tone="error"
          graphic="details"
          title="Could not load profiles"
          description={loadState.message}
        />
      ) : (
        <TvFocusScope autoFocus>
          <View style={styles.row}>
            {profiles.map((profile) => (
              <ProfileChoice key={profile.id} profile={profile} onSelect={selectProfile} />
            ))}
            <AddProfileTile onPress={() => navigation.navigate(ROUTES.link)} />
          </View>
        </TvFocusScope>
      )}

      {loadState.status === 'loading' ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator color={colour.ink} />
          <Text style={styles.loadingLabel}>Loading profiles…</Text>
        </View>
      ) : null}

      <Modal visible={pinTarget !== null} transparent animationType="fade" onRequestClose={closePinPrompt}>
        <View style={styles.pinBackdrop}>
          {pinTarget ? (
            <TvFocusScope autoFocus trap={['up', 'down', 'left', 'right']}>
              <View style={styles.pinDialog}>
                <ProfileAvatar profileId={pinTarget.id} size={72} />
                <Text style={styles.pinTitle}>{pinTarget.display_name || pinTarget.username}</Text>
                <Text style={styles.pinPrompt}>Enter your 4-digit PIN</Text>
                <TextInput
                  ref={pinInputRef}
                  style={styles.pinInput}
                  value={pin}
                  onChangeText={(value) => setPin(safeFourDigitPin(value))}
                  keyboardType="number-pad"
                  secureTextEntry
                  maxLength={4}
                  autoFocus
                />
                {pinError ? <Text style={styles.pinError}>{pinError}</Text> : null}
                <Pressable
                  style={styles.pinSubmit}
                  disabled={pin.length !== 4 || pinSubmitting}
                  onPress={() => void submitPin()}
                  accessibilityRole="button"
                  accessibilityLabel="Continue"
                >
                  <Text style={styles.pinSubmitLabel}>
                    {pinSubmitting ? 'Checking…' : 'Continue'}
                  </Text>
                </Pressable>
              </View>
            </TvFocusScope>
          ) : null}
        </View>
      </Modal>
    </View>
  );
}
