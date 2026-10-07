/**
 * A right-hand drawer (the web's `tv-filter-drawer` / playback-settings drawer): a 430 px panel over the page that traps the
 * D-pad until it is closed. Back closes it (a layered Back, `useBackLayer`).
 */
import React, {useState} from 'react';
import {Pressable, View} from 'react-native';
import {useBackLayer} from '../navigation/backPolicy';
import {TvFocusScope} from '../platform/focus';
import {mix} from '../theme/color';
import {useTheme} from '../theme/ThemeProvider';
import {T, u} from './kit';

export interface SheetProps {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}

export function Sheet({title, onClose, children}: SheetProps): React.ReactElement {
  const {colour} = useTheme();
  useBackLayer(true, onClose);
  return (
    <>
      <View pointerEvents="none" style={{position: 'absolute', left: 0, top: 0, width: u(1920), height: u(1080), backgroundColor: 'rgba(0,0,0,0.38)'}} />
      <View
        style={{
          position: 'absolute',
          left: u(1490),
          top: 0,
          width: u(430),
          height: u(1080),
          backgroundColor: mix(colour.surfaceStrong, 0.97),
          borderLeftWidth: 1,
          borderLeftColor: colour.line,
          paddingHorizontal: u(32),
          paddingTop: u(56),
        }}
      >
        <TvFocusScope autoFocus trap={['up', 'down', 'left', 'right']}>
          <T size={21.12} weight={600} ls={-0.5} lh={30} color={colour.ink}>
            {title}
          </T>
          <View style={{height: u(22)}} />
          {children}
        </TvFocusScope>
      </View>
    </>
  );
}

export function SheetOption({label, detail, selected, onPress, hasTVPreferredFocus}: {label: string; detail?: string; selected?: boolean; onPress: () => void; hasTVPreferredFocus?: boolean}): React.ReactElement {
  const {colour} = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hasTVPreferredFocus={hasTVPreferredFocus}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      style={{
        minHeight: u(52),
        marginBottom: u(8),
        borderRadius: u(12),
        paddingHorizontal: u(16),
        justifyContent: 'center',
        backgroundColor: focused ? colour.ink : selected ? mix(colour.ink, 0.1) : mix(colour.surfaceSoft, 0.6),
        borderWidth: 1,
        borderColor: focused ? colour.ink : colour.line,
      }}
    >
      <T size={13.44} weight={640} color={focused ? colour.bg : colour.ink} lines={1}>
        {label}
      </T>
      {detail ? (
        <T size={10.56} weight={400} color={focused ? colour.bg : colour.inkMuted} lines={1}>
          {detail}
        </T>
      ) : null}
    </Pressable>
  );
}
