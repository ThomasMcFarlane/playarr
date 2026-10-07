/**
 * The ten settings panels, drawn at the web's measurements (`clients/tv-web/web/src/pages/settings/*`). Each panel is
 * positioned in screen pixels: its content starts at x = 773.8, y = 210.
 */
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {Pressable, ScrollView, View} from 'react-native';
import {ApiError} from '@playarr-tv/api-client';
import {TokenStore} from '@playarr-tv/device-auth';
import {useApiBaseUrl, useApiClient} from '../../api/ApiClientProvider';
import {ProfileAvatar} from '../../components/ProfileAvatar';
import {PROFILE_AVATAR_PRESETS, type ProfileAvatarPresetId} from '../../components/profileAvatarPresets';
import {useLanguage} from '../../i18n/LanguageProvider';
import {readPlayerDefaults, writePlayerDefaults, type PlayerDefaults} from '../../lib/playerDefaults';
import {QUALITY_TIERS} from '../../lib/qualityMatrix';
import {saveAvatarPreset} from '../../lib/profileAvatarPref';
import {mix} from '../../theme/color';
import {useTheme, type ThemePreference} from '../../theme/ThemeProvider';
import {Dropdown} from '../../tv/Dropdown';
import {Button, Divider, Field, FormLabel, Hint, Muted, SectionTitle, Segmented} from '../../tv/forms';
import {Box, T, u} from '../../tv/kit';

const HOME_VIEW_KEY = 'playarr.homeView';

export function readHomeView(): 'thumbnail' | 'cover' {
  return typeof localStorage !== 'undefined' && localStorage.getItem(HOME_VIEW_KEY) === 'cover' ? 'cover' : 'thumbnail';
}

function PanelBox({children, w = 995}: {children: React.ReactNode; w?: number}): React.ReactElement {
  return (
    <Box x={773.8} y={210} w={w}>
      {children}
    </Box>
  );
}

function Gap({h}: {h: number}): React.ReactElement {
  return <View style={{height: u(h)}} />;
}

export function AppearancePanel(): React.ReactElement {
  const {preference, setPreference, colour} = useTheme();
  const {t} = useLanguage();
  const [homeView, setHomeView] = useState(readHomeView);
  const label = (id: ThemePreference): string =>
    id === 'light' ? t('components.themeDropdown.optionLight') : id === 'dark' ? t('components.themeDropdown.optionDark') : t('components.themeDropdown.optionSystem');
  return (
    <PanelBox>
      <SectionTitle>{t('settings.appearance.colourThemeLabel')}</SectionTitle>
      <Gap h={16.2} />
      <Segmented
        accessibilityLabel={t('settings.appearance.colourThemeLabel')}
        value={preference}
        options={(['system', 'light', 'dark'] as const).map((id) => ({id, label: label(id)}))}
        onChange={setPreference}
      />
      <Gap h={30.2} />
      <Divider />
      <Gap h={30.2} />
      <SectionTitle>{t('settings.appearance.homeViewTitle')}</SectionTitle>
      <Gap h={5.6} />
      <T size={13.12} weight={400} lh={20.3} color={colour.inkMuted}>
        {t('settings.appearance.homeViewDescription')}
      </T>
      <Gap h={16.2} />
      <Segmented
        accessibilityLabel={t('settings.appearance.homeViewAriaLabel')}
        value={homeView}
        options={[
          {id: 'thumbnail', label: t('settings.appearance.homeViewThumbnail')},
          {id: 'cover', label: t('settings.appearance.homeViewCover')},
        ]}
        onChange={(next) => {
          setHomeView(next);
          if (typeof localStorage === 'undefined') return;
          if (next === 'thumbnail') localStorage.removeItem(HOME_VIEW_KEY);
          else localStorage.setItem(HOME_VIEW_KEY, next);
        }}
      />
    </PanelBox>
  );
}

