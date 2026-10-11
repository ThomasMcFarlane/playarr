/**
 * The title page's playback settings (the web's `MoviePlaybackSettingsDrawer`): quality, audio and subtitle choices for the
 * film's file in a 430 px drawer, saved as the viewer's remembered selections for that file.
 */
import React, {useEffect, useState} from 'react';
import {View} from 'react-native';
import type {MediaPlaybackOptions} from '@playarr-tv/api-client';
import {useApiClient} from '../api/ApiClientProvider';
import {useLanguage} from '../i18n/LanguageProvider';
import {FilterDrawer, type DrawerSection} from '../tv/FilterDrawer';
import {Button} from '../tv/forms';
import {T, u} from '../tv/kit';
import {useTheme} from '../theme/ThemeProvider';

export interface PlaybackDraft {
  quality_id: string;
  audio_track_id: string | null;
  subtitle_track_id: string | null;
}

export type PlaybackOptionsState = {status: 'idle' | 'loading'} | {status: 'ready'; options: MediaPlaybackOptions} | {status: 'error'; message: string};

export function draftOf(options: MediaPlaybackOptions): PlaybackDraft {
  return {
    quality_id: options.preferences.quality_id,
    audio_track_id: options.preferences.audio_track_id ?? null,
    subtitle_track_id: options.preferences.subtitle_track_id ?? null,
  };
}

/** How playback should start for the saved selections: the chosen transcoding profile, or the original file. */
export function launchQuality(options: MediaPlaybackOptions | null): {qualityId?: string; profile?: string | null} {
  const quality = options?.quality_options?.find((option) => option.id === options.preferences?.quality_id);
  return quality && quality.id !== 'original' ? {qualityId: quality.id, profile: quality.profile ?? null} : {};
}

export function PlaybackSettingsDrawer({
  mediaFileId,
  options,
  state,
  onSaved,
  onClose,
  onFocused,
}: {
  mediaFileId: string;
  options: MediaPlaybackOptions | null;
  state: PlaybackOptionsState;
  onSaved: (options: MediaPlaybackOptions) => void;
  onClose: () => void;
  onFocused?: () => void;
}): React.ReactElement {
  const {t} = useLanguage();
  const {colour} = useTheme();
  const client = useApiClient();
  const [draft, setDraft] = useState<PlaybackDraft | null>(options ? draftOf(options) : null);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (options && draft === null) setDraft(draftOf(options));
  }, [options, draft]);

  const save = (): void => {
    if (!draft) return;
    setSaving(true);
    setFailed(false);
    client
      .updateMediaPlaybackOptions(mediaFileId, draft)
      .then((saved) => {
        onSaved(saved);
        onClose();
      })
      .catch(() => {
        setFailed(true);
        setSaving(false);
      });
  };

  const sections: DrawerSection[] = [];
  if (options && draft) {
    sections.push({
      key: 'quality',
      label: t('pages.workDetail.qualityHeading'),
      rows: options.quality_options.map((quality) => ({
        key: quality.id,
        title: quality.label,
        detail: quality.video_bitrate_bps ? t('pages.workDetail.bitrateMbps', {value: Math.round(quality.video_bitrate_bps / 1_000_000)}) : t('pages.workDetail.sourceQuality'),
        selected: quality.id === draft.quality_id,
        onPress: () => setDraft({...draft, quality_id: quality.id}),
      })),
    });
    sections.push({
      key: 'audio',
      label: t('pages.workDetail.audioHeading'),
      rows: [
        {key: 'auto', title: t('pages.workDetail.automatic'), detail: t('pages.workDetail.useYourPreferredLanguage'), selected: draft.audio_track_id === null, onPress: () => setDraft({...draft, audio_track_id: null})},
        ...options.audio_tracks.map((track) => ({
          key: track.id,
          title: track.label,
          detail: track.language ?? track.codec ?? t('pages.workDetail.originalAudio'),
          selected: track.id === draft.audio_track_id,
          onPress: () => setDraft({...draft, audio_track_id: track.id}),
        })),
      ],
    });
    sections.push({
      key: 'subtitles',
      label: t('pages.workDetail.subtitlesHeading'),
      rows: [
        {key: 'off', title: t('pages.workDetail.subtitlesOff'), detail: t('pages.workDetail.noSubtitles'), selected: draft.subtitle_track_id === null, onPress: () => setDraft({...draft, subtitle_track_id: null})},
        ...options.subtitle_tracks.map((track) => ({
          key: track.id,
          title: track.label,
          detail: track.language ?? track.codec ?? undefined,
          selected: track.id === draft.subtitle_track_id,
          onPress: () => setDraft({...draft, subtitle_track_id: track.id}),
        })),
      ],
    });
  }
  const ready = sections.length > 0;
  return (
    <FilterDrawer
      wide
      kicker={t('pages.workDetail.kindMovie')}
      title={t('pages.workDetail.playbackSettingsTitle')}
      closeLabel={t('pages.workDetail.closeSettings')}
      onClose={onClose}
      onFocused={onFocused}
      sections={sections}
      footerHeight={ready ? 96 : 120}
      footer={(end) =>
        ready ? (
          <View style={{position: 'absolute', left: u(46), top: u(end + 30), flexDirection: 'row'}}>
            <Button label={t('pages.workDetail.cancel')} variant="secondary" onPress={onClose} />
            <View style={{width: u(10)}} />
            <Button label={saving ? t('pages.workDetail.saving') : t('pages.workDetail.save')} disabled={saving} onPress={save} />
          </View>
        ) : (
          <View style={{position: 'absolute', left: u(46), top: u(160), width: u(338)}}>
            <T size={13.824} weight={400} lh={21} color={state.status === 'error' ? colour.danger : colour.inkMuted}>
              {state.status === 'error' ? t('pages.workDetail.playbackOptionsLoadError') : t('pages.workDetail.loadingOptions')}
            </T>
          </View>
        )
      }
    />
  );
}
