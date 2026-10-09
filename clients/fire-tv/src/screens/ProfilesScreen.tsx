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
import LinearGradient from '@amazon-devices/react-linear-gradient';
import Svg, {Circle as SvgCircle, Defs, RadialGradient, Stop} from '@amazon-devices/react-native-svg';
import {TokenStore} from '@playarr-tv/device-auth';
import {useApiBaseUrl, useAuthFailed} from '../api/ApiClientProvider';
import {useLanguage} from '../i18n/LanguageProvider';
import {mix} from '../theme/color';
import {useTheme, type ThemePreference} from '../theme/ThemeProvider';
import {Icon} from '../shell/icons';
import {PlayarrLogo} from '../shell/Logo';
import {Dropdown} from '../tv/Dropdown';
import {Box, T, u} from '../tv/kit';
import {ROUTES, type RouteName} from '../navigation/routes';
import {APP_SHELL_ROUTE} from '../navigation/AppShellNavigator';
import {AvatarHighlight, ProfileAvatar} from '../components/ProfileAvatar';
import {syncAvatar} from '../lib/profileAvatarPref';
import {TvEmptyState} from '../components/TvEmptyState';

type LoadState = {status: 'loading'} | {status: 'ready'} | {status: 'error'; message: string};

/** Everything this screen needs from a navigation prop -- an explicit generic override on `useNavigation`, deliberately NOT the package's own default `NavigationProp<ReactNavigation.RootParamList>`: that default resolves against a GLOBAL `RootParamList` interface no navigator in this build-order pass has augmented yet (it is declared as the empty `interface RootParamList {}` in `@amazon-devices/react-navigation__core`'s own types), which would make `navigate()` reject every real route name at compile time until `RootNavigator.tsx` (a later step) exists and augments it. This minimal shape is a structural subset of the real thing `RootNavigator`'s eventual `NavigationProp` will satisfy regardless. */
interface ProfilesNavigation {
  navigate: {
    (route: RouteName): void;
    (route: typeof APP_SHELL_ROUTE, params: {screen: RouteName}): void;
  };
}

function safeFourDigitPin(value: string): string {
  return value.replace(/\D/g, '').slice(0, 4);
}