export function AvatarPanel(): React.ReactElement {
  const client = useApiClient();
  const [apiBaseUrl] = useApiBaseUrl();
  const {colour} = useTheme();
  const {t} = useLanguage();
  const [userId, setUserId] = useState<string | undefined>(undefined);
  const [chosen, setChosen] = useState<ProfileAvatarPresetId | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    client
      .listAvailableProfiles()
      .then((profiles) => {
        if (cancelled) return;
        const current = profiles.find((profile) => profile.is_current);
        if (current) setUserId(current.id);
      })
      .catch(() => undefined);
    client
      .getProfileAvatar()
      .then((remote) => {
        if (cancelled) return;
        const preference = remote.preference;
        if (preference && preference.kind === 'preset') setChosen(preference.value as ProfileAvatarPresetId);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [client]);
  const order: readonly ProfileAvatarPresetId[] = PROFILE_AVATAR_PRESETS.map((preset) => preset.id);
  return (
    <>
      {order.map((id, index) => {
        const active = chosen === id;
        const size = active ? 173.3 : 163.5;
        const col = index % 4;
        const row = Math.floor(index / 4);
        return (
          <AvatarChoice
            key={id}
            id={id}
            active={active}
            x={(active ? 768.8 : 773.8) + col * 185.5}
            y={(active ? 205.1 : 210) + row * 185.5}
            size={size}
            userId={userId}
            onPress={() => {
              setChosen(id);
              if (userId) void saveAvatarPreset(client, apiBaseUrl, userId, id).catch(() => undefined);
            }}
            label={t(`settings.profileAvatar.preset.${id}` as 'settings.profileAvatar.preset.cat')}
          />
        );
      })}
      <Box x={773.8} y={591.4} w={995}>
        <T size={19.2} weight={400} lh={28.8} color={colour.inkMuted}>
          {t('settings.profileAvatar.deviceNote')}
        </T>
      </Box>
    </>
  );
}

function AvatarChoice(props: {
  id: ProfileAvatarPresetId;
  active: boolean;
  x: number;
  y: number;
  size: number;
  userId: string | undefined;
  label: string;
  onPress: () => void;
}): React.ReactElement {
  const {colour} = useTheme();
  const [focused, setFocused] = useState(false);
  const lit = props.active || focused;
  const inner = props.size - 19;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={props.onPress}
      style={{
        position: 'absolute',
        left: u(props.x),
        top: u(props.y),
        width: u(props.size),
        height: u(props.size),
        borderRadius: 999,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: lit ? u(3) : 1,
        borderColor: lit ? '#cf3157' : mix(colour.lineStrong, 0.66),
        transform: [{scale: focused && !props.active ? 1.06 : 1}],
      }}
    >
      <ProfileAvatar profileId={props.userId ?? props.id} presetId={props.id} size={u(inner)} />
    </Pressable>
  );
}

export function LanguagePanel(): React.ReactElement {
  const {preference, language, setPreference, t} = useLanguage();
  const options = [{id: 'system', label: t('settings.language.optionSystem')}];
  return (
    <>
      <Dropdown
        x={773.8}
        y={210}
        w={168}
        icon="sites"
        label={preference === 'system' ? t('settings.language.optionSystem') : String(preference)}
        options={options}
        selectedId={preference === 'system' ? 'system' : String(preference)}
        onSelect={(id) => setPreference(id as typeof preference)}
        accessibilityLabel={t('settings.index.language.title')}
      />
      <Box x={773.8} y={288.2} w={995}>
        <Hint>{t('settings.language.autoHint', {language: String(language)} as never)}</Hint>
      </Box>
    </>
  );
}

const AUDIO_LANGUAGES = [
  ['en', 'English'],
  ['es', 'Spanish'],
  ['fr', 'French'],
  ['de', 'German'],
  ['it', 'Italian'],
  ['pt', 'Portuguese'],
  ['ja', 'Japanese'],
  ['ko', 'Korean'],
  ['zh', 'Chinese'],
  ['hi', 'Hindi'],
  ['ar', 'Arabic'],
  ['th', 'Thai'],
] as const;

