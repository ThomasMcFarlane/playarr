/** The web's `WatchStateOverlay`: a progress bar for a part-watched title, a red dot for an unwatched one. */
import React from 'react';
import {View} from 'react-native';
import type {WatchProgress} from '@playarr-tv/api-client';
import {mix} from '../theme/color';
import {u} from './kit';

export function watchStatePriority(state: WatchProgress['state']): number {
  if (state === 'part_watched') return 2;
  if (state === 'watched') return 1;
  return 0;
}

export function indexWatchProgressByWork(rows: readonly WatchProgress[]): Map<string, WatchProgress> {
  const byWork = new Map<string, WatchProgress>();
  for (const progress of rows) {
    const current = byWork.get(progress.work_id);
    if (!current || watchStatePriority(progress.state) > watchStatePriority(current.state)) byWork.set(progress.work_id, progress);
  }
  return byWork;
}

export interface WatchStateProps {
  progress?: WatchProgress;
  showUnwatched?: boolean;
  /** Dot size and inset in CSS px (the web scales them with the card). */
  dot?: number;
  inset?: number;
}

export function WatchState({progress, showUnwatched = false, dot = 13, inset = 10.5}: WatchStateProps): React.ReactElement | null {
  if (progress?.state === 'part_watched') {
    const percent = progress.duration_ms > 0 ? Math.min(100, Math.max(0, (progress.position_ms / progress.duration_ms) * 100)) : 0;
    return (
      <View style={{position: 'absolute', left: 0, right: 0, bottom: 0, height: u(3), backgroundColor: 'rgba(255,255,255,0.2)', overflow: 'hidden'}}>
        <View style={{width: `${percent}%`, minWidth: u(3), height: '100%', backgroundColor: '#cf3157'}} />
      </View>
    );
  }
  if (progress?.state === 'unseen' || (!progress && showUnwatched)) {
    return (
      <View
        style={{
          position: 'absolute',
          right: u(inset),
          top: u(inset),
          width: u(dot),
          height: u(dot),
          borderRadius: 999,
          backgroundColor: '#cf3157',
          borderWidth: u(2),
          borderColor: mix('#ffffff', 0.94),
        }}
      />
    );
  }
  return null;
}
