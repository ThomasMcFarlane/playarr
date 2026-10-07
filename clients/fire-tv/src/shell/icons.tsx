/**
 * Line icons the web shell draws (`clients/tv-web/web/src/components/NavIcons.tsx`), as `react-native-svg` paths on the
 * same 24-unit viewBox with the same 1.8 round stroke. `color` replaces the web's `currentColor`.
 */
import React from 'react';
import Svg, {Circle, Path, Rect} from '@amazon-devices/react-native-svg';

export type IconName =
  | 'downloads'
  | 'search'
  | 'home'
  | 'series'
  | 'movies'
  | 'sites'
  | 'music'
  | 'playlists'
  | 'watchlist'
  | 'calendar'
  | 'back'
  | 'filters'
  | 'settings'
  | 'signOut'
  | 'theme'
  | 'chevronDown';

export interface IconProps {
  name: IconName;
  size: number;
  color: string;
  strokeWidth?: number;
}

export function Icon({name, size, color, strokeWidth = 1.8}: IconProps): React.ReactElement {
  const line = {
    fill: 'none',
    stroke: color,
    strokeWidth,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  const solid = {fill: color, stroke: 'none'};
  let body: React.ReactElement;
  switch (name) {
    case 'downloads':
      body = (
        <>
          <Path {...line} d="M12 3v12" />
          <Path {...line} d="m7 10.5 5 4.5 5-4.5" />
          <Path {...line} d="M4.5 18.5v1.5a1 1 0 0 0 1 1h13a1 1 0 0 0 1-1v-1.5" />
        </>
      );
      break;
    case 'search':
      body = (
        <>
          <Circle {...line} cx={10.5} cy={10.5} r={6.5} />
          <Path {...line} d="m15.5 15.5 4.5 4.5" />
        </>
      );
      break;
    case 'home':
      body = (
        <>
          <Path {...line} d="M3 11.5 12 4l9 7.5" />
          <Path {...line} d="M5.5 9.5V20h13V9.5" />
          <Path {...line} d="M10 20v-6h4v6" />
        </>
      );
      break;
    case 'series':
      body = (
        <>
          <Rect {...line} x={4} y={4} width={16} height={16} rx={2} />
          <Path {...line} d="M8 9h8M8 13h8M8 17h5" />
          <Path {...line} d="m10 1 2 3 2-3" />
        </>
      );
      break;
    case 'movies':
      body = (
        <>
          <Rect {...line} x={3} y={5} width={18} height={14} rx={2} />
          <Path {...line} d="m7 5 2-3M13 5l2-3M19 5l2-3" />
          <Path {...solid} d="m10 10 5 2.5-5 2.5z" />
        </>
      );
      break;
    case 'sites':
      body = (
        <>
          <Circle {...line} cx={12} cy={12} r={8.5} />
          <Path
            {...line}
            d="M3.5 12h17M12 3.5c2.2 2.3 3.3 5.1 3.3 8.5S14.2 18.2 12 20.5M12 3.5C9.8 5.8 8.7 8.6 8.7 12s1.1 6.2 3.3 8.5"
          />
        </>
      );
      break;
    case 'music':
      body = (
        <>
          <Path {...line} d="M9 18V6l10-2v12" />
          <Circle {...line} cx={6.5} cy={18.5} r={2.5} />
          <Circle {...line} cx={16.5} cy={16.5} r={2.5} />
          <Path {...line} d="M9 10l10-2" />
        </>
      );
      break;
    case 'playlists':
      body = (
        <>
          <Path {...line} d="M5 6h10M5 10h10M5 14h6" />
          <Path {...line} d="M17 13.5v6" />
          <Path {...line} d="m17 13.5 4-1.5v5.5" />
          <Circle {...line} cx={15.5} cy={19.5} r={1.5} />
          <Circle {...line} cx={19.5} cy={17.5} r={1.5} />
        </>
      );
      break;
    case 'watchlist':
      body = (
        <>
          <Path {...line} d="M6 3.5h12a1 1 0 0 1 1 1V21l-7-4.5L5 21V4.5a1 1 0 0 1 1-1Z" />
          <Path {...line} d="M12 7.5v5M9.5 10h5" />
        </>
      );
      break;
    case 'calendar':
      body = (
        <>
          <Rect {...line} x={3.5} y={5} width={17} height={15} rx={2} />
          <Path {...line} d="M3.5 10h17M8 3v4M16 3v4" />
        </>
      );
      break;
    case 'settings':
      body = (
        <>
          <Circle {...line} cx={12} cy={12} r={3} />
          <Path
            {...line}
            d="M19.4 13.5a7.7 7.7 0 0 0 0-3l2-1.5-2-3.4-2.3.9a7.6 7.6 0 0 0-2.6-1.5L14 2.5h-4l-.5 2.5a7.6 7.6 0 0 0-2.6 1.5l-2.3-.9-2 3.4 2 1.5a7.7 7.7 0 0 0 0 3l-2 1.5 2 3.4 2.3-.9c.77.66 1.65 1.17 2.6 1.5l.5 2.5h4l.5-2.5a7.6 7.6 0 0 0 2.6-1.5l2.3.9 2-3.4z"
          />
        </>
      );
      break;
    case 'signOut':
      body = (
        <>
          <Path {...line} d="M10 5H5v14h5" />
          <Path {...line} d="M13 8l4 4-4 4M8 12h9" />
        </>
      );
      break;
    case 'theme':
      body = (
        <>
          <Path {...line} d="M12 3v2M12 19v2M3 12h2M19 12h2" />
          <Circle {...line} cx={12} cy={12} r={4} />
          <Path {...line} d="m5.64 5.64 1.42 1.42M16.94 16.94l1.42 1.42M18.36 5.64l-1.42 1.42M7.06 16.94l-1.42 1.42" />
        </>
      );
      break;
    case 'chevronDown':
      body = <Path {...line} d="m6 9 6 6 6-6" />;
      break;
    case 'back':
      body = <Path {...line} d="M19 12H5M11 6l-6 6 6 6" />;
      break;
    case 'filters':
      body = (
        <>
          <Path {...line} d="M4 7h10M18 7h2M4 17h2M10 17h10" />
          <Circle {...line} cx={16} cy={7} r={2} />
          <Circle {...line} cx={8} cy={17} r={2} />
        </>
      );
      break;
  }
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {body}
    </Svg>
  );
}
