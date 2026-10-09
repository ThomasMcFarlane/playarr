/**
 * The circular avatar every profile choice and the shell chip render: the account's server-side preference.
 *
 * - A preset draws the gradient plate and the artwork from the shared source of truth
 *   (`clients/shared/profile-avatars/presets.json`, via `profileAvatarArt.generated.ts`), exactly as the web client's
 *   `ProfileAvatar` does.
 * - A custom photo is the account's resized JPEG data URL, cropped to the circle.
 * - With no preference set the preset is picked from a hash of the profile id (`pickProfileAvatarPreset`), the same
 *   fallback the web client uses.
 */
import React, {useEffect, useState} from 'react';
import {Image, StyleSheet, View, type StyleProp, type ViewStyle} from 'react-native';
import LinearGradient from '@amazon-devices/react-linear-gradient';
import Svg, {Circle, Defs, Path, RadialGradient, Rect, Stop} from '@amazon-devices/react-native-svg';
import {pickProfileAvatarPreset, PROFILE_AVATAR_PRESETS, type ProfileAvatarPresetId} from './profileAvatarPresets';
import {useApiBaseUrl} from '../api/ApiClientProvider';
import {PROFILE_AVATAR_ART} from './profileAvatarArt.generated';
import {profileAvatarScope, readStoredAvatar, subscribeProfileAvatars, type StoredProfileAvatar} from '../lib/profileAvatarPref';

export interface ProfileAvatarProps {
  /** The profile this avatar represents -- its id alone determines which of the six presets renders, via `pickProfileAvatarPreset`. */
  profileId: string;
  /** Draw this preset instead of the stored or default one (the avatar picker's own tiles). */
  presetId?: ProfileAvatarPresetId;
  size?: number;
  style?: StyleProp<ViewStyle>;
}

/** The preset's artwork, drawn from the shared `presets.json` elements (100x100 box). */
function PresetGlyph({preset}: {preset: ProfileAvatarPresetId}) {
  const elements = PROFILE_AVATAR_ART[preset] ?? [];
  return (
    <>
      {elements.map((element, index) => {
        const props = element.props as Record<string, never>;
        switch (element.tag) {
          case 'circle':
            return <Circle key={index} {...props} />;
          case 'rect':
            return <Rect key={index} {...props} />;
          default:
            return <Path key={index} {...props} />;
        }
      })}
    </>
  );
}

const styles = StyleSheet.create({
  root: {
    borderRadius: 999,
    overflow: 'hidden',
  },
});

const DEFAULT_SIZE = 96;

/** The web's `radial-gradient(circle at 34% 26%, rgba(255,255,255,.28), transparent 27%)` sheen over every avatar. */
export function AvatarHighlight({size}: {size: number}): React.ReactElement {
  return (
    <Svg width={size} height={size} style={StyleSheet.absoluteFillObject} pointerEvents="none">
      <Defs>
        <RadialGradient id="avatar-sheen" cx={size * 0.34} cy={size * 0.26} r={size * 0.268} gradientUnits="userSpaceOnUse">
          <Stop offset="0" stopColor="#ffffff" stopOpacity={0.28} />
          <Stop offset="1" stopColor="#ffffff" stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Circle cx={size / 2} cy={size / 2} r={size / 2} fill="url(#avatar-sheen)" />
    </Svg>
  );
}

export function ProfileAvatar(props: ProfileAvatarProps): React.ReactElement {
  const {profileId, presetId, size = DEFAULT_SIZE, style} = props;
  const [apiBaseUrl] = useApiBaseUrl();
  const scope = profileAvatarScope(apiBaseUrl, profileId);
  const [stored, setStored] = useState<StoredProfileAvatar | undefined>(() => readStoredAvatar(scope));
  useEffect(() => {
    setStored(readStoredAvatar(scope));
    return subscribeProfileAvatars(() => setStored(readStoredAvatar(scope)));
  }, [scope]);

  if (!presetId && stored?.kind === 'custom') {
    return (
      <View style={[styles.root, {width: size, height: size}, style]}>
        <Image
          accessibilityIgnoresInvertColors
          source={{uri: stored.dataUrl}}
          resizeMode="cover"
          style={StyleSheet.absoluteFillObject}
        />
      </View>
    );
  }

  const chosen = presetId ?? (stored?.kind === 'preset' ? stored.preset : undefined);
  const preset = chosen ? PROFILE_AVATAR_PRESETS.find((candidate) => candidate.id === chosen) ?? pickProfileAvatarPreset(profileId) : pickProfileAvatarPreset(profileId);

  return (
    <View style={[styles.root, {width: size, height: size}, style]}>
      <LinearGradient
        style={StyleSheet.absoluteFillObject}
        colors={[preset.start, preset.end]}
        start={{x: 0, y: 0}}
        end={{x: 1, y: 1}}
      />
      <Svg
        width={size * 0.86}
        height={size * 0.86}
        viewBox="0 0 100 100"
        style={{position: 'absolute', left: size * 0.07, top: size * 0.07}}
      >
        <PresetGlyph preset={preset.id} />
      </Svg>
      <AvatarHighlight size={size} />
    </View>
  );
}
