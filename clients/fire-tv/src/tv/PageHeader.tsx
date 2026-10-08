/** The web's `page-header` on a stage page: the round back button, the page title and its detail, and the clock gap. */
import React, {useState} from 'react';
import {Pressable, View} from 'react-native';
import {mix} from '../theme/color';
import {useTheme} from '../theme/ThemeProvider';
import {T, u} from './kit';

export interface BackButtonProps {
  onPress: () => void;
  x?: number;
  y?: number;
  size?: number;
  accessibilityLabel?: string;
  hasTVPreferredFocus?: boolean;
}

export function BackButton({onPress, x = 153.6, y = 56.2, size = 50, accessibilityLabel = 'Back', hasTVPreferredFocus}: BackButtonProps): React.ReactElement {
  const {colour} = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hasTVPreferredFocus={hasTVPreferredFocus}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      style={{
        position: 'absolute',
        left: u(x),
        top: u(y),
        width: u(size),
        height: u(size),
        borderRadius: 999,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: focused ? colour.ink : mix(colour.surfaceStrong, 0.7),
        borderWidth: 1,
        borderColor: focused ? colour.ink : mix(colour.lineStrong, 0.7),
        transform: [{scale: focused ? 1.056 : 1}],
      }}
    >
      <T size={17.28} weight={720} color={focused ? colour.bg : colour.inkSoft} lh={25.9} dy={3}>
        {'←'}
      </T>
      {focused ? (
        <View
          pointerEvents="none"
          style={{position: 'absolute', left: u(-5), top: u(-5), right: u(-5), bottom: u(-5), borderRadius: 999, borderWidth: u(2), borderColor: colour.ink}}
        />
      ) : null}
    </Pressable>
  );
}

export interface PageHeaderProps {
  title: string;
  /** Text after the divider (a count, or the open title). */
  detail?: string;
  detailUpper?: boolean;
  /** Detail drawn in the bold, wide-tracked style the settings heading uses is not used here. */
  onBack: () => void;
  titleX?: number;
  titleWidth?: number;
}

export function PageHeader({title, detail, detailUpper = true, onBack, titleWidth}: PageHeaderProps): React.ReactElement {
  const {colour} = useTheme();
  return (
    <>
      <BackButton onPress={onBack} />
      <View style={{position: 'absolute', left: u(226.6), top: u(56.2), height: u(50.4), flexDirection: 'row', alignItems: 'center'}} pointerEvents="none">
        <View style={{width: titleWidth === undefined ? undefined : u(titleWidth)}}>
          <T size={33.6} weight={580} ls={-1.512} lh={50.4} dy={1} color={colour.ink} lines={1}>
            {title}
          </T>
        </View>
        {detail !== undefined ? (
          <View style={{marginLeft: u(23.1), height: u(17), justifyContent: 'center', borderLeftWidth: 1, borderLeftColor: colour.lineStrong, paddingLeft: u(23)}}>
            <T size={11.136} weight={680} ls={0.501} color={colour.inkMuted} upper={detailUpper}>
              {detail}
            </T>
          </View>
        ) : null}
      </View>
    </>
  );
}
