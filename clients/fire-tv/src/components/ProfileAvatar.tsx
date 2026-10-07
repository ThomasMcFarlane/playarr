/**
 * The circular gradient avatar every profile choice on `ProfilesScreen`
 * renders -- design doc §7's closing paragraph: "Six gradient presets
 * rendered at runtime via linear-gradient -- no pre-baked PNGs needed
 * (unlike Roku)". The gradient pair and the deterministic profile-id-to-
 * preset hash both live in `profileAvatarPresets.ts` (kept dependency-free
 * there so they can be unit-tested -- see that file's doc comment for the
 * full "why a separate copy, not an import" explanation).
 *
 * Each of the six presets gets its own small monochrome glyph on top of the
 * gradient -- astronaut/cat/dinosaur/robot/pirate/alien, matching
 * `clients/tv-web/web/src/components/ProfileAvatar.tsx`'s own
 * `PresetArtwork` -- redrawn path-for-path with
 * `@amazon-devices/react-native-svg` in place of the web version's DOM
 * `<svg>`. Deliberately preset-only for this pass, not the web version's
 * full `ProfileAvatarPreference` union: see `profileAvatarPresets.ts`'s
 * doc comment for exactly why the `{kind: 'custom', dataUrl}` photo-upload
 * variant is out of scope here.
 */
import React from 'react';
import {StyleSheet, View, type StyleProp, type ViewStyle} from 'react-native';
import LinearGradient from '@amazon-devices/react-linear-gradient';
import Svg, {Circle, Path} from '@amazon-devices/react-native-svg';
import {pickProfileAvatarPreset, type ProfileAvatarPresetId} from './profileAvatarPresets';

