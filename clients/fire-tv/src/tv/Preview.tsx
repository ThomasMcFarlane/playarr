/** The web's `tv-library-preview`: kicker, 69px title, meta runs and overview on the left of a stage page. */
import React from 'react';
import {View} from 'react-native';
import {useTheme} from '../theme/ThemeProvider';
import {Box, T, u} from './kit';

export interface PreviewProps {
  kicker?: string;
  title: string;
  /** Meta runs: the first in the soft ink, the rest muted. */
  meta?: readonly string[];
  overview?: string | null;
  /** Content drawn between the overview and the page (actions). */
  children?: React.ReactNode;
}

export function Preview({kicker, title, meta, overview, children}: PreviewProps): React.ReactElement {
  const {colour} = useTheme();
  return (
    <Box x={153.6} y={259.2} w={455} pointerEvents="box-none">
      {kicker ? (
        <T size={12.288} weight={820} ls={0.983} color="#cf3157" upper lh={18.4} lines={1}>
          {kicker}
        </T>
      ) : null}
      <View style={{marginTop: u(25.9), width: u(373.2)}}>
        <T size={69.12} weight={560} ls={-4.9766} lh={62.2} color={colour.ink}>
          {title}
        </T>
      </View>
      {meta && meta.length > 0 ? (
        <View style={{marginTop: u(27), flexDirection: 'row', flexWrap: 'wrap'}}>
          {meta.map((run, index) => (
            <View key={`${index}:${run}`} style={{marginRight: u(12.8)}}>
              <T size={12.096} weight={400} lh={18.1} color={index === 0 ? colour.inkSoft : colour.inkMuted}>
                {run}
              </T>
            </View>
          ))}
        </View>
      ) : null}
      {overview ? (
        <View style={{marginTop: u(meta && meta.length > 0 ? 21.6 : 21.6), width: u(324)}}>
          <T size={12.864} weight={400} lh={20.3} color={colour.inkMuted} lines={5}>
            {overview}
          </T>
        </View>
      ) : null}
      {children}
    </Box>
  );
}
