/**
 * The very first screen a freshly-installed Fire TV shows: hosted,
 * first-contact device linking (design doc §5.1/§5.3). Structural port of
 * tv-web's `DeviceLogin.tsx` -- one effect, `AbortController` teardown, an
 * `attempt` counter driving retry, three render states -- adapted for RN/TV
 * rather than re-derived: the wire protocol lives in `../auth/hostedLink`,
 * the server-claim/session-persistence steps live in `../auth/session`,
 * both already fully tested on their own; this file's job is purely to
 * drive that state machine and render it.
 *
 * There is no "operator-configured server, skip hosted linking" branch here
 * the way tv-web's `DeviceLogin` has (`shouldUseHostedDeviceLink`): Fire TV
 * has no build-time-baked server address concept at all (`appConfig.ts`
 * carries no such field), so this screen always takes the hosted-link path.
 *
 * i18n is deliberately NOT wired in here -- `src/i18n/LanguageProvider.tsx`
 * does not exist yet in this pass (design doc's build order places it in a
 * later, Features-phase step alongside navigation/HomeScreen); every string
 * below is plain English, matching this pass's honest scope rather than
 * pre-guessing a translation-key naming scheme nobody has settled on yet.
 */
import * as React from 'react';
import {useCallback, useEffect, useState} from 'react';
import {ActivityIndicator, Text, TouchableOpacity, View} from 'react-native';
import {useNavigation} from '@amazon-devices/react-navigation__native';
import {useApiBaseUrl} from '../api/ApiClientProvider';
import {requestFireTvHostedLinkCode, pollHostedDeviceLink, type HostedLinkCode} from '../auth/hostedLink';
import {commitLinkedSession, completeServerDeviceLink} from '../auth/session';
import {QrCode} from '../components/QrCode';
import {ROUTES} from '../navigation/routes';
import {TvFocusScope, useBackHandler} from '../platform';
import {colour, spacing} from '../theme/tokens';
import {layout, text} from '../theme/styles';
import {sh, sw} from '../theme/scale';

/**
 * The one navigation capability this screen needs. Typed this narrowly,
 * rather than importing a `RootParamList` that does not exist yet
 * (`navigation/RootNavigator.tsx` -- the file that would declare one -- is a
 * later, Features-phase step per design doc's build order), so this screen
 * neither invents that contract early nor leaves `navigation` typed as
 * `any` everywhere it's touched.
 */
interface LinkScreenNavigation {
  reset: (state: {index: number; routes: Array<{name: string}>}) => void;
}

type LinkState =
  | {status: 'creating'}
  | {status: 'ready'; code: HostedLinkCode}
  | {status: 'error'; message: string};

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

export function LinkScreen(): React.ReactElement {
  const navigation = useNavigation<LinkScreenNavigation>();
  const [, setApiBaseUrl] = useApiBaseUrl();
  const [state, setState] = useState<LinkState>({status: 'creating'});
  const [attempt, setAttempt] = useState(0);

  // Back has nowhere to go from here -- this is the very first screen a
  // freshly-installed Fire TV shows, before any session exists. Returning
  // `false` lets Vega's own default back behaviour proceed (exiting the
  // app), rather than this screen swallowing the press and leaving the
  // viewer stuck looking at a QR code with no way out.
  useBackHandler(() => false);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    setState({status: 'creating'});

    void (async () => {
      const code = await requestFireTvHostedLinkCode();
      if (cancelled) return;
      setState({status: 'ready', code});

      const claim = await pollHostedDeviceLink(code, {signal: controller.signal});
      if (cancelled) return;

      const token = await completeServerDeviceLink(claim, code, {signal: controller.signal});
      if (cancelled) return;

      commitLinkedSession({token, claim, setApiBaseUrl});
      navigation.reset({index: 0, routes: [{name: ROUTES.profiles}]});
    })().catch((reason: unknown) => {
      if (!cancelled) setState({status: 'error', message: errorMessage(reason)});
    });

    return () => {
      cancelled = true;
      controller.abort();
    };
    // `navigation`/`setApiBaseUrl` are stable across renders for the real
    // `useNavigation()`/`useApiBaseUrl()` implementations this screen is
    // actually mounted with; re-running this effect only on `attempt`
    // (the Retry button's own signal) matches tv-web's `DeviceLogin`
    // exactly, which keys its identical effect on `[attempt, client]`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  return (
    <View style={[layout.appScreen, styles.centered]}>
      <Text style={[text.subtitle, styles.kicker]}>PAIR THIS DEVICE</Text>
      <Text style={text.display}>
        <Text style={styles.brandAccent}>Play</Text>arr
      </Text>

      {state.status === 'creating' && (
        <View style={styles.statusBlock}>
          <ActivityIndicator color={colour.focusRing} size="large" />
          <Text style={[text.body, styles.statusText]}>Getting your Playarr code…</Text>
        </View>
      )}

      {state.status === 'ready' && (
        <View style={styles.linkBlock}>
          <QrCode value={state.code.verificationUriComplete} size={220} accessibilityLabel="Pairing QR code" />
          <View style={styles.linkInstructions}>
            <Text style={[text.body, styles.mutedText]}>
              Scan the QR code, or visit this address on your phone or computer:
            </Text>
            <Text style={[text.bodyEmphasis, styles.linkUrl]}>{state.code.verificationUri}</Text>
            <Text style={[text.body, styles.mutedText]}>and enter this code:</Text>
            <Text
              style={[text.display, styles.userCode]}
              accessibilityLabel={`Pairing code ${state.code.userCode}`}
            >
              {state.code.userCode}
            </Text>
            <Text style={[text.caption, styles.mutedText]}>Waiting for approval…</Text>
          </View>
        </View>
      )}

      {state.status === 'error' && (
        <View style={styles.statusBlock}>
          <Text style={[text.body, styles.errorText]}>{state.message}</Text>
          <TvFocusScope autoFocus>
            <TouchableOpacity accessibilityRole="button" onPress={retry} style={styles.retryButton}>
              <Text style={[text.bodyEmphasis, styles.retryButtonText]}>Try again</Text>
            </TouchableOpacity>
          </TvFocusScope>
        </View>
      )}
    </View>
  );
}

const styles = {
  centered: {
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  kicker: {
    color: colour.inkMuted,
    letterSpacing: 2,
    marginBottom: sh(spacing.xs),
  },
  brandAccent: {
    color: colour.navAccent,
  },
  statusBlock: {
    marginTop: sh(spacing.xl),
    alignItems: 'center' as const,
    gap: sh(spacing.md),
  },
  statusText: {
    color: colour.inkSoft,
  },
  linkBlock: {
    marginTop: sh(spacing.xl),
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: sw(spacing.xl),
  },
  linkInstructions: {
    maxWidth: sw(560),
    gap: sh(spacing.xs),
  },
  mutedText: {
    color: colour.inkSoft,
  },
  linkUrl: {
    color: colour.ink,
  },
  userCode: {
    color: colour.ink,
    letterSpacing: 4,
  },
  errorText: {
    color: colour.danger,
    textAlign: 'center' as const,
    maxWidth: sw(640),
  },
  retryButton: {
    marginTop: sh(spacing.md),
    paddingHorizontal: sw(spacing.lg),
    paddingVertical: sh(spacing.sm),
    borderRadius: 8,
    backgroundColor: colour.accentSoft,
  },
  retryButtonText: {
    color: colour.onAccent,
  },
};