export interface ProfileAvatarProps {
  /** The profile this avatar represents -- its id alone determines which of the six presets renders, via `pickProfileAvatarPreset`. */
  profileId: string;
  size?: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * Glyph path data copied character-for-character from
 * `clients/tv-web/web/src/components/ProfileAvatar.tsx`'s `PresetArtwork`
 * (each `viewBox="0 0 100 100"` `<svg>` block there maps onto one `case`
 * below), redrawn with `Path`/`Circle` from `@amazon-devices/react-native-svg`.
 */
function PresetGlyph({preset}: {preset: ProfileAvatarPresetId}) {
  switch (preset) {
    case 'astronaut':
      return (
        <>
          <Circle cx={50} cy={42} r={29} fill="#eef5ff" />
          <Circle cx={50} cy={42} r={21} fill="#21315f" />
          <Path d="M31 77c4-13 14-20 19-20s15 7 19 20" fill="#eef5ff" />
          <Circle cx={43} cy={39} r={3} fill="#fff" />
          <Circle cx={57} cy={39} r={3} fill="#fff" />
          <Path
            d="M44 49c4 3 8 3 12 0"
            fill="none"
            stroke="#fff"
            strokeWidth={3}
            strokeLinecap="round"
          />
          <Path d="M21 25l-7-6m65 6 7-6" stroke="#d7e5ff" strokeWidth={4} strokeLinecap="round" />
        </>
      );
    case 'cat':
      return (
        <>
          <Path
            d="M24 37 18 15l25 13h14l25-13-6 22c8 7 12 17 10 28-3 17-18 25-36 25S17 82 14 65c-2-11 2-21 10-28Z"
            fill="#ffe0bd"
          />
          <Path d="m24 28-2-8 11 6m43 2 2-8-11 6" fill="#ef8c92" />
          <Path d="M32 52h8m20 0h8" stroke="#4b3550" strokeWidth={5} strokeLinecap="round" />
          <Path
            d="m46 62 4 3 4-3m-4 3v6"
            fill="none"
            stroke="#4b3550"
            strokeWidth={3}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Path
            d="M35 65 15 60m20 11-20 5m50-11 20-5m-20 11 20 5"
            stroke="#fff2df"
            strokeWidth={2.5}
            strokeLinecap="round"
          />
        </>
      );
    case 'dinosaur':
      return (
        <>
          <Path
            d="m28 29-9-14 17 4 5-12 10 13 12-9 2 17c14 5 23 16 23 29 0 18-16 31-38 31S12 75 12 57c0-12 6-22 16-28Z"
            fill="#bde78b"
          />
          <Circle cx={38} cy={49} r={5} fill="#254b45" />
          <Circle cx={65} cy={49} r={5} fill="#254b45" />
          <Circle cx={39} cy={47} r={1.5} fill="#fff" />
          <Circle cx={66} cy={47} r={1.5} fill="#fff" />
          <Path
            d="M38 66c8 7 17 7 25 0"
            fill="none"
            stroke="#254b45"
            strokeWidth={4}
            strokeLinecap="round"
          />
          <Path d="m45 67 3 7 4-6 4 6 3-7" fill="#fff" />
        </>
      );
    case 'robot':
      return (
        <>
          <Path d="M50 20V9m0 0 7-5M50 9l-7-5" stroke="#e8fbff" strokeWidth={4} strokeLinecap="round" />
          <Path d="M17 20h66v62H17z" fill="#dff7f7" />
          <Path d="M26 34h48v31H26z" fill="#294263" />
          <Circle cx={40} cy={49} r={5} fill="#72e3d3" />
          <Circle cx={60} cy={49} r={5} fill="#72e3d3" />
          <Path d="M40 72h20" stroke="#6a91a3" strokeWidth={4} strokeLinecap="round" />
          <Path
            d="M17 43H9v18h8m66-18h8v18h-8"
            fill="none"
            stroke="#dff7f7"
            strokeWidth={6}
            strokeLinejoin="round"
          />
        </>
      );
    case 'pirate':
      return (
        <>
          <Circle cx={50} cy={53} r={34} fill="#f3c49e" />
          <Path d="M18 35c7-20 54-25 68 2-23-8-44-6-68-2Z" fill="#802f4b" />
          <Path d="M21 31 12 17c15-4 29 1 38 11" fill="#c84b58" />
          <Circle cx={38} cy={52} r={4} fill="#3a2935" />
          <Path d="M58 52h13m-7-8v16" stroke="#3a2935" strokeWidth={4} strokeLinecap="round" />
          <Path d="M53 44c9-5 19-3 25 4" fill="none" stroke="#3a2935" strokeWidth={4} />
          <Path
            d="M39 68c9 7 19 7 27-1"
            fill="none"
            stroke="#7e3e3f"
            strokeWidth={4}
            strokeLinecap="round"
          />
        </>
      );
    case 'alien':
      return (
        <>
          <Path
            d="M50 10c25 0 39 17 35 39-4 21-22 39-35 43-13-4-31-22-35-43C11 27 25 10 50 10Z"
            fill="#c7f0bd"
          />
          <Path
            d="M25 43c9-8 18-8 24 1-5 14-17 18-24-1Zm50 0c-9-8-18-8-24 1 5 14 17 18 24-1Z"
            fill="#292949"
          />
          <Circle cx={38} cy={45} r={2} fill="#fff" />
          <Circle cx={62} cy={45} r={2} fill="#fff" />
          <Path
            d="M42 72c5 2 11 2 16 0"
            fill="none"
            stroke="#4b765d"
            strokeWidth={3}
            strokeLinecap="round"
          />
          <Circle cx={18} cy={20} r={3} fill="#e8dcff" />
          <Circle cx={83} cy={17} r={2} fill="#e8dcff" />
        </>
      );
  }
}

const styles = StyleSheet.create({
  root: {
    borderRadius: 999,
    overflow: 'hidden',
  },
});

const DEFAULT_SIZE = 96;

export function ProfileAvatar(props: ProfileAvatarProps): React.ReactElement {
  const {profileId, size = DEFAULT_SIZE, style} = props;
  const preset = pickProfileAvatarPreset(profileId);

  return (
    <View style={[styles.root, {width: size, height: size}, style]}>
      <LinearGradient
        style={StyleSheet.absoluteFillObject}
        colors={[preset.start, preset.end]}
        start={{x: 0, y: 0}}
        end={{x: 1, y: 1}}
      />
      <Svg width={size} height={size} viewBox="0 0 100 100" style={StyleSheet.absoluteFillObject}>
        <PresetGlyph preset={preset.id} />
      </Svg>
    </View>
  );
}
