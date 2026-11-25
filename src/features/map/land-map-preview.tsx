import { Camera, Map, Marker, type CameraRef, type InitialViewState } from '@maplibre/maplibre-react-native';
import { useIsFocused, useNavigation } from 'expo-router';
import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import { formatNumber, polygonAcres } from '@/lib/format';
import type { LandType, LngLat } from '@/lib/types';
import { Label } from '@/ui/text';
import { colors, radius, shadow, space } from '@/theme/tokens';

import { FocusParcel, type FocusTarget } from './focus-parcel';
import { useBasemap } from './map-basemap';
import { MapPin } from './map-markers';
import { MapModeLayers } from './map-modes';
import { useOrbit } from './map-orbit';
import { MapSkeleton } from './map-skeleton';
import { APPROX_RADIUS_M, boundsOf, circleRing, formatDistance, openRing, withAlpha } from './map-style';

/**
 * LandMapPreview — small static map card for the listing detail screen.
 *
 * Props (all but lat/lng optional; existing callers need no change):
 * - `lat`, `lng`: the PUBLIC point (already fuzzed for hidden locations).
 * - `boundary`: exact parcel ring, only when the viewer may see it.
 * - `approximate`: draw the soft ~750 m area instead of a pin and boundary.
 * - `height`: card height in points (default 200).
 * - `landType`: legend colour for the parcel (default agricultural).
 * - `satellite` (default false): Esri World Imagery under labels and roads, with the required
 *   credit drawn in the card. Falls back to the branded map if imagery fails.
 * - `orbit` (default off): after the parcel draws in, the camera turns once, slowly, and stops —
 *   `true` for 90° over 9 s, or `{ degrees, durationMs, delayMs }`. Negative degrees turn
 *   anticlockwise. Skipped when the OS asks for reduced motion. Gestures stay off.
 * - `active` (default true): pass false while the card is scrolled out of view; satellite and
 *   orbit wait for it, and a running orbit stops.
 *
 * Loading order, cheapest first: the map view mounts once the screen's push transition has
 * settled, draws the plain branded map (no imagery, no elevation tiles), then the parcel traces
 * in. Only after that, and only while the screen is focused and the card active, do the extras
 * start: imagery fades in, then the orbit.
 */
export type PreviewOrbit = { degrees?: number; durationMs?: number; delayMs?: number };

export type LandMapPreviewProps = {
  lat: number;
  lng: number;
  boundary?: LngLat[] | null;
  /** Draw a soft area instead of a pin. Pass already-fuzzed coordinates. */
  approximate?: boolean;
  height?: number;
  /** Tints the parcel with its legend colour; defaults to agricultural green. */
  landType?: LandType;
  /** Aerial imagery instead of the vector map, once the plain map has loaded. */
  satellite?: boolean;
  /** One slow partial orbit once the map is up. */
  orbit?: boolean | PreviewOrbit;
  /** False while off screen: holds back imagery and the orbit. */
  active?: boolean;
};

const ORBIT_DEFAULTS: Required<PreviewOrbit> = { degrees: 90, durationMs: 9000, delayMs: 1200 };

const PAD = { top: 40, right: 40, bottom: 44, left: 40 };
const PREVIEW_PITCH = 34;
/** Mount the map view this long after mounting at the latest, if no transition-end event comes. */
const SETTLE_MS = 320;
/** Extras start after the parcel has traced in (950 ms) and had a beat to rest. */
const EXTRAS_AFTER_MS = 1100;

type Listenable = { addListener?: (event: string, cb: () => void) => (() => void) | undefined };

/**
 * True once the screen's push transition has finished (or shortly after mount). Creating a GL map
 * view costs a few frames on the UI thread; doing it after the slide keeps the slide smooth.
 */
function useScreenSettled() {
  const navigation = useNavigation() as unknown as Listenable;
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (settled) return;
    const done = () => setSettled(true);
    const t = setTimeout(done, SETTLE_MS);
    const off = navigation.addListener?.('transitionEnd', done);
    return () => {
      clearTimeout(t);
      off?.();
    };
  }, [navigation, settled]);
  return settled;
}

/**
 * Static, rounded map card for listing details. Every gesture is off and the wrapper ignores
 * touches, so it scrolls with its parent ScrollView. The parcel draws itself in once the tiles
 * are up; approximate listings only ever show the soft area.
 */
