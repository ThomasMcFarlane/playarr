/** Form pieces the settings panels share, at the web's measurements. */
import React, {useState} from 'react';
import {Pressable, TextInput, View, type TextInputProps} from 'react-native';
import {mix} from '../theme/color';
import {sans} from '../theme/fonts';
import {useTheme} from '../theme/ThemeProvider';
import {Box, T, u} from './kit';

/** `h3` of a settings card: 26.4px/560, 39.6px line. */
export function SectionTitle({children, small}: {children: React.ReactNode; small?: boolean}): React.ReactElement {
  const {colour} = useTheme();
  return small ? (
    <T size={22.464} weight={700} lh={33.7} color={colour.ink}>
      {children}
    </T>
  ) : (
    <T size={26.4} weight={560} ls={-0.924} lh={39.6} color={colour.ink}>
      {children}
    </T>
  );
}

export function Muted({children, w = 995}: {children: React.ReactNode; w?: number}): React.ReactElement {
  const {colour} = useTheme();
  return (
    <View style={{width: u(w)}}>
      <T size={19.2} weight={400} lh={28.8} color={colour.inkMuted}>
        {children}
      </T>
    </View>
  );
}

export function Hint({children, w = 995}: {children: React.ReactNode; w?: number}): React.ReactElement {
  const {colour} = useTheme();
  return (
    <View style={{width: u(w)}}>
      <T size={12.48} weight={400} lh={18.7} color={colour.inkMuted}>
        {children}
      </T>
    </View>
  );
}

export function FormLabel({children}: {children: React.ReactNode}): React.ReactElement {
  const {colour} = useTheme();
  return (
    <T size={11.2} weight={720} ls={0.896} lh={16.8} color={colour.inkMuted} upper>
      {children}
    </T>
  );
}

export interface ButtonProps {
  label: string;
  onPress?: () => void;
  variant?: 'primary' | 'secondary';
  w?: number;
  h?: number;
  disabled?: boolean;
  hasTVPreferredFocus?: boolean;
}

/** `btn btn-primary` / `btn btn-secondary`. */
export function Button({label, onPress, variant = 'primary', w, h, disabled, hasTVPreferredFocus}: ButtonProps): React.ReactElement {
  const {colour} = useTheme();
  const [focused, setFocused] = useState(false);
  const primary = variant === 'primary';
  const height = h ?? (primary ? 58 : 38);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      hasTVPreferredFocus={hasTVPreferredFocus}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      style={{
        width: w === undefined ? undefined : u(w),
        height: u(height),
        alignSelf: 'flex-start',
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: u(primary ? 24 : 16),
        borderRadius: u(primary ? 6 : 6),
        borderWidth: primary ? 0 : 1,
        borderColor: colour.lineStrong,
        backgroundColor: primary ? (focused ? colour.ink : colour.accent) : focused ? colour.surfaceSoft : colour.surface,
        opacity: disabled ? 0.55 : 1,
        transform: [{scale: focused ? 1.03 : 1}],
      }}
    >
      <T size={primary ? 14.72 : 11.52} weight={720} color={primary ? colour.onAccent : colour.inkSoft}>
        {label}
      </T>
    </Pressable>
  );
}

export interface SegmentedProps<Id extends string> {
  options: readonly {id: Id; label: string}[];
  value: Id;
  onChange: (id: Id) => void;
  accessibilityLabel: string;
}

/** `theme-choice`: joined buttons separated by 1px, the active one inverted and enlarged. */
export function Segmented<Id extends string>({options, value, onChange, accessibilityLabel}: SegmentedProps<Id>): React.ReactElement {
  const {colour} = useTheme();
  return (
    <View
      accessibilityLabel={accessibilityLabel}
      style={{flexDirection: 'row', alignSelf: 'flex-start', backgroundColor: colour.line, borderWidth: 1, borderColor: colour.line}}
    >
      {options.map((option, index) => (
        <SegmentButton key={option.id} label={option.label} active={option.id === value} gap={index > 0} onPress={() => onChange(option.id)} />
      ))}
    </View>
  );
}

function SegmentButton({label, active, gap, onPress}: {label: string; active: boolean; gap: boolean; onPress: () => void}): React.ReactElement {
  const {colour} = useTheme();
  const [focused, setFocused] = useState(false);
  const lit = active || focused;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{selected: active}}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      style={{
        height: u(48),
        marginLeft: gap ? u(1) : 0,
        paddingHorizontal: u(18.4),
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: lit ? colour.ink : colour.bg,
        transform: [{scale: lit ? 1.04 : 1}],
      }}
    >
      <T size={11.52} weight={720} color={lit ? colour.bg : colour.inkMuted}>
        {label}
      </T>
    </Pressable>
  );
}

export function Divider({w = 995}: {w?: number}): React.ReactElement {
  const {colour} = useTheme();
  return <View style={{width: u(w), height: 1, backgroundColor: colour.line}} />;
}

export function Field(props: TextInputProps & {w: number; h?: number}): React.ReactElement {
  const {colour} = useTheme();
  const {w, h = 62, style, ...rest} = props;
  const [focused, setFocused] = useState(false);
  return (
    <TextInput
      placeholderTextColor={colour.inkMuted}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={[
        {
          width: u(w),
          height: u(h),
          paddingHorizontal: u(16),
          backgroundColor: colour.bg,
          color: colour.ink,
          fontSize: u(14.72),
          borderWidth: 1,
          borderColor: focused ? colour.accent : colour.line,
          ...sans(400),
        },
        style,
      ]}
      {...rest}
    />
  );
}

export function Stack({gap, children, y = 210, x = 773.8}: {gap?: number; children: React.ReactNode; y?: number; x?: number}): React.ReactElement {
  return (
    <Box x={x} y={y} style={{gap: gap === undefined ? undefined : u(gap)}}>
      {children}
    </Box>
  );
}

export {mix};
