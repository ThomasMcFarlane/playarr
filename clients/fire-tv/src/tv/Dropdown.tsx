/** The web's `language-dropdown` trigger (theme and language pickers), with a plain option list. */
import React, {useState} from 'react';
import {Pressable, View} from 'react-native';
import {Icon, type IconName} from '../shell/icons';
import {useTheme} from '../theme/ThemeProvider';
import {Box, T, u} from './kit';

export interface DropdownOption {
  id: string;
  label: string;
}

export interface DropdownProps {
  x: number;
  y: number;
  w: number;
  icon: IconName;
  label: string;
  options: readonly DropdownOption[];
  selectedId: string;
  onSelect: (id: string) => void;
  accessibilityLabel: string;
}

export function Dropdown({x, y, w, icon, label, options, selectedId, onSelect, accessibilityLabel}: DropdownProps): React.ReactElement {
  const {colour} = useTheme();
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const lit = focused || open;
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onPress={() => setOpen((value) => !value)}
        style={{
          position: 'absolute',
          left: u(x),
          top: u(y),
          width: u(w),
          height: u(48),
          borderWidth: 1,
          borderColor: lit ? colour.accent : colour.lineStrong,
          backgroundColor: lit ? colour.surfaceStrong : colour.bg,
          flexDirection: 'row',
          alignItems: 'center',
          paddingLeft: u(18.4),
          paddingRight: u(18.4),
          transform: [{scale: lit ? 1.02 : 1}],
        }}
      >
        <Icon name={icon} size={u(16)} color={colour.inkMuted} />
        <View style={{flex: 1, marginLeft: u(9.6)}}>
          <T size={11.52} weight={720} color={colour.ink} lines={1}>
            {label}
          </T>
        </View>
        <Icon name="chevronDown" size={u(12)} color={colour.inkMuted} />
      </Pressable>
      {open ? (
        <Box x={x + w - Math.max(240, w)} y={y + 54} w={Math.max(240, w)} style={{borderWidth: 1, borderColor: colour.lineStrong, backgroundColor: colour.surfaceStrong, padding: u(5.6), zIndex: 40}}>
          {options.map((option) => (
            <OptionRow
              key={option.id}
              label={option.label}
              selected={option.id === selectedId}
              onPress={() => {
                onSelect(option.id);
                setOpen(false);
              }}
            />
          ))}
        </Box>
      ) : null}
    </>
  );
}

function OptionRow({label, selected, onPress}: {label: string; selected: boolean; onPress: () => void}): React.ReactElement {
  const {colour} = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      hasTVPreferredFocus={selected}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      style={{height: u(44), flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: u(11.2), backgroundColor: focused ? colour.surfaceSoft : 'transparent'}}
    >
      <T size={11.84} weight={selected ? 720 : 400} color={colour.ink}>
        {label}
      </T>
      {selected ? (
        <T size={12.8} color={colour.accent}>
          {'✓'}
        </T>
      ) : null}
    </Pressable>
  );
}
