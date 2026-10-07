/** The Playarr mark, redrawn from `clients/tv-web/web/public/playarr-icon.svg` (the web's `app-logo-icon`); the drop shadow filter is left out. */
import React from 'react';
import Svg, {Defs, LinearGradient, Path, Stop} from '@amazon-devices/react-native-svg';

export function PlayarrLogo({size}: {size: number}): React.ReactElement {
  return (
    <Svg width={size} height={size} viewBox="0 0 512 512">
      <Defs>
        <LinearGradient id="playarr-gradient" x1="92" y1="76" x2="426" y2="438" gradientUnits="userSpaceOnUse">
          <Stop offset="0" stopColor="#F47A91" />
          <Stop offset="0.48" stopColor="#D83F6B" />
          <Stop offset="1" stopColor="#A82051" />
        </LinearGradient>
      </Defs>
      <Path d="M171 92A184 184 0 1 1 92 256" stroke="url(#playarr-gradient)" strokeWidth={38} strokeLinecap="round" fill="none" />
      <Path
        d="M191 151A124 124 0 1 1 151 323"
        stroke="url(#playarr-gradient)"
        strokeWidth={28}
        strokeLinecap="round"
        fill="none"
        opacity={0.78}
      />
      <Path
        d="M199 210A66 66 0 1 1 199 302"
        stroke="url(#playarr-gradient)"
        strokeWidth={20}
        strokeLinecap="round"
        fill="none"
        opacity={0.52}
      />
      <Path
        d="M220 180c0-18 20-29 35-19l130 82c12 8 12 26 0 34l-130 82c-15 10-35-1-35-19Z"
        fill="url(#playarr-gradient)"
      />
      <Path d="M252 226c0-8 9-13 16-9l61 38c6 4 6 12 0 16l-61 38c-7 4-16-1-16-9Z" fill="#FFFFFF" fillOpacity={0.88} />
    </Svg>
  );
}