export function LandMapPreview({
  lat,
  lng,
  boundary,
  approximate = false,
  height = 200,
  landType = 'agricultural',
  satellite = false,
  orbit,
  active = true,
}: LandMapPreviewProps) {
  const settled = useScreenSettled();
  const focused = useIsFocused();
  const basemap = useBasemap({ timeoutMs: 15_000 });
  const cameraRef = useRef<CameraRef>(null);
  const orbiter = useOrbit(cameraRef);
  const reduced = useReducedMotion();
  const ready = basemap.status === 'ready';
  const plan = orbit ? { ...ORBIT_DEFAULTS, ...(orbit === true ? null : orbit) } : null;
  const planKey = plan ? `${plan.degrees}:${plan.durationMs}:${plan.delayMs}` : null;
  const live = focused && active;

  // Approximate listings never receive a boundary here, but never draw one even if passed.
  const ring = useMemo(() => {
    const open = !approximate && boundary ? openRing(boundary) : null;
    return open && open.length >= 3 ? open : null;
  }, [approximate, boundary]);

  const target = useMemo<FocusTarget>(
    () => ({ id: `preview:${lat}:${lng}`, landType, boundary: ring, center: [lng, lat], approximate }),
    [lat, lng, landType, ring, approximate],
  );

  const view = useMemo<InitialViewState>(() => {
    if (approximate) {
      const bounds = boundsOf(circleRing([lng, lat], APPROX_RADIUS_M, 16));
      if (bounds) return { bounds, padding: PAD };
    }
    const bounds = ring ? boundsOf(ring, 0.0009) : null;
    if (bounds) return { bounds, padding: PAD, pitch: PREVIEW_PITCH };
    return { center: [lng, lat], zoom: 15, pitch: PREVIEW_PITCH };
  }, [approximate, ring, lat, lng]);

  // Satellite and orbit are extras: they wait for the plain map and the parcel, and for the card
  // to be on a focused screen. Once started, imagery stays (its tiles are already paid for).
  const [extras, setExtras] = useState(false);
  const wantsExtras = satellite || !!plan;
  useEffect(() => {
    if (!ready || !live || extras || !wantsExtras) return;
    const t = setTimeout(() => setExtras(true), EXTRAS_AFTER_MS);
    return () => clearTimeout(t);
  }, [ready, live, extras, wantsExtras]);
  const showSatellite = satellite && extras;

  // One-off: starts once the extras are on, then rests. Leaving the screen stops it.
  const didOrbit = useRef(false);
  const startOrbit = useEffectEvent(() => {
    if (!plan || didOrbit.current) return;
    didOrbit.current = true;
    orbiter.start({ fromBearing: 0, sweep: plan.degrees, durationMs: plan.durationMs });
  });
  const stopOrbit = useEffectEvent(() => orbiter.stop());
  useEffect(() => {
    if (!extras || !planKey || reduced || !live || didOrbit.current) return;
    const t = setTimeout(startOrbit, plan?.delayMs ?? ORBIT_DEFAULTS.delayMs);
    return () => clearTimeout(t);
    // `plan` is rebuilt every render; `planKey` is its identity.
  }, [extras, planKey, reduced, live]);
  useEffect(() => {
    if (!live) stopOrbit();
  }, [live]);

  const caption = approximate
    ? `Approximate area · ${formatDistance(APPROX_RADIUS_M)} radius`
    : ring
      ? `Boundary · ${formatNumber(Number(polygonAcres(ring).toFixed(2)))} acres`
      : 'Exact pin';

  return (
    <View style={[styles.card, { height }]} pointerEvents="none">
      <View style={styles.clip}>
        {settled ? (
          <Map
            key={basemap.attempt}
            style={StyleSheet.absoluteFill}
            mapStyle={basemap.mapStyle}
            // TextureView clips to the rounded card on Android; SurfaceView would ignore the radius.
            androidView="texture"
            dragPan={false}
            touchZoom={false}
            doubleTapZoom={false}
            doubleTapHoldZoom={false}
            touchRotate={false}
            touchPitch={false}
            logo={false}
            compass={false}
            scaleBar={false}
            attribution={false}
            onDidFinishLoadingMap={basemap.onDidFinishLoadingMap}
            onDidFailLoadingMap={basemap.onDidFailLoadingMap}>
            <Camera ref={cameraRef} initialViewState={view} {...view} duration={0} />
            <MapModeLayers mode={showSatellite ? 'satellite' : 'map'} enabled={basemap.branded} />

            <FocusParcel target={ready ? target : null} idPrefix="lc-preview" march={false} />

            {approximate ? null : (
              <Marker id="lc-preview-pin" lngLat={[lng, lat]} anchor="bottom">
                <MapPin />
              </Marker>
            )}
          </Map>
        ) : null}
        <MapSkeleton status={basemap.status} compact />
        {ready ? (
          <View style={styles.caption}>
            <Label tone="secondary" style={styles.tabular}>
              {caption}
            </Label>
          </View>
        ) : null}
        {showSatellite ? (
          <View style={styles.credit}>
            <Label tone="secondary" style={styles.creditText} numberOfLines={1}>
              © Esri, Maxar
            </Label>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Shadow and clip live on separate views: iOS drops the shadow of a view that clips.
  card: {
    borderRadius: radius.xl,
    borderCurve: 'continuous',
    backgroundColor: colors.surfaceSunken,
    boxShadow: shadow.card,
  },
  clip: {
    flex: 1,
    borderRadius: radius.xl,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  caption: {
    position: 'absolute',
    left: space[3],
    bottom: space[3],
    paddingHorizontal: space[2],
    paddingVertical: space[1],
    borderRadius: radius.xs,
    borderCurve: 'continuous',
    backgroundColor: withAlpha(colors.surface, 0.9),
  },
  tabular: { fontVariant: ['tabular-nums'] },
  credit: {
    position: 'absolute',
    right: space[3],
    bottom: space[3],
    paddingHorizontal: space[2],
    paddingVertical: space[1],
    borderRadius: radius.xs,
    borderCurve: 'continuous',
    backgroundColor: withAlpha(colors.surface, 0.9),
  },
  creditText: { textTransform: 'none' },
});
