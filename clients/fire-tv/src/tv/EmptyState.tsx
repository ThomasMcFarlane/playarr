/** The web's `TvEmptyState` (page variant, details graphic): a 164 px disc with a card glyph beside a title and a two-line note. */
import React from 'react';
import {View} from 'react-native';
import Svg, {Circle, Path, Rect} from '@amazon-devices/react-native-svg';
import {mix} from '../theme/color';
import {useTheme} from '../theme/ThemeProvider';
import {Box, T, u} from './kit';

export interface EmptyStateProps {
  title: string;
  description?: string;
  /** Top of the disc, in web px. */
  y: number;
  /** Left and width of the 680 px container the content is centred in. */
  x?: number;
  width?: number;
  tone?: 'error';
}

/** Approximate width of one line of the web's title at 22.08 px / 650, for centring. */
function textWidth(text: string, size: number): number {
  return Math.min(text.length * size * 0.446, 320);
}

export function EmptyState({title, description, y, x = 787.2, width = 680, tone}: EmptyStateProps): React.ReactElement {
  const {colour} = useTheme();
  const danger = tone === 'error' ? colour.accent : undefined;
  const titleW = textWidth(title, 22.08);
  const noteW = description ? 219.3 : 0;
  const copyW = Math.max(titleW, noteW);
  const total = 164 + 42 + copyW;
  const left = x + (width - total) / 2;
  const glyph = danger ?? mix('#cf3157', 0.78);
  return (
    <>
      <Box
        x={left}
        y={y}
        w={164}
        h={164}
        r={82}
        style={{backgroundColor: mix(colour.surfaceStrong, 0.54), borderWidth: 1, borderColor: mix(colour.lineStrong, 0.5), alignItems: 'center', justifyContent: 'center'}}
      >
        <Svg width={u(70)} height={u(46.7)} viewBox="0 0 70 46.7">
          <Rect x={1.5} y={1.5} width={67} height={43.7} rx={8} fill="none" stroke={glyph} strokeWidth={2.4} />
          <Path d="M13 15h30M13 24h24M13 33h14" stroke={glyph} strokeWidth={2.4} strokeLinecap="round" />
          <Circle cx={56} cy={13} r={3.6} fill="none" stroke={glyph} strokeWidth={2.2} />
        </Svg>
      </Box>
      <Box x={left + 164 + 42} y={y + 45.7} w={Math.max(copyW, 220)}>
        <T size={22.08} weight={650} ls={-0.4416} lh={33.1} color={danger ?? colour.ink}>
          {title}
        </T>
        {description ? (
          <View style={{marginTop: u(7.2), width: u(232)}}>
            <T size={10.752} weight={400} lh={16.1} color={colour.inkMuted}>
              {description}
            </T>
          </View>
        ) : null}
      </Box>
    </>
  );
}