function ChoiceCard({
  selected,
  w,
  h,
  children,
  onPress,
  radius = 10,
}: {
  selected: boolean;
  w: number;
  h: number;
  children: React.ReactNode;
  onPress: () => void;
  radius?: number;
}): React.ReactElement {
  const {colour} = useTheme();
  const [focused, setFocused] = useState(false);
  const lit = selected || focused;
  return (
    <Pressable
      accessibilityRole="button"
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      style={{
        width: u(w),
        height: u(h),
        borderRadius: u(radius),
        borderWidth: 1,
        borderColor: lit ? '#cf3157' : mix(colour.line, 1),
        borderLeftWidth: selected ? u(4) : 1,
        backgroundColor: lit ? mix('#cf3157', 0.14) : colour.surface,
        justifyContent: 'center',
        paddingHorizontal: u(10.4),
        transform: [{scale: focused ? 1.01 : 1}],
      }}
    >
      {children}
    </Pressable>
  );
}

export function PlayerPanel(): React.ReactElement {
  const client = useApiClient();
  const {colour} = useTheme();
  const {t} = useLanguage();
  const [defaults, setDefaults] = useState<PlayerDefaults>(readPlayerDefaults);
  const [audio, setAudio] = useState<string>('en');
  const requestRef = useRef(0);
  useEffect(() => {
    let cancelled = false;
    client
      .getPlayerPreferences()
      .then((preferences) => {
        if (!cancelled && preferences.preferred_audio_language) setAudio(preferences.preferred_audio_language);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [client]);
  const update = useCallback((patch: Partial<PlayerDefaults>) => {
    setDefaults((current) => {
      const next = {...current, ...patch};
      writePlayerDefaults(next);
      return next;
    });
  }, []);
  const changeAudio = useCallback(
    (language: string) => {
      setAudio(language);
      const id = ++requestRef.current;
      client.updatePlayerPreferences({preferred_audio_language: language}).catch((error: unknown) => {
        if (requestRef.current === id) console.warn(error instanceof ApiError ? error.message : String(error));
      });
    },
    [client]
  );
  const levels = ['low', 'medium', 'high'] as const;
  const levelLabel = {low: t('quality.level.low'), medium: t('quality.level.medium'), high: t('quality.level.high')};
  const tierLabel = {sd: t('quality.tier.sd'), hd: t('quality.tier.hd'), fhd: t('quality.tier.fhd'), uhd: t('quality.tier.uhd')};
  return (
    <ScrollView style={{position: 'absolute', left: 0, top: 0, width: u(1920), height: u(1080)}} contentContainerStyle={{height: u(1700)}} showsVerticalScrollIndicator={false}>
      <Box x={773.8} y={210} w={995}>
        <SectionTitle>{t('settings.playerPreferences.qualityTitle')}</SectionTitle>
        <Gap h={5.2} />
        <T size={13.12} weight={400} lh={20.3} color={colour.inkMuted}>
          {t('settings.playerPreferences.qualityDescription')}
        </T>
        <Gap h={19.5} />
        <ChoiceCard selected={defaults.qualityId === 'original'} w={995} h={60} onPress={() => update({qualityId: 'original'})}>
          <T size={12.48} weight={700} lh={18.7} color={colour.ink}>
            {t('quality.original')}
          </T>
          <T size={9.28} weight={400} lh={13.9} color={colour.inkMuted}>
            {t('quality.originalDetail')}
          </T>
          {defaults.qualityId === 'original' ? (
            <View style={{position: 'absolute', right: u(18), top: u(20)}}>
              <T size={11.84} weight={400} color="#cf3157">
                {'✓'}
              </T>
            </View>
          ) : null}
        </ChoiceCard>
      </Box>
      <Box x={968.8} y={363} w={800}>
        <View style={{flexDirection: 'row'}}>
          {levels.map((level) => (
            <View key={level} style={{width: u(268.7), alignItems: 'center'}}>
              <T size={10.24} weight={760} ls={0.819} lh={27.5} color={colour.inkMuted} upper>
                {levelLabel[level]}
              </T>
            </View>
          ))}
        </View>
      </Box>
      {QUALITY_TIERS.map((tier, row) => (
        <React.Fragment key={tier.id}>
          <Box x={777.8} y={409.5 + row * 66}>
            <T size={12.16} weight={760} lh={18.2} color={colour.ink}>
              {tierLabel[tier.id]}
            </T>
            <T size={9.28} weight={400} lh={13.9} color={colour.inkMuted}>
              {tier.resolution}
            </T>
          </Box>
          {tier.options.map((option, column) => (
            <Box key={option.id} x={968.8 + column * 268.65} y={396.5 + row * 66}>
              <ChoiceCard selected={defaults.qualityId === option.id} w={262.6} h={60} onPress={() => update({qualityId: option.id})}>
                <T size={12.48} weight={700} lh={18.7} color={colour.inkSoft}>
                  {`${option.bitrateMbps} Mbps`}
                </T>
                <T size={9.28} weight={400} lh={13.9} color={colour.inkMuted}>
                  {levelLabel[option.level]}
                </T>
              </ChoiceCard>
            </Box>
          ))}
        </React.Fragment>
      ))}
      <Box x={773.8} y={685}>
        <Divider />
      </Box>
      <Box x={773.8} y={715} w={995}>
        <SectionTitle>{t('settings.playerPreferences.subtitlesTitle')}</SectionTitle>
        <Gap h={5.2} />
        <T size={13.12} weight={400} lh={20.3} color={colour.inkMuted}>
          {t('settings.playerPreferences.subtitlesDescription')}
        </T>
      </Box>
      {(
        [
          ['off', t('settings.playerPreferences.subtitlesOff')],
          ['forced', t('settings.playerPreferences.subtitlesForced')],
          ['always', t('settings.playerPreferences.subtitlesAlways')],
        ] as const
      ).map(([id, label], index) => (
        <Box key={id} x={773.8 + index * 251.5} y={801}>
          <ChoiceCard selected={defaults.subtitleMode === id} w={239} h={68} radius={2} onPress={() => update({subtitleMode: id})}>
            <T size={12.8} weight={700} color={colour.ink}>
              {label}
            </T>
          </ChoiceCard>
        </Box>
      ))}
      <Box x={773.8} y={899}>
        <Divider />
      </Box>
      <Box x={773.8} y={929} w={995}>
        <SectionTitle>{t('settings.playerPreferences.audioTitle')}</SectionTitle>
        <Gap h={5.2} />
        <T size={13.12} weight={400} lh={20.3} color={colour.inkMuted}>
          {t('settings.playerPreferences.audioDescription')}
        </T>
      </Box>
      {AUDIO_LANGUAGES.map(([code, name], index) => (
        <Box key={code} x={773.8 + (index % 2) * 503.5} y={1015 + Math.floor(index / 2) * 74}>
          <ChoiceCard selected={audio === code} w={491} h={62} radius={2} onPress={() => changeAudio(code)}>
            <T size={14.4} weight={600} color={colour.ink}>
              {name}
            </T>
            <View style={{position: 'absolute', right: u(30), top: u(24)}}>
              <T size={8.8} weight={700} ls={0.9} color={audio === code ? '#cf3157' : colour.inkMuted} upper>
                {code}
              </T>
            </View>
          </ChoiceCard>
        </Box>
      ))}
    </ScrollView>
  );
}

export function ServerPanel(): React.ReactElement {
  const [apiBaseUrl] = useApiBaseUrl();
  const {colour} = useTheme();
  const {t} = useLanguage();
  const [host, setHost] = useState('');
  return (
    <>
      <Box x={773.8} y={210} w={900}>
        <View style={{borderWidth: 1, borderColor: colour.line, backgroundColor: colour.line, padding: 1}}>
          <View style={{height: u(98.9), backgroundColor: colour.surface, paddingLeft: u(18), paddingTop: u(16), paddingRight: u(18)}}>
            <T size={19.2} weight={700} lh={28.8} color={colour.ink}>
              {'Playarr Server'}
            </T>
            <View style={{height: u(3)}} />
            <T size={10.56} weight={400} lh={15.8} color={colour.inkMuted}>
              {''}
            </T>
            <View style={{height: u(3.2)}} />
            <T size={10.56} weight={400} lh={15.8} color={colour.inkMuted} lines={1}>
              {apiBaseUrl}
            </T>
            <View style={{position: 'absolute', right: u(18), top: u(33.8)}}>
              <T size={10.56} weight={400} lh={15.8} color={colour.inkMuted}>
                {t('settings.server.primaryBadge')}
              </T>
            </View>
          </View>
        </View>
      </Box>
      <Box x={773.8} y={341.1} w={900}>
        <FormLabel>{t('settings.server.addAnotherServer')}</FormLabel>
        <Gap h={7.2} />
        <View style={{flexDirection: 'row', backgroundColor: colour.line, padding: 0}}>
          <Field w={399.5} placeholder={t('settings.server.serverAddressPlaceholder')} value={host} onChangeText={setHost} autoCapitalize="none" />
          <Field w={199.8} placeholder="Username" autoCapitalize="none" style={{marginLeft: 1}} />
          <Field w={199.8} placeholder={t('settings.server.passwordPlaceholder')} secureTextEntry style={{marginLeft: 1}} />
          <View style={{marginLeft: 1}}>
            <Button label={t('settings.server.connect')} w={98} h={62} />
          </View>
        </View>
        <Gap h={0} />
        <View style={{marginTop: u(1)}}>
          <Hint w={900}>{t('settings.server.credentialsHint')}</Hint>
        </View>
        <Gap h={30} />
        <Button label={t('settings.server.testConnection')} variant="secondary" />
      </Box>
    </>
  );
}

export function ProfileLockPanel(): React.ReactElement {
  const client = useApiClient();
  const {colour} = useTheme();
  const {t} = useLanguage();
  const [locked, setLocked] = useState<boolean | null>(null);
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let cancelled = false;
    client
      .getProfilePinSetting()
      .then((setting) => {
        if (!cancelled) setLocked(setting.pin_locked);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [client]);
  const save = async (next: string | null): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      const setting = await client.updateProfilePinSetting({pin: next});
      setLocked(setting.pin_locked);
      setPin('');
    } catch {
      // The panel keeps showing the last known state.
    } finally {
      setBusy(false);
    }
  };
  return (
    <Box x={773.8} y={210} w={420}>
      <FormLabel>{locked ? t('settings.profileLock.replacePinLabel') : t('settings.profileLock.newPinLabel')}</FormLabel>
      <Gap h={7.2} />
      <View style={{flexDirection: 'row', backgroundColor: colour.line}}>
        <Field w={325.2} value={pin} onChangeText={(value) => setPin(value.replace(/\D/g, '').slice(0, 4))} keyboardType="number-pad" secureTextEntry maxLength={4} />
        <View style={{marginLeft: 1}}>
          <Button label={locked ? t('settings.profileLock.replace') : t('settings.profileLock.setPin')} w={93.8} h={62} onPress={() => pin.length === 4 && void save(pin)} />
        </View>
      </View>
      <Gap h={33.8} />
      <Muted w={420}>{locked ? t('settings.profileLock.lockOn') : t('settings.profileLock.lockOff')}</Muted>
      {locked ? (
        <View style={{marginTop: u(16)}}>
          <Button label={t('settings.profileLock.removePin')} variant="secondary" onPress={() => void save(null)} />
        </View>
      ) : null}
    </Box>
  );
}

export function InvitePanel(): React.ReactElement {
  const {t} = useLanguage();
  const {colour} = useTheme();
  return (
    <PanelBox>
      <Muted>{t('settings.invite.statusNone')}</Muted>
      <Gap h={30.2} />
      <FormLabel>{t('settings.invite.messageLabel')}</FormLabel>
      <Gap h={0} />
      <Field w={995} h={62} placeholder={t('settings.invite.messagePlaceholder')} multiline />
      <Gap h={43} />
      <Button label={t('settings.invite.requestQr')} w={995} h={58} />
      <Gap h={30} />
      <Button label={t('settings.invite.enablePush')} variant="secondary" />
      <View style={{height: 0, opacity: 0}}>
        <T size={1} color={colour.ink}>
          {''}
        </T>
      </View>
    </PanelBox>
  );
}

export function LatencyPanel(): React.ReactElement {
  const {colour} = useTheme();
  const {t} = useLanguage();
  return (
    <Box x={901.1} y={210} w={800}>
      <View style={{flexDirection: 'row', alignItems: 'center'}}>
        <View style={{width: u(164), height: u(164), borderRadius: u(40), backgroundColor: mix(colour.surfaceStrong, 0.8), borderWidth: 1, borderColor: colour.line}} />
        <View style={{marginLeft: u(42), width: u(219.3)}}>
          <T size={22.08} weight={650} ls={-0.4416} lh={33.1} color={colour.ink}>
            {t('settings.requestLatency.forbiddenTitle')}
          </T>
          <View style={{height: u(7)}} />
          <T size={10.752} weight={400} lh={16.1} color={colour.inkMuted}>
            {t('settings.requestLatency.forbiddenDescription')}
          </T>
        </View>
      </View>
    </Box>
  );
}

function Checkbox({checked, label, onPress}: {checked: boolean; label: string; onPress?: () => void}): React.ReactElement {
  const {colour} = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{checked}}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      style={{flexDirection: 'row', alignItems: 'center', height: u(34), alignSelf: 'flex-start'}}
    >
      <View
        style={{
          width: u(20),
          height: u(20),
          borderWidth: 1,
          borderColor: focused ? colour.accent : colour.lineStrong,
          backgroundColor: checked ? colour.accent : colour.bg,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {checked ? (
          <T size={13} weight={700} color={colour.onAccent}>
            {'\u2713'}
          </T>
        ) : null}
      </View>
      <View style={{marginLeft: u(12)}}>
        <T size={19.2} weight={400} lh={28.8} color={colour.ink}>
          {label}
        </T>
      </View>
    </Pressable>
  );
}

export function RemotePanel(): React.ReactElement {
  const {t} = useLanguage();
  const [host, setHost] = useState(false);
  return (
    <PanelBox>
      <SectionTitle small>{t('remote.host.title')}</SectionTitle>
      <Gap h={30.5} />
      <Checkbox checked={host} label={t('remote.host.toggle')} onPress={() => setHost((value) => !value)} />
      <Gap h={25} />
      <Hint>{t('remote.host.hint')}</Hint>
      <Gap h={96} />
      <SectionTitle small>{t('remote.targets.title')}</SectionTitle>
      <Gap h={30} />
      <Muted>{t('remote.targets.empty')}</Muted>
      <Gap h={86} />
      <SectionTitle small>{t('remote.pairings.title')}</SectionTitle>
      <Gap h={30} />
      <Muted>{t('remote.pairings.empty')}</Muted>
    </PanelBox>
  );
}

export function YourDataPanel(): React.ReactElement {
  const {t} = useLanguage();
  return (
    <ScrollView style={{position: 'absolute', left: 0, top: 0, width: u(1920), height: u(1080)}} contentContainerStyle={{height: u(1300)}} showsVerticalScrollIndicator={false}>
      <Box x={773.8} y={210} w={995}>
        <SectionTitle small>{t('settings.yourData.exportTitle')}</SectionTitle>
        <Gap h={30} />
        <Muted>{t('settings.yourData.exportDescription')}</Muted>
        <Gap h={30} />
        <Hint>{t('settings.yourData.scopeNote')}</Hint>
        <Gap h={30} />
        <Button label={t('settings.yourData.exportStart')} />
      </Box>
      <Box x={773.8} y={564.7} w={995}>
        <SectionTitle small>{t('settings.yourData.importTitle')}</SectionTitle>
        <Gap h={30} />
        <Muted>{t('settings.yourData.importDescription')}</Muted>
        <Gap h={30} />
        <Button label={t('settings.yourData.transferStartUpload')} />
        <Gap h={30} />
        <FormLabel>{t('settings.yourData.conflictsLabel')}</FormLabel>
        <Gap h={0} />
        <Field w={995} h={62} value={t('settings.yourData.conflictsNewest')} editable={false} />
        <Gap h={30} />
        <Checkbox checked={false} label={t('settings.yourData.includePreferences')} />
        <Gap h={30} />
        <Button label={t('settings.yourData.previewButton')} variant="secondary" h={58} />
      </Box>
    </ScrollView>
  );
}

// Customise Home (owner ruling 2026-10-08): the rail order and visibility the web keeps on its own page, as a settings panel.
type RailEntry = {id: string; title: string; hidden: boolean};

function moveRail(entries: RailEntry[], id: string, direction: -1 | 1): RailEntry[] {
  const index = entries.findIndex((entry) => entry.id === id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= entries.length) return entries;
  const next = [...entries];
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}

export function CustomiseHomePanel(): React.ReactElement {
  const client = useApiClient();
  const {language, t} = useLanguage();
  const {colour} = useTheme();
  const [rails, setRails] = useState<RailEntry[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    client
      .getRailPreferences(language)
      .then((prefs) => {
        if (!cancelled) setRails(prefs.rails as RailEntry[]);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [client, language]);

  const save = useCallback(
    (next: RailEntry[]) => {
      setRails(next);
      setError(false);
      client
        .saveRailPreferences({order: next.map((entry) => entry.id), hidden: next.filter((entry) => entry.hidden).map((entry) => entry.id)})
        .catch(() => setError(true));
    },
    [client],
  );

  const reset = useCallback(() => {
    setError(false);
    client
      .resetRailPreferences()
      .then(() => client.getRailPreferences(language))
      .then((prefs) => setRails(prefs.rails as RailEntry[]))
      .catch(() => setError(true));
  }, [client, language]);

  return (
    <PanelBox>
      <Muted>{t('pages.home.customise.hint')}</Muted>
      <Gap h={16} />
      {rails === null && !error ? (
        <T size={13.12} weight={400} color={colour.inkMuted}>
          {t('pages.home.customise.loading')}
        </T>
      ) : null}
      {(rails ?? []).map((rail, index) => (
        <View key={rail.id} style={{flexDirection: 'row', alignItems: 'center', height: u(48), opacity: rail.hidden ? 0.55 : 1}}>
          <View style={{width: u(420)}}>
            <T size={15.36} weight={560} color={colour.ink} lines={1}>
              {rail.title}
            </T>
          </View>
          <Button
            variant="secondary"
            w={84}
            label={rail.hidden ? t('pages.home.customise.show') : t('pages.home.customise.hide')}
            onPress={() => save(rails!.map((entry) => (entry.id === rail.id ? {...entry, hidden: !entry.hidden} : entry)))}
          />
          <View style={{width: u(12)}} />
          <Button variant="secondary" w={44} label={'↑'} disabled={index === 0} onPress={() => save(moveRail(rails!, rail.id, -1))} />
          <View style={{width: u(12)}} />
          <Button variant="secondary" w={44} label={'↓'} disabled={index === rails!.length - 1} onPress={() => save(moveRail(rails!, rail.id, 1))} />
        </View>
      ))}
      <Gap h={20} />
      <Button variant="secondary" label={t('pages.home.customise.reset')} onPress={reset} />
      {error ? (
        <View style={{marginTop: u(12)}}>
          <T size={13.12} weight={400} color={colour.accent}>
            {t('pages.home.error.title')}
          </T>
        </View>
      ) : null}
    </PanelBox>
  );
}