const styles = StyleSheet.create({
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


/** `.profile-avatar-button` + its avatar: lifts and scales when selected, with the web's pink 4px ring. */
function ProfileChoice({
  profile,
  selected,
  onSelect,
  onFocus,
}: {
  profile: AvailableProfile;
  selected: boolean;
  onSelect: (profile: AvailableProfile) => void;
  onFocus: () => void;
}) {
  const {colour} = useTheme();
  const {t} = useLanguage();
  return (
    <Pressable
      hasTVPreferredFocus={profile.is_current}
      onFocus={onFocus}
      onPress={() => onSelect(profile)}
      accessibilityRole="button"
      accessibilityLabel={profile.display_name || profile.username}
      style={{width: u(244), alignItems: 'center', transform: selected ? [{translateY: u(-8)}, {scale: 1.045}] : []}}
    >
      <View
        style={{
          width: u(244),
          height: u(244),
          borderRadius: 999,
          transform: selected ? [{scale: 1.035}] : [],
          borderWidth: selected ? u(4) : 0,
          borderColor: mix('#cf3157', 0.42),
        }}
      >
        <ProfileAvatar profileId={profile.id} size={selected ? u(236) : u(244)} style={selected ? undefined : undefined} />
      </View>
      <View style={{marginTop: u(8.8)}}>
        <T size={17.28} weight={680} color={selected ? colour.ink : colour.inkSoft} lh={27.1} lines={1}>
          {profile.display_name || profile.username}
        </T>
      </View>
      <View style={{marginTop: u(8.8), minHeight: u(14.7)}}>
        <T size={9.408} weight={690} ls={0.423} color={colour.inkMuted} upper lh={14.7}>
          {profile.is_current ? t('pages.profiles.statusCurrent') : profile.pin_locked ? 'PIN required' : ''}
        </T>
      </View>
    </Pressable>
  );
}

function AddProfileTile({selected, onFocus, onPress}: {selected: boolean; onFocus: () => void; onPress: () => void}) {
  const {colour} = useTheme();
  const {t} = useLanguage();
  return (
    <Pressable
      onFocus={onFocus}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={t('pages.profiles.signIn')}
      style={{width: u(244), alignItems: 'center', transform: selected ? [{translateY: u(-8)}, {scale: 1.045}] : []}}
    >
      <View
        style={{
          width: u(244),
          height: u(244),
          borderRadius: 999,
          borderWidth: selected ? u(4) : 1,
          borderStyle: selected ? 'solid' : 'dashed',
          borderColor: selected ? mix('#cf3157', 0.42) : mix(colour.lineStrong, 0.66),
          overflow: 'hidden',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <LinearGradient
          style={{position: 'absolute', left: 0, top: 0, right: 0, bottom: 0}}
          start={{x: 0, y: 0}}
          end={{x: 1, y: 1}}
          colors={[blendToward(colour.surfaceStrong, '#cf3157', 0.16), '#a82655']}
        />
        <AvatarHighlight size={u(244)} />
        <T size={76.8} weight={300} color={colour.inkSoft} lh={115.2}>
          +
        </T>
      </View>
      <View style={{marginTop: u(8.8)}}>
        <T size={17.28} weight={680} color={selected ? colour.ink : colour.inkSoft} lh={25.9}>
          {t('pages.profiles.signIn')}
        </T>
      </View>
      <View style={{marginTop: u(8.8)}}>
        <T size={9.408} weight={690} ls={0.423} color={colour.inkMuted} upper lh={14.1}>
          {t('pages.profiles.addAnotherProfile')}
        </T>
      </View>
    </Pressable>
  );
}

function blendToward(a: string, b: string, fraction: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (shift: number) => Math.round(((pa >> shift) & 255) * (1 - fraction) + ((pb >> shift) & 255) * fraction);
  return `rgb(${ch(16)}, ${ch(8)}, ${ch(0)})`;
}

/** `.profile-action-button`: a round button that fills with the ink colour on focus. */
function ActionButton({
  w,
  x,
  y,
  children,
  label,
  onPress,
  danger,
}: {
  w: number;
  x: number;
  y: number;
  children: (ink: string) => React.ReactNode;
  label: string;
  onPress: () => void;
  danger?: boolean;
}) {
  const {colour} = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      style={{
        position: 'absolute',
        left: u(x),
        top: u(y),
        width: u(w),
        height: u(44),
        borderRadius: 999,
        borderWidth: 1,
        borderColor: mix(colour.lineStrong, 0.7),
        backgroundColor: focused ? (danger ? colour.danger : mix(colour.ink, 0.88)) : mix(colour.surfaceStrong, 0.64),
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        transform: [{scale: focused ? 1.07 : 1}],
      }}
    >
      {children(focused ? (danger ? '#ffffff' : colour.bg) : colour.inkSoft)}
    </Pressable>
  );
}

const THEME_OPTIONS = ['system', 'light', 'dark'] as const;

export function ProfilesScreen(): React.ReactElement {
  const client = useApiClient();
  const [apiBaseUrl] = useApiBaseUrl();
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
        const signedIn = available.find((profile) => profile.is_current);
        if (signedIn) void syncAvatar(client, apiBaseUrl, signedIn.id).catch(() => undefined);
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
        // The root stack only knows `Link`, `Profiles` and the shell route;
        // `Home` lives inside the shell, so a bare `navigate('Home')` is a no-op.
        navigation.navigate(APP_SHELL_ROUTE, {screen: ROUTES.home});
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

  const {colour, preference, setPreference} = useTheme();
  const {t, preference: languagePreference} = useLanguage();
  const {markAuthFailed} = useAuthFailed();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const current = profiles.find((profile) => profile.is_current);
  const activeId = selectedId ?? current?.id ?? null;
  const themeLabel = (value: string): string =>
    value === 'light' ? t('components.themeDropdown.optionLight') : value === 'dark' ? t('components.themeDropdown.optionDark') : t('components.themeDropdown.optionSystem');
  const count = profiles.length + 1;
  const rowWidth = count * 244 + (count - 1) * 42.24;
  const rowX = 960 - rowWidth / 2;
  const background = colour.bg;

  return (
    <View style={{flex: 1, backgroundColor: background}}>
      <LinearGradient
        style={{position: 'absolute', left: 0, top: 0, right: 0, bottom: 0}}
        start={{x: 0.2033, y: -0.2532}}
        end={{x: 0.7967, y: 1.2532}}
        colors={[colour.surface, colour.bg, colour.bg]}
        locations={[0, 0.72, 1]}
      />
      <Svg width={u(1920)} height={u(1080)} style={{position: 'absolute', left: 0, top: 0}}>
        <Defs>
          <RadialGradient id="profiles-glow" cx={u(960)} cy={u(518.4)} r={u(378)} gradientUnits="userSpaceOnUse">
            <Stop offset="0" stopColor="#cf3157" stopOpacity={0.13} />
            <Stop offset="1" stopColor="#cf3157" stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <SvgCircle cx={u(960)} cy={u(518.4)} r={u(378)} fill="url(#profiles-glow)" />
      </Svg>
      <LinearGradient
        style={{position: 'absolute', left: 0, top: 0, right: 0, bottom: 0}}
        start={{x: 0, y: 0}}
        end={{x: 1, y: 0}}
        colors={[mix(colour.bg, 0.94), mix(colour.bg, 0)]}
        locations={[0, 0.25]}
        pointerEvents="none"
      />
      <LinearGradient
        style={{position: 'absolute', left: 0, top: 0, right: 0, bottom: 0}}
        start={{x: 0, y: 1}}
        end={{x: 0, y: 0}}
        colors={[mix(colour.bg, 0.9), mix(colour.bg, 0)]}
        locations={[0, 0.26]}
        pointerEvents="none"
      />

      <Box x={60.6} y={60.2} w={42} h={42}>
        <PlayarrLogo size={u(42)} />
      </Box>
      <Dropdown
        x={1551.8}
        y={49.7}
        w={144}
        icon="theme"
        label={themeLabel(preference)}
        options={THEME_OPTIONS.map((id) => ({id, label: themeLabel(id)}))}
        selectedId={preference}
        onSelect={(id) => setPreference(id as ThemePreference)}
        accessibilityLabel={t('components.themeDropdown.label')}
      />
      <Dropdown
        x={1709.8}
        y={49.7}
        w={168}
        icon="sites"
        label={languagePreference === 'system' ? t('settings.language.optionSystem') : String(languagePreference)}
        options={[{id: 'system', label: t('settings.language.optionSystem')}]}
        selectedId="system"
        onSelect={() => undefined}
        accessibilityLabel="Language"
      />

      <View style={{position: 'absolute', left: 0, right: 0, top: u(162), alignItems: 'center'}} pointerEvents="none">
        <T size={10.368} weight={820} ls={1.348} color="#cf3157" upper lh={15.6}>
          {t('pages.profiles.title')}
        </T>
        <View style={{marginTop: u(7.2)}}>
          <T size={80.64} weight={500} ls={-5.806} lh={76.6} color={colour.ink}>
            {t('pages.profiles.heading')}
          </T>
        </View>
      </View>

      {loadState.status === 'error' ? (
        <Box x={560} y={420} w={800}>
          <TvEmptyState variant="page" tone="error" graphic="details" title="Could not load profiles" description={loadState.message} />
        </Box>
      ) : (
        <TvFocusScope autoFocus>
          <View style={{position: 'absolute', left: u(rowX), top: u(382.4), flexDirection: 'row'}}>
            {profiles.map((profile, index) => (
              <View key={profile.id} style={{marginRight: u(42.24)}}>
                <ProfileChoice profile={profile} selected={activeId === profile.id} onSelect={selectProfile} onFocus={() => setSelectedId(profile.id)} />
              </View>
            ))}
            <AddProfileTile selected={activeId === null && selectedId === 'add'} onFocus={() => setSelectedId('add')} onPress={() => navigation.navigate(ROUTES.link)} />
          </View>
        </TvFocusScope>
      )}

      {current ? (
        <>
          <ActionButton
            x={rowX + (profiles.findIndex((profile) => profile.id === current.id) * (244 + 42.24)) + 122 - 77}
            y={704}
            w={44}
            label="Preferences"
            onPress={() => navigation.navigate(APP_SHELL_ROUTE, {screen: ROUTES.settings})}
          >
            {() => <Icon name="settings" size={u(18)} color="#cf3157" strokeWidth={1.7} />}
          </ActionButton>
          <ActionButton
            x={rowX + (profiles.findIndex((profile) => profile.id === current.id) * (244 + 42.24)) + 122 - 77 + 52.8}
            y={704}
            w={101.2}
            danger
            label={t('settings.account.signOut')}
            onPress={() => {
              new TokenStore().clear();
              markAuthFailed();
              navigation.navigate(ROUTES.link);
            }}
          >
            {(ink) => (
              <>
                <Icon name="signOut" size={u(18)} color={ink} strokeWidth={1.7} />
                <View style={{marginLeft: u(7.2)}}>
                  <T size={10.752} weight={720} color={ink} lh={16.1}>
                    {t('settings.account.signOut')}
                  </T>
                </View>
              </>
            )}
          </ActionButton>
        </>
      ) : null}

      {loadState.status === 'loading' ? (
        <View style={{position: 'absolute', left: 0, right: 0, top: u(1010), alignItems: 'center'}}>
          <T size={9.28} color={colour.inkMuted}>
            {t('pages.profiles.loading')}
          </T>
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
