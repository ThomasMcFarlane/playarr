/**
 * The full-page state shown instead of the app while the signed-in profile is blocked (outside its schedule, or its daily
 * budget is used up): the web's `HouseholdBlockedScreen`. The shell chrome stays; the profile can ask a guardian for more
 * time or switch profile.
 */
import React, {useState} from 'react';
import {Pressable, View} from 'react-native';
import type {ApiClient, HouseholdStatus} from '@playarr-tv/api-client';
import {useLanguage} from '../i18n/LanguageProvider';
import {approvalSubjectFor, householdBlockFromStatus} from '../lib/householdState';
import {mix} from '../theme/color';
import {useTheme} from '../theme/ThemeProvider';
import {EmptyState} from '../tv/EmptyState';
import {Box, T, u} from '../tv/kit';
import {Stage} from '../tv/Stage';

function formatUntil(iso: string | null, language: string): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleString(language === 'en' ? 'en-GB' : language);
}

function Pill({label, onPress, disabled, hasTVPreferredFocus, w}: {label: string; onPress: () => void; disabled?: boolean; hasTVPreferredFocus?: boolean; w: number}): React.ReactElement {
  const {colour} = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      hasTVPreferredFocus={hasTVPreferredFocus}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      style={{
        width: u(w),
        height: u(50),
        marginRight: u(12),
        borderRadius: 999,
        borderWidth: 1,
        borderColor: focused ? colour.ink : mix(colour.ink, 0.5),
        backgroundColor: focused ? colour.ink : 'transparent',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: disabled ? 0.5 : 1,
        transform: [{scale: focused ? 1.04 : 1}],
      }}
    >
      <T size={17.28} weight={500} color={focused ? colour.bg : colour.ink}>
        {label}
      </T>
    </Pressable>
  );
}

export function HouseholdBlockedScreen({client, status, onSwitchProfile}: {client: ApiClient; status: HouseholdStatus; onSwitchProfile: () => void}): React.ReactElement | null {
  const {t, language} = useLanguage();
  const {colour} = useTheme();
  const block = householdBlockFromStatus(status);
  const [request, setRequest] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  if (!block) return null;
  const until = formatUntil(block.until, language);
  const title = block.kind === 'outside_schedule' ? t('household.blocked.scheduleTitle') : t('household.blocked.budgetTitle');
  const description =
    block.kind === 'outside_schedule'
      ? until
        ? t('household.blocked.scheduleDescription', {time: until})
        : t('household.blocked.scheduleDescriptionNoTime')
      : until
        ? t('household.blocked.budgetDescription', {time: until})
        : t('household.blocked.budgetDescriptionNoTime');

  const ask = (): void => {
    setRequest('sending');
    client
      .createHouseholdApproval({kind: 'time', subject: approvalSubjectFor(block.kind)})
      .then(() => setRequest('sent'))
      .catch(() => setRequest('error'));
  };

  return (
    <Stage>
      <EmptyState x={0} width={1920} y={130} title={title} description={description} />
      <View style={{position: 'absolute', left: u(723), top: u(314), flexDirection: 'row'}}>
        <Pill hasTVPreferredFocus w={295} label={t('household.blocked.askGuardian')} disabled={request === 'sending' || request === 'sent'} onPress={ask} />
        <Pill w={167} label={t('household.blocked.switchProfile')} onPress={onSwitchProfile} />
      </View>
      {request === 'sent' || request === 'error' ? (
        <Box x={723} y={382} w={600}>
          <T size={12} weight={400} color={request === 'error' ? colour.accent : colour.inkMuted}>
            {request === 'sent' ? t('household.blocked.requestSent') : t('pages.workDetail.playbackOptionsLoadError')}
          </T>
        </Box>
      ) : null}
    </Stage>
  );
}
