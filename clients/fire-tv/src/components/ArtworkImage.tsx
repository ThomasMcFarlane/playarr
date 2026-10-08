/**
 * The dual-strategy authed image every poster/backdrop in this app renders
 * through -- design doc §1.3 assumption A4 and §2's file-purpose comment:
 * "dual-strategy authed image (header vs data-uri) -- assumption A4".
 *
 * Every Streamarr artwork endpoint (`api/artworkUrl.ts`'s
 * `workArtworkUrl`/`albumArtworkUrl`) requires `Authorization: Bearer`.
 * Whether RN's `<Image source={{uri, headers}}>` actually attaches
 * `headers` to the underlying native image request on Vega is unverified
 * (assumption A4, design doc §9.2 R10) -- `platform/capabilities.ts`'s
 * `artworkRequestHeaders` flag records the current best guess (`true`) and
 * is the ONE place that guess would need flipping if a real device proves
 * it wrong. This component reads that flag and switches strategy
 * accordingly, rather than either strategy being hard-coded:
 *
 *  - `header` (the default, assumed-working path): render `<Image
 *    source={{uri, headers}}>` directly -- one native image request, no
 *    JS-side fetch, no re-encoding.
 *  - `dataUri` (the fallback, exercised only if `artworkRequestHeaders` is
 *    ever flipped to `false`): fetch the bytes in JS (where `Authorization`
 *    genuinely works), inline them as a `data:` URI via
 *    `artworkDataUri.ts`, and hand THAT to `<Image source={{uri}}>` with no
 *    headers at all -- the credential never reaches the native image
 *    loader, sidestepping the assumption entirely at the cost of a slower,
 *    JS-mediated load and no native image-cache reuse across screens.
 *
 * `uri`/`accessToken` are passed in by the caller rather than this
 * component reaching into `ApiClientProvider` itself: `ApiClientProvider`
 * does not yet expose the current access token via a hook (design doc §4.5
 * and that file's own doc comment -- it is deliberately narrower than the
 * web version for now), and the established pattern elsewhere in this app
 * (`ApiClientProvider.tsx`'s own doc comment on `TokenStore`) is that
 * multiple independent `new TokenStore()` call sites are normal; a caller
 * that already has the token in scope (most screens will, from whatever
 * fetched the `Work`/`Album` this artwork belongs to) can simply pass it
 * through without this component needing its own opinion on where a token
 * comes from.
 */
import React, {useEffect, useRef, useState} from 'react';
import {Image, StyleSheet, View, type ImageResizeMode, type ImageStyle, type StyleProp} from 'react-native';
import {CAPABILITIES} from '../platform';
import {colour} from '../theme/tokens';
import {artworkAuthHeaders} from '../api/artworkUrl';
import {bytesToDataUri} from './artworkDataUri';

export interface ArtworkImageProps {
  /** The authed artwork URL, typically built by `api/artworkUrl.ts`'s `workArtworkUrl`/`albumArtworkUrl`. `null`/`undefined` renders `fallback` immediately with no network activity at all. */
  uri: string | null | undefined;
  accessToken: string | undefined;
  style?: StyleProp<ImageStyle>;
  resizeMode?: ImageResizeMode;
  accessibilityLabel?: string;
  /** Rendered in place of the image while there is no `uri`, or after the image (in either strategy) fails to load -- typically a plain tinted `<View>` or a small glyph, never left as a blank rectangle. */
  fallback?: React.ReactNode;
  /** Called once when the image could not be loaded (a missing artwork, a refused style, a network failure). */
  onFailed?: () => void;
  /**
   * Where a cropped picture sits in its box, as CSS `object-position`'s vertical value (0 top, 0.5 centre, 1 bottom). The web
   * crops headshots at 20%; React Native only centres, so the picture is laid out by hand once its size is known.
   */
  focalY?: number;
}

const styles = StyleSheet.create({
  fill: {
    width: '100%',
    height: '100%',
  },
  placeholder: {
    width: '100%',
    height: '100%',
    backgroundColor: colour.surfaceSoft,
  },
});

