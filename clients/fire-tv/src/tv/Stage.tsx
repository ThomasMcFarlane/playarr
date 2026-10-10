/**
 * The web TV stage behind Home, the libraries and the detail pages: the `.tv-key-art` image with its fades and the
 * `.tv-stage-wash`, drawn at the web's 1920x1080 measurements.
 *
 * Vega has no CSS filters or masks. The web draws the art with `grayscale(1) contrast(.82) brightness(.6)` at 72% opacity
 * (dark) or `grayscale(1) contrast(.88) brightness(1.1)` at 40% (light) and masks its right edge to transparent. The server
 * bakes exactly that into a PNG (`?style=stage` or `stage-light`), so the device draws it as is. A server without the style
 * answers with an error and the art falls back to the colour original under a veil.
 */
import React, {useState} from 'react';
import {StyleSheet, View} from 'react-native';
import LinearGradient from '@amazon-devices/react-linear-gradient';
import {ArtworkImage} from '../components/ArtworkImage';
import {mix} from '../theme/color';
import {useTheme} from '../theme/ThemeProvider';
import {Box, Fill, u} from './kit';

export interface StageProps {
  artUri?: string | null;
  accessToken?: string;
  children?: React.ReactNode;
}

function clear(colour: string): string {
  return mix(colour, 0);
}

/**
 * The server-baked key art look for the theme. `stage-grey` is an opaque greyscale JPEG (the web's greyscale, contrast and
 * brightness; the opacity and the edge fade are applied here); `stage` and `stage-light` are the older PNGs with opacity and a
 * fade baked in, about twenty times larger.
 */
export function styledArtUri(uri: string, dark: boolean, style: 'grey' | 'png' = 'grey'): string {
  const name = style === 'grey' ? (dark ? 'stage-grey' : 'stage-grey-light') : dark ? 'stage' : 'stage-light';
  return `${uri}${uri.includes('?') ? '&' : '?'}style=${name}`;
}

/** A server that does not know the style: the original colour art with a veil and an edge gradient, as before. */
function LegacyArt({uri, accessToken, dark, surface}: {uri: string; accessToken?: string; dark: boolean; surface: string}): React.ReactElement {
  return (
    <View style={StyleSheet.absoluteFill}>
      <View style={[StyleSheet.absoluteFill, {opacity: dark ? 0.72 : 0.4}]}>
        <ArtworkImage uri={uri} accessToken={accessToken} style={{width: '100%', height: '100%'}} resizeMode="cover" />
        <Fill style={{backgroundColor: dark ? 'rgba(0,0,0,0.4)' : 'rgba(255,255,255,0.1)'}} />
      </View>
      <LinearGradient
        style={StyleSheet.absoluteFill}
        start={{x: 0, y: 0}}
        end={{x: 1, y: 0}}
        colors={[clear(surface), clear(surface), surface]}
        locations={[0, 0.72, 1]}
      />
    </View>
  );
}

/** What the server could do the last time the key art was asked for: remembered, so a server without `stage-grey` is not asked again. */
type ArtTier = 'grey' | 'png' | 'legacy';
let artTier: ArtTier = 'grey';

export function Stage({artUri, accessToken, children}: StageProps): React.ReactElement {
  const {colour, scheme} = useTheme();
  const dark = scheme === 'dark';
  const surface = colour.surface;
  const [tier, setTierState] = useState<ArtTier>(artTier);
  const setTier = (next: ArtTier): void => {
    artTier = next;
    setTierState(next);
  };
  return (
    <View style={[StyleSheet.absoluteFill, {backgroundColor: surface, overflow: 'hidden'}]}>
      {artUri ? (
        <Box x={-20} y={-22.9} w={1038.3} h={1190.6} style={{overflow: 'hidden'}}>
          {/* The server bakes the web's greyscale, contrast and brightness (`stage-grey`); the opacity and the edge mask are applied
              here. A server that predates it answers with the PNG look, and one that knows neither gets the colour original. */}
          {tier === 'grey' ? (
            <View style={[StyleSheet.absoluteFill, {opacity: dark ? 0.72 : 0.4}]}>
              <ArtworkImage uri={styledArtUri(artUri, dark)} accessToken={accessToken} style={{width: '100%', height: '100%'}} resizeMode="cover" onFailed={() => setTier('png')} />
            </View>
          ) : tier === 'png' ? (
            <ArtworkImage uri={styledArtUri(artUri, dark, 'png')} accessToken={accessToken} style={{width: '100%', height: '100%'}} resizeMode="cover" onFailed={() => setTier('legacy')} />
          ) : (
            <LegacyArt uri={artUri} accessToken={accessToken} dark={dark} surface={surface} />
          )}
          {/* The web masks the cropped image box: solid to 72% of its width, then to transparent. */}
          <LinearGradient
            style={StyleSheet.absoluteFill}
            start={{x: 0, y: 0}}
            end={{x: 1, y: 0}}
            colors={[clear(surface), clear(surface), surface]}
            locations={[0, 0.72, 1]}
            pointerEvents="none"
          />
        </Box>
      ) : null}
      <LinearGradient
        style={StyleSheet.absoluteFill}
        start={{x: 0, y: 0}}
        end={{x: 1, y: 0}}
        colors={[surface, clear(surface), clear(surface)]}
        locations={[0, 0.22, 1]}
        pointerEvents="none"
      />
      <LinearGradient
        style={StyleSheet.absoluteFill}
        start={{x: 0, y: 0}}
        end={{x: 0, y: 1}}
        colors={[surface, clear(surface), clear(surface), surface]}
        locations={[0, 0.22, 0.82, 1]}
        pointerEvents="none"
      />
      <LinearGradient
        style={StyleSheet.absoluteFill}
        start={{x: 0, y: 0}}
        end={{x: 1, y: 0}}
        colors={[mix(surface, 0.94), mix(surface, 0.9), clear(surface)]}
        locations={[0, 0.36, 0.52]}
        pointerEvents="none"
      />
      <LinearGradient
        style={StyleSheet.absoluteFill}
        start={{x: 1, y: 0}}
        end={{x: 0, y: 0}}
        colors={[mix(surface, 0.5), clear(surface)]}
        locations={[0, 0.34]}
        pointerEvents="none"
      />
      {children}
    </View>
  );
}

/** The frosted panel behind the Home rails: the `tv-home-rails` gradient from x = 38% to the right edge. */
export function RailFrost({dark, soft, strong, x = 729.6}: {dark: boolean; soft: string; strong: string; x?: number}): React.ReactElement {
  // frost = color-mix(surface-soft 44% (48% light), surface-strong); stops fade it in from transparent.
  const k = dark ? 0.44 : 0.48;
  const [a, b, c] = dark ? [0.72, 0.9, 0.97] : [0.68, 0.88, 0.96];
  const frost = blendHex(soft, strong, k);
  return (
    <LinearGradient
      style={{position: 'absolute', left: u(x), top: 0, width: u(1920 - x), height: u(1080)}}
      start={{x: 0, y: 0}}
      end={{x: 1, y: 0}}
      colors={[mix(frost, 0), mix(frost, a), mix(frost, b), mix(frost, c), frost]}
      locations={[0, 0.12, 0.34, 0.62, 1]}
      pointerEvents="none"
    />
  );
}

function blendHex(a: string, b: string, fraction: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (shift: number) => Math.round(((pa >> shift) & 255) * fraction + ((pb >> shift) & 255) * (1 - fraction));
  return `#${[16, 8, 0].map((s) => ch(s).toString(16).padStart(2, '0')).join('')}`;
}
