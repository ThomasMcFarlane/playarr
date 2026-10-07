/**
 * Preferences, drawn like the web's settings workspace: the list of ten sections on the left with the open section's
 * title under the page title, and the section's panel on the right (`clients/tv-web/web/src/pages/settings`).
 * One screen owns the list and swaps the panel in place, like the web's nested route does.
 */
import React, {useEffect, useRef, useState} from 'react';
import {Animated, Easing, Pressable, View} from 'react-native';
import {useNavigation, type NavigationProp, type ParamListBase} from '@amazon-devices/react-navigation__native';
import {useLanguage} from '../i18n/LanguageProvider';
import {useTvBackNavigation} from '../navigation/backPolicy';
import {ROUTES, type RouteName} from '../navigation/routes';
import {useTheme} from '../theme/ThemeProvider';
import {Box, T, u} from '../tv/kit';
import {BackButton} from '../tv/PageHeader';
import {RailFrost, Stage} from '../tv/Stage';
import type {TranslationKey} from '../../../tv-web/web/src/lib/i18n/translations';
import {
  AppearancePanel,
  AvatarPanel,
  InvitePanel,
  LanguagePanel,
  LatencyPanel,
  PlayerPanel,
  ProfileLockPanel,
  RemotePanel,
  ServerPanel,
  YourDataPanel,
} from './settings/panels';

export type SettingsSectionId =
  | 'appearance'
  | 'profile-avatar'
  | 'language'
  | 'player'
  | 'server'
  | 'profile-lock'
  | 'invite'
  | 'request-latency'
  | 'remote'
  | 'your-data';

interface Section {
  id: SettingsSectionId;
  number: string;
  titleKey: TranslationKey;
  descriptionKey: TranslationKey;
  route: RouteName;
}

/** The web's `PRODUCT_SETTINGS_SECTIONS`, in order. */
export const SETTINGS_SECTIONS: readonly Section[] = [
  {id: 'appearance', number: '01', titleKey: 'settings.index.appearance.title', descriptionKey: 'settings.index.appearance.description', route: ROUTES.settingsAppearance},
  {id: 'profile-avatar', number: '02', titleKey: 'settings.index.profileAvatar.title', descriptionKey: 'settings.index.profileAvatar.description', route: ROUTES.settingsAvatar},
  {id: 'language', number: '03', titleKey: 'settings.index.language.title', descriptionKey: 'settings.language.description', route: ROUTES.settingsLanguage},
  {id: 'player', number: '04', titleKey: 'settings.index.player.title', descriptionKey: 'settings.playerPreferences.description', route: ROUTES.settingsPlayer},
  {id: 'server', number: '05', titleKey: 'settings.index.server.title', descriptionKey: 'settings.index.server.description', route: ROUTES.settingsServer},
  {id: 'profile-lock', number: '06', titleKey: 'settings.index.profileLock.title', descriptionKey: 'settings.index.profileLock.description', route: ROUTES.settingsProfileLock},
  {id: 'invite', number: '07', titleKey: 'settings.index.invite.title', descriptionKey: 'settings.index.invite.description', route: ROUTES.settingsInvite},
  {id: 'request-latency', number: '08', titleKey: 'settings.index.requestLatency.title', descriptionKey: 'settings.index.requestLatency.description', route: ROUTES.settingsLatency},
  {id: 'remote', number: '09', titleKey: 'settings.index.remote.title', descriptionKey: 'settings.index.remote.description', route: ROUTES.settingsRemote},
  {id: 'your-data', number: '10', titleKey: 'settings.index.yourData.title', descriptionKey: 'settings.index.yourData.description', route: ROUTES.settingsYourData},
];

const ROW_PITCH = 91.9;
const LIST_TOP = 162;

function Panel({id}: {id: SettingsSectionId}): React.ReactElement {
  switch (id) {
    case 'appearance':
      return <AppearancePanel />;
    case 'profile-avatar':
      return <AvatarPanel />;
    case 'language':
      return <LanguagePanel />;
    case 'player':
      return <PlayerPanel />;
    case 'server':
      return <ServerPanel />;
    case 'profile-lock':
      return <ProfileLockPanel />;
    case 'invite':
      return <InvitePanel />;
    case 'request-latency':
      return <LatencyPanel />;
    case 'remote':
      return <RemotePanel />;
    case 'your-data':
      return <YourDataPanel />;
  }
}

