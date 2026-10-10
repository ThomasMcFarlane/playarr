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
  /** The page subtitle under the title (a count, or the open title): web's one shared `.page-subtitle` style. */
  detail?: string;
  onBack: () => void;
  titleX?: number;
  titleWidth?: number;
}

export function PageHeader({title, detail, onBack, titleWidth}: PageHeaderProps): React.ReactElement {
  const {colour, scheme} = useTheme();
  return (
    <>
      <BackButton onPress={onBack} />
      <View style={{position: 'absolute', left: u(226.6), top: u(56.2), height: u(50.4), width: titleWidth === undefined ? undefined : u(titleWidth)}} pointerEvents="none">
        <T size={33.6} weight={580} ls={-1.512} lh={50.4} dy={1} color={colour.ink} lines={1}>
          {title}
        </T>
      </View>
      {detail !== undefined ? (
        // Web: 12.288 px / 820, 0.08em tracking, uppercase, in the brand ink, at y 111.8 under the title.
        <View style={{position: 'absolute', left: u(226.6), top: u(111.8), width: u(600)}} pointerEvents="none">
          <T size={12.288} weight={820} ls={0.983} lh={18.4} color={scheme === 'dark' ? '#eaa6b6' : '#821e36'} upper lines={1}>
            {detail}
          </T>
        </View>
      ) : null}
    </>
  );
}
