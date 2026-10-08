/**
 * The right-hand filter drawer (web `.tv-filter-drawer`, 360 px wide): the kicker and title with a round close button, then
 * sections of choice chips. Chips are 84 x 56 in three columns (130 x 56 in two for the view options), 8 px apart; focus and
 * the selected state both fill the chip with the ink colour and grow it 2.5%. The section labels follow the chips with no
 * gap, as measured on the web. Content longer than the screen scrolls with the shared edge fades.
 *
 * Back closes the drawer (a layered Back).
 */
import React, {useEffect, useRef, useState} from 'react';
import {Animated, Easing, Pressable, View} from 'react-native';
import {useBackLayer} from '../navigation/backPolicy';
import {TvFocusScope, focusNode} from '../platform/focus';
import {mix} from '../theme/color';
import {useTheme} from '../theme/ThemeProvider';
import {EdgeFade} from './EdgeFade';
import {T, u} from './kit';
import {useScrollReveal} from './useScrollReveal';

export const DRAWER_X = 1560;
export const DRAWER_W = 360;
const WIDE_X = 1490;
const WIDE_W = 430;
const CONTENT_X = 46;
const CONTENT_W = 268;
const LABEL_H = 14.4;
const LABEL_GAP = 12;
const CHIP_H = 56;
const CHIP_GAP = 8;
const FIRST_SECTION_Y = 159.4;

export type ViewIcon = 'list' | 'screen' | 'cover';

export interface DrawerChip {
  key: string;
  label: string;
  selected: boolean;
  onPress: () => void;
  icon?: ViewIcon;
}

/** A full-width choice with a title and a line of detail under it and a check mark at the end (the playback settings' options). */
export interface DrawerRow {
  key: string;
  title: string;
  detail?: string;
  selected: boolean;
  onPress: () => void;
}

export type DrawerSection =
  | {key: string; label: string; columns: 2 | 3; chips: DrawerChip[]}
  | {key: string; label: string; rows: DrawerRow[]}
  | {key: string; label: string; height: number; render: (top: number, reveal: (y: number, h: number) => void) => React.ReactNode};

export interface FilterDrawerProps {
  kicker: string;
  title: string;
  closeLabel: string;
  onClose: () => void;
  sections: DrawerSection[];
  /** Content after the sections (for example a "clear filters" button), in drawer coordinates relative to the end of the last section. */
  footer?: (top: number, reveal: (y: number, h: number) => void) => React.ReactNode;
  footerHeight?: number;
  /** Called once the drawer holds focus, so the page can stop offering its own controls to the D-pad. */
  onFocused?: () => void;
  /** The 430 px drawer of the title page's playback settings, over the 360 px one of the libraries and the calendar. */
  wide?: boolean;
}

/** The vertical extent of each section, from the top of the content. */
function layoutSections(sections: DrawerSection[]): {tops: number[]; end: number} {
  const tops: number[] = [];
  let y = FIRST_SECTION_Y;
  for (const section of sections) {
    tops.push(y);
    if ('rows' in section) {
      y += LABEL_H + LABEL_GAP + section.rows.length * (CHIP_H + CHIP_GAP) - CHIP_GAP;
    } else if ('chips' in section) {
      const rows = Math.ceil(section.chips.length / section.columns);
      y += LABEL_H + LABEL_GAP + rows * (CHIP_H + CHIP_GAP) - CHIP_GAP;
    } else {
      y += section.height;
    }
  }
  return {tops, end: y};
}