/**
 * The `dataUri` strategy's own fetch-and-encode step, split out as a plain
 * async function (rather than inlined in the effect below) purely for
 * readability -- it is still only ever called from this file, so it is not
 * exported.
 */
async function fetchAsDataUri(uri: string, accessToken: string | undefined): Promise<string> {
  const response = await fetch(uri, {headers: artworkAuthHeaders(accessToken)});
  if (!response.ok) throw new Error(`artwork request failed: ${response.status}`);
  const buffer = await response.arrayBuffer();
  const mimeType = response.headers.get('content-type') ?? 'image/*';
  return bytesToDataUri(new Uint8Array(buffer), mimeType);
}

export function ArtworkImage(props: ArtworkImageProps): React.ReactElement {
  const {uri, accessToken, style, resizeMode = 'cover', accessibilityLabel, fallback, onFailed, focalY} = props;
  const [natural, setNatural] = useState<{width: number; height: number} | null>(null);
  const [box, setBox] = useState<{width: number; height: number} | null>(null);
  const [failed, setFailed] = useState(false);
  const onFailedRef = useRef(onFailed);
  onFailedRef.current = onFailed;
  useEffect(() => {
    if (failed) onFailedRef.current?.();
  }, [failed]);
  // Only meaningful under the `dataUri` strategy -- `undefined` while a fetch
  // is in flight (or before one has started), the resolved `data:` URI once
  // it completes.
  const [dataUri, setDataUri] = useState<string | undefined>(undefined);

  const useDataUriStrategy = !CAPABILITIES.artworkRequestHeaders;

  useEffect(() => {
    setFailed(false);
    setDataUri(undefined);
    if (!useDataUriStrategy || !uri) return;
    let cancelled = false;
    fetchAsDataUri(uri, accessToken)
      .then((resolved) => {
        if (!cancelled) setDataUri(resolved);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [uri, accessToken, useDataUriStrategy]);

  if (!uri || failed) {
    return <View style={[styles.placeholder, style]}>{fallback}</View>;
  }

  if (useDataUriStrategy) {
    if (!dataUri) {
      // Still fetching/encoding -- render the same placeholder a missing
      // uri would, rather than a distinct "loading" visual: on a rail of a
      // dozen posters this state is typically visible for a single frame,
      // and a bespoke spinner per-tile would be noisier than useful.
      return <View style={[styles.placeholder, style]}>{fallback}</View>;
    }
    return (
      <Image
        source={{uri: dataUri}}
        style={[styles.fill, style]}
        resizeMode={resizeMode}
        accessibilityLabel={accessibilityLabel}
        onError={() => setFailed(true)}
      />
    );
  }

  if (focalY !== undefined && resizeMode === 'cover') {
    // `cover` with the picture's own aspect: scale to fill the box, then place it at `focalY` of the overflow.
    const fit =
      natural && box
        ? (() => {
            const scale = Math.max(box.width / natural.width, box.height / natural.height);
            const width = natural.width * scale;
            const height = natural.height * scale;
            return {left: (box.width - width) * 0.5, top: (box.height - height) * focalY, width, height};
          })()
        : null;
    return (
      <View style={[styles.fill, style, {overflow: 'hidden'}]} onLayout={(event) => setBox(event.nativeEvent.layout)}>
        <Image
          source={{uri, headers: artworkAuthHeaders(accessToken)}}
          style={fit ? {position: 'absolute', ...fit} : styles.fill}
          resizeMode={fit ? 'stretch' : 'cover'}
          accessibilityLabel={accessibilityLabel}
          onLoad={(event) => {
            const source = (event.nativeEvent as {source?: {width?: number; height?: number}}).source;
            if (source?.width && source?.height) setNatural({width: source.width, height: source.height});
          }}
          onError={() => setFailed(true)}
        />
      </View>
    );
  }

  return (
    <Image
      source={{uri, headers: artworkAuthHeaders(accessToken)}}
      style={[styles.fill, style]}
      resizeMode={resizeMode}
      accessibilityLabel={accessibilityLabel}
      onError={() => setFailed(true)}
    />
  );
}
