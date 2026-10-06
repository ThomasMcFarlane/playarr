/**
 * Renders a QR code entirely offline, from `qrcode`'s SVG output re-drawn
 * with `react-native-svg` primitives -- design doc §5.3's explicit
 * instruction: "Never round-trip the pairing URL to a third-party QR
 * service", and specifically do NOT copy Roku's
 * `https://playarr.app/api/link/qr?value=…`, which the worker implements no
 * route for (design doc §9.4 R29: Roku's own pairing QR is broken today).
 * `verification_uri_complete` is a capability-bearing secret-shaped URL
 * (whoever scans it can complete this TV's pairing); it must never leave
 * the device over the network just to be turned into an image.
 *
 * `@playarr-tv/device-auth`'s own `createQrCodeSvg` is reused verbatim for
 * the actual QR encoding (same `qrcode` call, same `errorCorrectionLevel`/
 * `margin` -- so a Fire TV's QR looks visually consistent with every other
 * Playarr client's) -- see that package's doc comment. What it returns is
 * an SVG **string**, e.g.:
 *
 *   <svg xmlns="..." width="240" height="240" viewBox="0 0 33 33" shape-rendering="crispEdges">
 *     <path fill="#ffffff" d="M0 0h33v33H0z"/>
 *     <path stroke="#000000" d="M2 2.5h7m2 0h2..."/>
 *   </svg>
 *
 * `react-native-svg` cannot render a raw SVG string (there is no RN
 * equivalent of the web's `dangerouslySetInnerHTML` for this, and this
 * package's `qrcode`-string shape is otherwise identical across every
 * value/size this app ever requests -- verified directly against
 * `qrcode`'s own renderer source, `lib/renderer/svg-tag.js`: always exactly
 * one background `<path fill="…">` (present unless the background colour's
 * alpha is fully transparent, never the case here) and one modules
 * `<path stroke="…">`, inside a `viewBox="0 0 N N"` sized to the QR's
 * module grid plus margin). `parseQrCodeSvg` below extracts those two
 * paths' `d`/`fill`/`stroke` attributes with a small, tolerant regex parser
 * -- not a full XML parser (`xmldom`, already a dependency for Shaka's DASH
 * parsing, is deliberately not reached for here: this SVG shape is simple
 * and stable enough that pulling in a general-purpose parser would be
 * solving a harder problem than the one that exists) -- rather than
 * hard-coding `qrcode`'s exact current output as a template, so a future
 * `qrcode` upgrade that reorders attributes, or omits the background path
 * when a fully transparent colour is ever configured, degrades gracefully
 * (this component renders nothing) instead of rendering garbage geometry.
 *
 * The default SVG stroke-width -- deliberately absent from `qrcode`'s own
 * output -- is `1` per the SVG spec's initial value, which is exactly one
 * module-width in this viewBox's units; `<Path strokeWidth={1}>` below
 * states that explicitly rather than relying on react-native-svg also
 * defaulting to the same value, since that default is an implementation
 * detail of the SVG spec this file should not have to trust silently.
 */
import * as React from 'react';
import {useEffect, useState} from 'react';
import Svg, {Path} from '@amazon-devices/react-native-svg';
import {createQrCodeSvg} from '@playarr-tv/device-auth';

/** The pieces of `qrcode`'s SVG output this component actually needs to redraw it with `react-native-svg`. */
export interface QrCodeGeometry {
  viewBoxWidth: number;
  viewBoxHeight: number;
  /** `d` of the background fill path, if `qrcode` emitted one (it does by default; omitted only for a fully transparent background colour, which this app never configures). */
  backgroundD?: string;
  backgroundFill?: string;
  /** `d` of the QR modules path -- always present in a valid QR SVG; its absence means the string did not parse as one. */
  modulesPath: string;
  moduleColor: string;
}

const VIEW_BOX_RE = /viewBox="0 0 ([\d.]+) ([\d.]+)"/;
const PATH_TAG_RE = /<path\s+([^>]*?)\/>/g;
const ATTRIBUTE_RE = /([a-zA-Z-]+)="([^"]*)"/g;