export function FilterDrawer({kicker, title, closeLabel, onClose, sections, footer, footerHeight = 0, onFocused, wide}: FilterDrawerProps): React.ReactElement {
  const {colour} = useTheme();
  useBackLayer(true, onClose);
  const {tops, end} = layoutSections(sections);
  const contentEnd = end + footerHeight;
  const {offset: scrollY, scrolled, max, reveal} = useScrollReveal({viewport: 1080 - 24, content: contentEnd + 46, margin: 40});
  const revealChip = (y: number, h: number): void => reveal(y - 80, h + 80);

  const slide = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(slide, {toValue: 1, duration: 360, easing: Easing.bezier(0.16, 1, 0.3, 1), useNativeDriver: true}).start();
  }, [slide]);

  return (
    <>
      {/* box-shadow: -32px 0 90px rgba(40, 26, 24, 0.24) */}
      <View
        pointerEvents="none"
        style={{position: 'absolute', left: u((wide ? WIDE_X : DRAWER_X) - 90), top: 0, width: u(90), height: u(1080), backgroundColor: 'rgba(40, 26, 24, 0.04)'}}
      />
      <Animated.View
        style={{
          position: 'absolute',
          left: u(wide ? WIDE_X : DRAWER_X),
          top: 0,
          width: u(wide ? WIDE_W : DRAWER_W),
          height: u(1080),
          overflow: 'hidden',
          backgroundColor: colour.surfaceStrong,
          opacity: slide,
          transform: [{translateX: slide.interpolate({inputRange: [0, 1], outputRange: [u(40), 0]})}],
        }}
      >
        <TvFocusScope autoFocus trap={['up', 'down', 'left', 'right']} style={{width: u(wide ? WIDE_W : DRAWER_W), height: u(1080)}}>
          <Animated.View style={{position: 'absolute', left: 0, top: scrollY, width: u(wide ? WIDE_W : DRAWER_W), height: u(contentEnd + 80)}}>
            <View style={{position: 'absolute', left: u(CONTENT_X), top: u(54)}}>
              <T size={9.6} weight={720} ls={0.672} lh={14.4} color={colour.inkMuted} upper>
                {kicker}
              </T>
            </View>
            <View style={{position: 'absolute', left: u(CONTENT_X), top: u(71.6), width: u(wide ? 330 : 200)}}>
              <T size={38.4} weight={590} ls={-2.112} lh={57.6} color={colour.ink}>
                {title}
              </T>
            </View>
            <CloseButton label={closeLabel} onPress={onClose} onFocused={onFocused} x={wide ? 1826 - WIDE_X : undefined} />
            {sections.map((section, index) => {
              const top = tops[index]!;
              return (
                <View key={section.key} pointerEvents="box-none">
                  <View style={{position: 'absolute', left: u(CONTENT_X), top: u(top)}}>
                    <T size={9.6} weight={720} ls={0.672} lh={LABEL_H} color={colour.inkMuted} upper>
                      {section.label}
                    </T>
                  </View>
                  {'rows' in section
                    ? section.rows.map((row, rowIndex) => <Row key={row.key} row={row} x={CONTENT_X} y={top + LABEL_H + LABEL_GAP + rowIndex * (CHIP_H + CHIP_GAP)} w={wide ? WIDE_W - 2 * CONTENT_X : 268} onReveal={revealChip} />)
                    : 'chips' in section
                    ? section.chips.map((chip, chipIndex) => {
                        const col = chipIndex % section.columns;
                        const row = Math.floor(chipIndex / section.columns);
                        const width = section.columns === 2 ? 130 : 84;
                        const chipTop = top + LABEL_H + LABEL_GAP + row * (CHIP_H + CHIP_GAP);
                        return <Chip key={chip.key} chip={chip} x={CONTENT_X + col * (width + CHIP_GAP)} y={chipTop} w={width} onReveal={revealChip} />;
                      })
                    : section.render(top + LABEL_H + LABEL_GAP, revealChip)}
                </View>
              );
            })}
            {footer ? footer(end, revealChip) : null}
          </Animated.View>
        </TvFocusScope>
        <EdgeFade side="top" active={scrolled > 0} x={0} y={0} w={wide ? WIDE_W : DRAWER_W} h={1080} />
        <EdgeFade side="bottom" active={scrolled < max - 1} x={0} y={0} w={wide ? WIDE_W : DRAWER_W} h={1080} />
      </Animated.View>
    </>
  );
}

/** The drawer's close button. It takes focus itself when the drawer opens, even when a tile of the action column held it. */
export function CloseButton({label, onPress, onFocused, x = 1824.7 - DRAWER_X}: {label: string; onPress: () => void; onFocused?: () => void; x?: number}): React.ReactElement {
  const {colour} = useTheme();
  const [focused, setFocused] = useState(false);
  const ref = useRef<View>(null);
  useEffect(() => {
    const id = setTimeout(() => focusNode(ref), 300);
    return () => clearTimeout(id);
  }, []);
  return (
    <Pressable
      ref={ref}
      accessibilityRole="button"
      accessibilityLabel={label}
      hasTVPreferredFocus
      onFocus={() => {
        setFocused(true);
        onFocused?.();
      }}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      style={{
        position: 'absolute',
        left: u(x),
        top: u(65.2),
        width: u(50.6),
        height: u(52.8),
        borderRadius: 999,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: focused ? colour.ink : colour.surfaceSoft,
      }}
    >
      <T size={26.88} weight={720} lh={40} color={focused ? colour.bg : colour.ink} dy={-1}>
        {'×'}
      </T>
    </Pressable>
  );
}

