/**
 * `/settings/profile-lock` (design doc §7: "4-digit PIN"). Ported against
 * tv-web's `settings/ProfileLock.tsx`, which round-trips the real
 * `ApiClient.getProfilePinSetting`/`updateProfilePinSetting` methods
 * (`ProfilePinSettingResponse.pin_locked`, `UpdateProfilePinRequest.pin` --
 * confirmed directly against the generated OpenAPI schema: "Exactly four
 * ASCII decimal digits. `null` removes the profile lock."). This screen
 * calls the exact same two methods; nothing about the PIN's own storage or
 * verification changes on this client.
 *
 * What DOES change, per this task's own brief ("a 4-digit PIN entry usable
 * via D-pad"): tv-web enters the PIN through a masked `<input type=
 * "password" inputMode="numeric">`, which assumes a keyboard (physical or
 * on-screen IME) the user types into. A Fire TV remote has neither -- its
 * only universal input is the D-pad plus Select/Back. Rather than pulling
 * in `com.amazon.inputmethod.service` (the on-screen-keyboard manifest
 * entry `SearchScreen.tsx`, a concurrent sibling screen, needs for
 * free-text search) just to type four digits, this screen renders a
 * focusable numeric keypad: twelve cells in the familiar phone-keypad
 * layout (1-9, back, 0, submit), each an ordinary focusable Vega already
 * knows how to move a D-pad cursor around (design doc §4.4 -- there is no
 * custom navigation logic below; Vega's own Cartesian focus engine places
 * these exactly the way it places any other grid of focusables). Select
 * presses whichever cell has focus.
 *
 * The PIN itself is never rendered -- entered digits show as filled dots,
 * matching the masking tv-web's `type="password"` field gives for free.
 *
 * `navigation` is an explicit prop rather than a `useNavigation()` call, and
 * the keypad's first cell uses `Pressable`'s own `hasTVPreferredFocus`
 * rather than `platform/focus.tsx`'s `TvFocusScope` -- both match the
 * convention `LibraryScreen.tsx`/`SearchScreen.tsx`/`NotFoundScreen.tsx`
 * (concurrent sibling screens) already settled on. See
 * `SettingsIndexScreen.tsx`'s top comment for the full rationale, including
 * the real, reproducible `TvFocusScope` rendering bug that convention
 * avoids.
 */
import React, {useEffect, useRef, useState} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {ApiError} from '@playarr-tv/api-client';
import {useApiClient} from '../../api/ApiClientProvider';
import {colour} from '../../theme/tokens';
import {focusRing, layout, text} from '../../theme/styles';

export interface ProfileLockScreenNavigation {
  goBack: () => void;
}

export interface ProfileLockScreenProps {
  navigation: ProfileLockScreenNavigation;
}

const PIN_LENGTH = 4;

/**
 * Pure PIN-buffer logic, exported and kept apart from the component for the
 * same reason `remoteKeyMap.ts` is kept apart from `remote.ts`: it is
 * fully testable with no rendering and no native module involved at all.
 * Appending past `PIN_LENGTH`, or a non-digit, is a silent no-op rather
 * than an error -- the keypad below physically cannot produce a non-digit
 * press, and the submit button is disabled before the buffer reaches
 * `PIN_LENGTH`, so both guards exist for this function's own correctness
 * under direct unit test, not because either path is reachable from the
 * real UI.
 */
export function appendPinDigit(pin: string, digit: string): string {
  if (pin.length >= PIN_LENGTH) return pin;
  if (!/^[0-9]$/.test(digit)) return pin;
  return pin + digit;
}

/** Removes the most recently entered digit, if any -- a no-op on an already-empty buffer. */
export function removeLastPinDigit(pin: string): string {
  return pin.slice(0, -1);
}

/** Exactly `PIN_LENGTH` ASCII decimal digits -- mirrors the server's own `UpdateProfilePinRequest.pin` contract precisely, so a submit this accepts never fails server-side validation for its shape. */
export function isCompletePin(pin: string): boolean {
  return new RegExp(`^\\d{${PIN_LENGTH}}$`).test(pin);
}

type KeypadCell = {kind: 'digit'; value: string} | {kind: 'backspace'} | {kind: 'submit'};

const KEYPAD_LAYOUT: readonly KeypadCell[] = [
  {kind: 'digit', value: '1'},
  {kind: 'digit', value: '2'},
  {kind: 'digit', value: '3'},
  {kind: 'digit', value: '4'},
  {kind: 'digit', value: '5'},
  {kind: 'digit', value: '6'},
  {kind: 'digit', value: '7'},
  {kind: 'digit', value: '8'},
  {kind: 'digit', value: '9'},
  {kind: 'backspace'},
  {kind: 'digit', value: '0'},
  {kind: 'submit'},
];

type ProfilePinState =
  | {status: 'loading'}
  | {status: 'ready'}
  | {status: 'saving'}
  | {status: 'error'; message: string};

interface PinDotsProps {
  pin: string;
}

function PinDots({pin}: PinDotsProps): React.ReactElement {
  return (
    <View style={styles.dotsRow}>
      {Array.from({length: PIN_LENGTH}, (_unused, index) => (
        <View key={index} style={[styles.dot, index < pin.length ? styles.dotFilled : null]} />
      ))}
    </View>
  );
}

interface KeypadButtonProps {
  cell: KeypadCell;
  disabled: boolean;
  autoFocus: boolean;
  onPress: () => void;
}

function keypadCellLabel(cell: KeypadCell): string {
  return cell.kind === 'digit' ? cell.value : cell.kind === 'backspace' ? '⌫' : '✓';
}

function keypadCellAccessibilityLabel(cell: KeypadCell): string {
  if (cell.kind === 'digit') return `Digit ${cell.value}`;
  if (cell.kind === 'backspace') return 'Delete last digit';
  return 'Confirm PIN';
}

