/** The control focus ring (owner ruling 2026-10-08): white in dark, ink in light, no fill, offset 5 px outside the control. */
import React from 'react';
import {View} from 'react-native';
import {useTheme} from '../theme/ThemeProvider';
import {u} from './kit';

export function FocusRing({radius = 999, offset = 5}: {radius?: number; offset?: number}): React.ReactElement {
  const {colour} = useTheme();
  return (
    <View
      pointerEvents="none"
      style={{position: 'absolute', left: u(-offset), top: u(-offset), right: u(-offset), bottom: u(-offset), borderRadius: u(radius + offset), borderWidth: u(2), borderColor: colour.ink}}
    />
  );
}