export function SettingsScreen({initial = 'appearance'}: {initial?: SettingsSectionId}): React.ReactElement {
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const {colour, scheme} = useTheme();
  const {t} = useLanguage();
  const [active, setActive] = useState<SettingsSectionId>(initial);
  const [focusedRow, setFocusedRow] = useState<number | null>(null);
  const scroll = useRef(new Animated.Value(0)).current;
  const activeIndex = SETTINGS_SECTIONS.findIndex((section) => section.id === active);
  const activeSection = SETTINGS_SECTIONS[activeIndex] ?? SETTINGS_SECTIONS[0];
  useTvBackNavigation(ROUTES.home);

  useEffect(() => {
    const row = focusedRow ?? activeIndex;
    const bottom = LIST_TOP + (row + 1) * ROW_PITCH;
    const target = bottom > 1040 ? bottom - 1040 : 0;
    Animated.timing(scroll, {toValue: -target, duration: 200, easing: Easing.out(Easing.cubic), useNativeDriver: true}).start();
  }, [focusedRow, activeIndex, scroll]);

  return (
    <Stage>
      <RailFrost dark={scheme === 'dark'} soft={colour.surfaceSoft} strong={colour.surfaceStrong} x={672} />
      <BackButton onPress={() => navigation.navigate(ROUTES.home)} x={153.6} y={56.2} hasTVPreferredFocus accessibilityLabel={t('settings.sectionLayout.backLink')} />
      <View style={{position: 'absolute', left: u(226.6), top: u(56.2)}} pointerEvents="none">
        <T size={33.6} weight={580} ls={-1.512} lh={50.4} color={colour.ink} lines={1}>
          {t('settings.index.title')}
        </T>
        <View style={{marginTop: u(5.5), alignSelf: 'flex-start', borderTopWidth: 1, borderTopColor: colour.lineStrong, paddingTop: u(6.4)}}>
          <T size={13.76} weight={900} ls={0.619} lh={20.6} color={colour.inkMuted} upper>
            {t(activeSection.titleKey)}
          </T>
          <View style={{marginTop: u(4)}}>
            <T size={12.16} weight={480} lh={15.2} color={colour.inkMuted} upper>
              {t(activeSection.descriptionKey)}
            </T>
          </View>
        </View>
      </View>

      <Box x={0} y={0} w={672} h={1080} style={{overflow: 'hidden'}} pointerEvents="box-none">
        <Animated.View style={{transform: [{translateY: scroll}]}} pointerEvents="box-none">
          {SETTINGS_SECTIONS.map((section, index) => (
            <Row
              key={section.id}
              section={section}
              y={LIST_TOP + index * ROW_PITCH}
              active={section.id === active}
              onFocus={() => {
                setFocusedRow(index);
                setActive(section.id);
              }}
              onPress={() => setActive(section.id)}
            />
          ))}
        </Animated.View>
      </Box>

      <Box x={0} y={0} w={1920} h={1080} pointerEvents="box-none">
        <Panel id={active} />
      </Box>
    </Stage>
  );
}

function Row({section, y, active, onFocus, onPress}: {section: Section; y: number; active: boolean; onFocus: () => void; onPress: () => void}): React.ReactElement {
  const {colour} = useTheme();
  const {t} = useLanguage();
  const [focused, setFocused] = useState(false);
  const lit = active || focused;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t(section.titleKey)}
      onFocus={() => {
        setFocused(true);
        onFocus();
      }}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      style={{
        position: 'absolute',
        left: u(153.6),
        top: u(y),
        width: u(480.4),
        height: u(91.9),
        backgroundColor: lit ? colour.surfaceSoft : 'transparent',
      }}
    >
      {focused ? <View style={{position: 'absolute', left: 0, top: 0, bottom: 0, width: u(4), backgroundColor: colour.accent}} /> : null}
      <View style={{position: 'absolute', left: u(32), top: u(23.8)}}>
        <T size={9.92} weight={760} lh={18.4} color={colour.inkMuted}>
          {section.number}
        </T>
      </View>
      <View style={{position: 'absolute', left: u(92), top: u(23.8), width: u(307.6)}}>
        <T size={29.6} weight={480} ls={-1.036} lh={44.4} color={colour.ink} lines={1}>
          {t(section.titleKey)}
        </T>
      </View>
      <View style={{position: 'absolute', left: u(lit ? 432.6 : 427.6), top: u(30.5)}}>
        <T size={20.8} weight={400} lh={31.2} color={lit ? colour.ink : colour.inkMuted}>
          {'→'}
        </T>
      </View>
    </Pressable>
  );
}