function parsePathAttributes(rawAttributes: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  ATTRIBUTE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ATTRIBUTE_RE.exec(rawAttributes)) !== null) {
    const [, name, value] = match;
    if (name !== undefined && value !== undefined) attributes[name] = value;
  }
  return attributes;
}

/**
 * Parses `qrcode`'s `toString(value, {type: 'svg'})` output into the pieces
 * needed to redraw it with `react-native-svg`. Returns `undefined` -- never
 * throws -- for anything that doesn't look like that shape, so a rendering
 * caller can treat "failed to parse" exactly like "hasn't loaded yet".
 * Exported (not just used internally) so it is unit-testable on its own,
 * without needing to render an actual `<Svg>`/`<Path>` tree.
 */
export function parseQrCodeSvg(svg: string): QrCodeGeometry | undefined {
  const viewBoxMatch = VIEW_BOX_RE.exec(svg);
  if (!viewBoxMatch) return undefined;
  const viewBoxWidth = Number(viewBoxMatch[1]);
  const viewBoxHeight = Number(viewBoxMatch[2]);
  if (!Number.isFinite(viewBoxWidth) || !Number.isFinite(viewBoxHeight)) return undefined;

  let backgroundD: string | undefined;
  let backgroundFill: string | undefined;
  let modulesPath: string | undefined;
  let moduleColor: string | undefined;

  PATH_TAG_RE.lastIndex = 0;
  let pathMatch: RegExpExecArray | null;
  while ((pathMatch = PATH_TAG_RE.exec(svg)) !== null) {
    const rawAttributes = pathMatch[1];
    if (rawAttributes === undefined) continue;
    const attributes = parsePathAttributes(rawAttributes);
    if (attributes.stroke && attributes.d) {
      modulesPath = attributes.d;
      moduleColor = attributes.stroke;
    } else if (attributes.fill && attributes.d) {
      backgroundD = attributes.d;
      backgroundFill = attributes.fill;
    }
  }

  if (!modulesPath || !moduleColor) return undefined;

  return {viewBoxWidth, viewBoxHeight, backgroundD, backgroundFill, modulesPath, moduleColor};
}

export interface QrCodeProps {
  /** The URL (or other payload) to encode -- e.g. `HostedLinkCode.verificationUriComplete`. */
  value: string;
  /** Rendered size in dp, both axes (the QR is always square). Matches `createQrCodeSvg`'s own `width` parameter, which also drives the module count via `qrcode`'s error-correction sizing. */
  size?: number;
  /** Accessibility label -- LinkScreen supplies a real one; this default exists only so the component is never silently unlabelled. */
  accessibilityLabel?: string;
}

/**
 * An offline-rendered QR code. Nothing here ever touches the network beyond
 * what `qrcode`'s pure, local encoding already does (none) -- see this
 * file's top comment for why that property is load-bearing, not incidental.
 */
export function QrCode({value, size = 240, accessibilityLabel}: QrCodeProps): React.ReactElement | null {
  const [geometry, setGeometry] = useState<QrCodeGeometry | undefined>(undefined);

  // Synchronising with an external system: `qrcode`'s `toString` is
  // Promise-based even though the encoding itself is local and effectively
  // synchronous (no I/O) -- there is no synchronous variant of this API to
  // call during render instead, so this is exactly the case this repo's own
  // React rule carves out for `useEffect`, and is the same shape tv-web's
  // own `QrCode.tsx` uses for the identical reason.
  useEffect(() => {
    let cancelled = false;
    setGeometry(undefined);
    void createQrCodeSvg(value, size).then((svg) => {
      if (!cancelled) setGeometry(parseQrCodeSvg(svg));
    });
    return () => {
      cancelled = true;
    };
  }, [value, size]);

  if (!geometry) return null;

  return (
    <Svg
      width={size}
      height={size}
      viewBox={`0 0 ${geometry.viewBoxWidth} ${geometry.viewBoxHeight}`}
      accessible
      accessibilityLabel={accessibilityLabel}
    >
      {geometry.backgroundD ? <Path d={geometry.backgroundD} fill={geometry.backgroundFill} /> : null}
      <Path d={geometry.modulesPath} stroke={geometry.moduleColor} strokeWidth={1} fill="none" />
    </Svg>
  );
}
