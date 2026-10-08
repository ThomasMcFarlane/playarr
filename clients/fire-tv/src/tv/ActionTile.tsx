/**
 * A button of the shell's action column at the right edge (owner ruling 2026-10-08): the web's 30 September
 * `.tv-filter-launcher` tile, 60 x 70, icon above its label. Pages place their tiles in the column at x = 1846 from y = 152,
 * 85 px apart (panel openers above Filters).
 */
import React, {useState} from 'react';
import {Pressable, View} from 'react-native';
import {Icon, type IconName} from '../shell/icons';
import {mix} from '../theme/color';
import {useTheme} from '../theme/ThemeProvider';
import {T, u} from './kit';

export const ACTION_COLUMN_X = 1846;
export const ACTION_COLUMN_Y = 152;
export const ACTION_PITCH = 85;

export function ActionTile({icon, label, slot = 0, onPress, active, focusable = true}: {icon: IconName; label: string; slot?: number; onPress?: () => void; active?: boolean; focusable?: boolean}): React.ReactElement {
  const {colour} = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      focusable={focusable}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      style={{
        position: 'absolute',
        left: u(ACTION_COLUMN_X - 0.5),
        top: u(ACTION_COLUMN_Y - 0.8 + slot * ACTION_PITCH),
        width: u(62),
        height: u(72),
        borderRadius: u(16),
        borderWidth: 1,
        borderColor: colour.line,
        backgroundColor: focused || active ? colour.ink : mix(colour.surfaceStrong, 0.56),
        alignItems: 'center',
        justifyContent: 'center',
        transform: [{scale: focused ? 1.06 : 1}],
      }}
    >
      <Icon name={icon} size={u(18)} color={focused || active ? colour.bg : colour.inkSoft} />
      <View style={{marginTop: u(6)}}>
        <T size={8.256} weight={700} ls={0.165} lh={12.4} color={focused || active ? colour.bg : colour.inkMuted}>
          {label}
        </T>
      </View>
    </Pressable>
  );
}
