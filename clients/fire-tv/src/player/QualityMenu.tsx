/**
 * The player's quality menu, as the web draws it (`player-quality-menu`): a heading, the Original row and the resolution
 * by Low / Medium / High matrix. Only the renditions the server offers for this file are selectable.
 */
import React, {useState} from 'react';
import {Pressable, View} from 'react-native';
import type {PlaybackQualityOption} from '@playarr-tv/api-client';
import {QUALITY_LEVELS, QUALITY_TIERS} from '../lib/qualityMatrix';
import {Icon} from '../shell/icons';
import {mix} from '../theme/color';
import {useTheme} from '../theme/ThemeProvider';
import {FocusRing} from '../tv/FocusRing';
import {Box, T, u} from '../tv/kit';
import {useBackLayer} from '../navigation/backPolicy';
import {TvFocusScope} from '../platform/focus';

export function originalLabel(option: PlaybackQualityOption | undefined): string {
  const bps = option?.video_bitrate_bps;
  if (typeof bps === 'number' && bps >= 50_000) return `Original · ${(bps / 1_000_000).toFixed(1)} Mbps`;
  return 'Original';
}

const COLUMN_X = [1203, 1366, 1528];
const ROW_Y = [680, 746, 812, 878];

export interface QualityMenuProps {
  options: PlaybackQualityOption[];
  selectedId: string;
  onSelect: (option: PlaybackQualityOption) => void;
  onClose: () => void;
}

export function QualityMenu({options, selectedId, onSelect, onClose}: QualityMenuProps): React.ReactElement {
  const {colour} = useTheme();
  useBackLayer(true, onClose);
  const original = options.find((option) => option.id === 'original');
  const byId = new Map(options.map((option) => [option.id, option]));
  return (
    <Box x={1076} y={541} w={618} h={406} r={16} style={{backgroundColor: mix(colour.surfaceStrong, 0.96), borderWidth: 1, borderColor: colour.lineStrong}}>
      <TvFocusScope autoFocus trap={['up', 'down', 'left', 'right']}>
        <View style={{position: 'absolute', left: u(20), top: u(17)}}>
          <T size={8.64} weight={760} ls={1.1} color={colour.inkMuted} upper>
            Quality
          </T>
        </View>
        <Cell
          x={9}
          y={38}
          w={600}
          h={59}
          selected={selectedId === 'original'}
          disabled={!original}
          onPress={() => original && onSelect(original)}
          hasTVPreferredFocus={selectedId === 'original'}
          wide
        >
          <T size={11.52} weight={650} color={colour.ink}>
            {originalLabel(original)}
          </T>
          <T size={8.448} weight={400} color={colour.inkMuted}>
            Source quality
          </T>
        </Cell>
        {QUALITY_LEVELS.map((level, column) => (
          <Box key={level} x={COLUMN_X[column]! - 1076} y={659 - 541} w={156}>
            <T size={9.216} weight={720} ls={0.9} color={colour.inkMuted} upper style={{textAlign: 'center'}}>
              {level}
            </T>
          </Box>
        ))}
        {QUALITY_TIERS.map((tier, row) => (
          <React.Fragment key={tier.id}>
            <Box x={1089 - 1076} y={ROW_Y[row]! - 541 + 12} w={100}>
              <T size={11.52} weight={720} color={colour.ink} upper>
                {tier.id}
              </T>
              <T size={8.448} weight={400} color={colour.inkMuted}>
                {tier.resolution}
              </T>
            </Box>
            {tier.options.map((option, column) => {
              const offered = byId.get(option.id);
              return (
                <Cell
                  key={option.id}
                  x={COLUMN_X[column]! - 1076}
                  y={ROW_Y[row]! - 541}
                  w={156}
                  h={60}
                  selected={selectedId === option.id}
                  disabled={!offered}
                  onPress={() => offered && onSelect(offered)}
                  hasTVPreferredFocus={selectedId === option.id}
                >
                  <T size={11.52} weight={650} color={colour.ink}>{`${option.bitrateMbps} Mbps`}</T>
                  <T size={8.448} weight={400} color={colour.inkMuted}>
                    {option.level === 'low' ? 'Low' : option.level === 'medium' ? 'Medium' : 'High'}
                  </T>
                </Cell>
              );
            })}
          </React.Fragment>
        ))}
      </TvFocusScope>
    </Box>
  );
}

function Cell(props: {x: number; y: number; w: number; h: number; selected: boolean; disabled: boolean; wide?: boolean; hasTVPreferredFocus?: boolean; onPress: () => void; children: React.ReactNode}): React.ReactElement {
  const {colour} = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      disabled={props.disabled}
      hasTVPreferredFocus={props.hasTVPreferredFocus}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={props.onPress}
      style={{
        position: 'absolute',
        left: u(props.x),
        top: u(props.y),
        width: u(props.w),
        height: u(props.h),
        borderRadius: u(10),
        borderWidth: 1,
        borderColor: props.selected ? mix('#cf3157', 0.8) : colour.line,
        backgroundColor: props.selected ? mix('#cf3157', 0.22) : mix(colour.surfaceSoft, 0.4),
        paddingHorizontal: u(11),
        justifyContent: 'center',
        opacity: props.disabled ? 0.35 : 1,
      }}
    >
      {props.children}
      {props.wide && props.selected ? (
        <View style={{position: 'absolute', right: u(16), top: u(20)}}>
          <Icon name="check" size={u(14)} color="#cf3157" strokeWidth={2.4} />
        </View>
      ) : null}
      {focused ? <FocusRing radius={10} offset={4} /> : null}
    </Pressable>
  );
}
