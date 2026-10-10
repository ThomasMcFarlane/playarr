/**
 * The long-press title actions (web `MediaContextMenu`, "Title actions"): the shared right drawer with Play, Add to Playlist,
 * Mark as Watched and Mark as Unwatched. Download is left out: Fire TV has no download storage (ruling 2026-10-08).
 */
import React, {useContext, useState} from 'react';
import {Pressable, View} from 'react-native';
import type {Work, WorkDetail} from '@playarr-tv/api-client';
import {useApiClient} from '../api/ApiClientProvider';
import {useLanguage} from '../i18n/LanguageProvider';
import {PlayerHandleContext} from '../navigation/PlayerHandleContext';
import {useTheme} from '../theme/ThemeProvider';
import {FilterDrawer} from './FilterDrawer';
import {FocusRing} from './FocusRing';
import {T, u} from './kit';

export interface Leaf {
  mediaFileId: string;
  runtimeMs: number;
}

/** Every playable file of a title: the film's file, or each episode that has one (web `playableLeaves`). */
export function playableLeaves(detail: Pick<WorkDetail, 'media_file_id' | 'runtime_ms' | 'children'>): Leaf[] {
  const children = detail.children as unknown;
  if (children && typeof children === 'object' && 'Series' in children) {
    const seasons = (children as {Series: Array<{episodes: Array<{media_file_id?: string | null; runtime_ms?: number | null}>}>}).Series;
    return seasons.flatMap((season) => season.episodes).flatMap((episode) => (episode.media_file_id ? [{mediaFileId: episode.media_file_id, runtimeMs: episode.runtime_ms ?? 0}] : []));
  }
  return detail.media_file_id ? [{mediaFileId: detail.media_file_id, runtimeMs: detail.runtime_ms ?? 0}] : [];
}

const ROW_H = 64;
const ROW_PITCH = 80;

export function ActionsDrawer({work, onClose, onOpen, onAddToPlaylist}: {work: Work; onClose: () => void; onOpen: () => void; onAddToPlaylist: () => void}): React.ReactElement {
  const client = useApiClient();
  const {t} = useLanguage();
  const player = useContext(PlayerHandleContext);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = (id: string, task: () => Promise<void>): void => {
    if (busy) return;
    setBusy(id);
    setError(null);
    task()
      .then(onClose)
      .catch((caught: unknown) => {
        setBusy(null);
        setError(caught instanceof Error ? caught.message : String(caught));
      });
  };
  const leaves = async (): Promise<Leaf[]> => {
    const found = playableLeaves(await client.getWork(work.id));
    if (found.length === 0) throw new Error(t('components.mediaContextMenu.noPlayableMedia'));
    return found;
  };
  const setWatched = (watched: boolean): void =>
    run(watched ? 'watched' : 'unwatched', async () => {
      const all = await leaves();
      for (let i = 0; i < all.length; i += 8) {
        await Promise.all(
          all.slice(i, i + 8).map((leaf) => client.updateWatchProgress(leaf.mediaFileId, {positionMs: watched ? leaf.runtimeMs : 0, durationMs: leaf.runtimeMs, completed: watched})),
        );
      }
    });
  const play = (): void => {
    // A series opens on its next-up episode (the detail page does the resume logic); a film plays at once.
    if (work.kind !== 'movie') return run('play', async () => onOpen());
    run('play', async () => {
      const [first] = await leaves();
      player?.current?.show(first!.mediaFileId, {title: work.title});
    });
  };

  const actions: Array<{id: string; glyph: string; label: string; onPress: () => void}> = [
    {id: 'play', glyph: '▶', label: t('components.mediaContextMenu.play'), onPress: play},
    {id: 'playlist', glyph: '＋', label: t('components.mediaContextMenu.addToPlaylist'), onPress: onAddToPlaylist},
    {id: 'watched', glyph: '✓', label: busy === 'watched' ? t('components.mediaContextMenu.updating') : t('components.mediaContextMenu.markAsWatched'), onPress: () => setWatched(true)},
    {id: 'unwatched', glyph: '○', label: busy === 'unwatched' ? t('components.mediaContextMenu.updating') : t('components.mediaContextMenu.markAsUnwatched'), onPress: () => setWatched(false)},
  ];
  return (
    <FilterDrawer
      kicker={t('components.mediaContextMenu.titleActionsHeading')}
      title={work.title}
      closeLabel={t('components.mediaContextMenu.close')}
      onClose={onClose}
      sections={[
        {
          key: 'actions',
          label: '',
          height: actions.length * ROW_PITCH + (error ? 40 : 0),
          render: (top, reveal) => (
            <>
              {actions.map((action, index) => (
                <ActionRow key={action.id} glyph={action.glyph} label={action.label} y={top + index * ROW_PITCH} first={index === 0} onPress={action.onPress} onReveal={reveal} />
              ))}
              {error ? (
                <View style={{position: 'absolute', left: u(46), top: u(top + actions.length * ROW_PITCH), width: u(268)}}>
                  <T size={11} weight={600} color="#cf3157" lines={2}>
                    {error}
                  </T>
                </View>
              ) : null}
            </>
          ),
        },
      ]}
    />
  );
}

function ActionRow({glyph, label, y, first, onPress, onReveal}: {glyph: string; label: string; y: number; first: boolean; onPress: () => void; onReveal: (y: number, h: number) => void}): React.ReactElement {
  const {colour} = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hasTVPreferredFocus={first}
      onFocus={() => {
        setFocused(true);
        onReveal(y, ROW_H);
      }}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      style={{position: 'absolute', left: u(46), top: u(y), width: u(268), height: u(ROW_H), borderRadius: u(12), backgroundColor: colour.surfaceSoft, flexDirection: 'row', alignItems: 'center', paddingHorizontal: u(18)}}
    >
      <View style={{width: u(24)}}>
        <T size={13} weight={600} color="#cf3157">
          {glyph}
        </T>
      </View>
      <T size={13.44} weight={700} color={colour.ink} lines={1}>
        {label}
      </T>
      {focused ? <FocusRing radius={12} /> : null}
    </Pressable>
  );
}