function KeypadButton({cell, disabled, autoFocus, onPress}: KeypadButtonProps): React.ReactElement {
  const [focused, setFocused] = React.useState(false);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={keypadCellAccessibilityLabel(cell)}
      hasTVPreferredFocus={autoFocus}
      disabled={disabled}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      style={[
        styles.key,
        cell.kind === 'submit' ? styles.keySubmit : null,
        focused ? focusRing.ring : null,
        disabled ? styles.keyDisabled : null,
      ]}
    >
      <Text style={[text.title, styles.keyLabel]}>{keypadCellLabel(cell)}</Text>
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

export function ProfileLockScreen({navigation}: ProfileLockScreenProps): React.ReactElement {
  const client = useApiClient();

  const [pin, setPin] = useState('');
  const [pinLocked, setPinLocked] = useState(false);
  const [pinState, setPinState] = useState<ProfilePinState>({status: 'loading'});
  const requestIdRef = useRef(0);

  useEffect(() => {
    const requestId = ++requestIdRef.current;
    setPinState({status: 'loading'});

    client
      .getProfilePinSetting()
      .then((setting) => {
        if (requestIdRef.current !== requestId) return;
        setPinLocked(setting.pin_locked);
        setPinState({status: 'ready'});
      })
      .catch((error: unknown) => {
        if (requestIdRef.current !== requestId) return;
        setPinState({status: 'error', message: error instanceof ApiError ? error.message : String(error)});
      });
  }, [client]);

  const busy = pinState.status === 'loading' || pinState.status === 'saving';

  async function submitPin(): Promise<void> {
    if (busy || !isCompletePin(pin)) return;
    const requestId = ++requestIdRef.current;
    setPinState({status: 'saving'});
    try {
      const setting = await client.updateProfilePinSetting({pin});
      if (requestIdRef.current !== requestId) return;
      setPinLocked(setting.pin_locked);
      setPin('');
      setPinState({status: 'ready'});
    } catch (error) {
      if (requestIdRef.current !== requestId) return;
      setPinState({status: 'error', message: error instanceof ApiError ? error.message : String(error)});
    }
  }

  async function removePin(): Promise<void> {
    if (busy) return;
    const requestId = ++requestIdRef.current;
    setPinState({status: 'saving'});
    try {
      const setting = await client.updateProfilePinSetting({pin: null});
      if (requestIdRef.current !== requestId) return;
      setPinLocked(setting.pin_locked);
      setPin('');
      setPinState({status: 'ready'});
    } catch (error) {
      if (requestIdRef.current !== requestId) return;
      setPinState({status: 'error', message: error instanceof ApiError ? error.message : String(error)});
    }
  }

  function handleKeyPress(cell: KeypadCell): void {
    if (busy) return;
    if (cell.kind === 'digit') {
      setPin((current) => appendPinDigit(current, cell.value));
      return;
    }
    if (cell.kind === 'backspace') {
      setPin((current) => removeLastPinDigit(current));
      return;
    }
    void submitPin();
  }

  const statusMessage =
    pinState.status === 'loading'
      ? 'Loading profile lock…'
      : pinState.status === 'saving'
        ? 'Updating profile lock…'
        : pinState.status === 'error'
          ? pinState.message
          : pinLocked
            ? 'PIN lock is on.'
            : 'PIN lock is off.';

  return (
    <View style={layout.appScreen}>
      <BackButton onPress={navigation.goBack} />

      <View style={styles.header}>
        <Text style={[text.caption, styles.kicker]}>Make it yours</Text>
        <Text style={text.title}>Profile lock</Text>
        <Text style={[text.body, styles.description]}>
          Require a four-digit PIN before switching to this profile.
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={text.bodyEmphasis}>{pinLocked ? 'Replace PIN' : 'New PIN'}</Text>
        <PinDots pin={pin} />

        <View style={styles.keypad}>
          {KEYPAD_LAYOUT.map((cell, index) => (
            <KeypadButton
              key={index}
              cell={cell}
              autoFocus={index === 0}
              disabled={busy || (cell.kind === 'submit' && !isCompletePin(pin))}
              onPress={() => handleKeyPress(cell)}
            />
          ))}
        </View>

        <Text style={[text.caption, pinState.status === 'error' ? styles.errorText : styles.hint]}>
          {statusMessage}
        </Text>

        {pinLocked ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Remove PIN"
            disabled={busy}
            onPress={() => void removePin()}
            style={[styles.removeButton, busy ? styles.keyDisabled : null]}
          >
            <Text style={[text.body, styles.removeLabel]}>Remove PIN</Text>
          </Pressable>
        ) : null}
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
    maxWidth: 480,
    alignItems: 'center',
  },
  dotsRow: {
    flexDirection: 'row',
    marginTop: 20,
    marginBottom: 24,
  },
  dot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colour.inkMuted,
    marginHorizontal: 8,
  },
  dotFilled: {
    backgroundColor: colour.ink,
    borderColor: colour.ink,
  },
  keypad: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    width: 3 * 76,
    justifyContent: 'center',
  },
  key: {
    width: 64,
    height: 64,
    borderRadius: 32,
    margin: 6,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colour.surfaceStrong,
  },
  keySubmit: {
    backgroundColor: colour.accent,
  },
  keyDisabled: {
    opacity: 0.4,
  },
  keyLabel: {
    color: colour.ink,
  },
  hint: {
    color: colour.inkMuted,
    marginTop: 16,
  },
  errorText: {
    color: colour.danger,
    marginTop: 16,
  },
  removeButton: {
    marginTop: 20,
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
    backgroundColor: colour.dangerSoft,
  },
  removeLabel: {
    color: colour.danger,
  },
});