function ViewGlyph({icon, color}: {icon: ViewIcon; color: string}): React.ReactElement {
  const box = {borderWidth: 1, borderColor: color, borderRadius: 1};
  if (icon === 'list') {
    return (
      <View style={{width: u(20), height: u(13), justifyContent: 'space-between'}}>
        {[0, 1, 2].map((i) => (
          <View key={i} style={[box, {height: u(3)}]} />
        ))}
      </View>
    );
  }
  const width = icon === 'cover' ? 16 : 20;
  return (
    <View style={{width: u(width), height: u(13), flexDirection: 'row', justifyContent: 'space-between'}}>
      {[0, 1, 2].map((i) => (
        <View key={i} style={[box, {width: u((width - 4) / 3), height: u(13)}]} />
      ))}
    </View>
  );
}

function Chip({chip, x, y, w, onReveal}: {chip: DrawerChip; x: number; y: number; w: number; onReveal: (y: number, h: number) => void}): React.ReactElement {
  const {colour} = useTheme();
  const [focused, setFocused] = useState(false);
  const lit = focused || chip.selected;
  const ink = lit ? colour.bg : colour.inkMuted;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={chip.label}
      accessibilityState={{selected: chip.selected}}
      onFocus={() => {
        setFocused(true);
        onReveal(y, CHIP_H);
      }}
      onBlur={() => setFocused(false)}
      onPress={chip.onPress}
      style={{
        position: 'absolute',
        left: u(x),
        top: u(y),
        width: u(w),
        height: u(CHIP_H),
        borderRadius: u(12),
        borderWidth: 1,
        borderColor: lit ? colour.ink : mix(colour.line, 0.76),
        backgroundColor: lit ? colour.ink : mix(colour.surfaceSoft, 0.64),
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'row',
        paddingHorizontal: u(6),
        transform: [{scale: lit ? 1.025 : 1}],
      }}
    >
      {chip.icon ? (
        <View style={{marginRight: u(8.8)}}>
          <ViewGlyph icon={chip.icon} color={ink} />
        </View>
      ) : null}
      <View style={chip.icon ? undefined : {flexShrink: 1}}>
        <T size={chip.icon ? 10.56 : 10.56} weight={chip.icon ? 900 : 680} lh={chip.icon ? 16.2 : 15} color={ink} style={chip.icon ? undefined : {textAlign: 'center'}}>
          {capitalise(chip.label)}
        </T>
      </View>
    </Pressable>
  );
}

/** Capitalises the first letter of each word and leaves the rest alone (CSS `text-transform: capitalize`), so "TV" stays "TV". */
function capitalise(text: string): string {
  return text.replace(/(^|\s)(\S)/g, (_match, space: string, letter: string) => `${space}${letter.toUpperCase()}`);
}

function Row({row, x, y, w, onReveal}: {row: DrawerRow; x: number; y: number; w: number; onReveal: (y: number, h: number) => void}): React.ReactElement {
  const {colour} = useTheme();
  const [focused, setFocused] = useState(false);
  const lit = focused || row.selected;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={row.title}
      accessibilityState={{selected: row.selected}}
      onFocus={() => {
        setFocused(true);
        onReveal(y, CHIP_H);
      }}
      onBlur={() => setFocused(false)}
      onPress={row.onPress}
      style={{
        position: 'absolute',
        left: u(x),
        top: u(y),
        width: u(w),
        height: u(CHIP_H),
        borderRadius: u(12),
        borderWidth: 1,
        borderColor: lit ? colour.ink : mix(colour.line, 0.76),
        backgroundColor: lit ? colour.ink : mix(colour.surfaceSoft, 0.64),
        justifyContent: 'center',
        paddingLeft: u(9.6),
        transform: [{scale: lit ? 1.025 : 1}],
      }}
    >
      <T size={10.56} weight={900} lh={15.8} color={lit ? colour.bg : colour.inkMuted}>
        {row.title}
      </T>
      {row.detail ? (
        <T size={8.6592} weight={680} lh={13} color={lit ? colour.bg : colour.inkMuted}>
          {row.detail}
        </T>
      ) : null}
      {row.selected ? (
        <View style={{position: 'absolute', right: u(13), top: u(18)}}>
          <T size={10.56} weight={680} lh={16.2} color="#cf3157">
            {'\u2713'}
          </T>
        </View>
      ) : null}
    </Pressable>
  );
}
