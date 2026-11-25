import type { ExpressionSpecification } from '@maplibre/maplibre-gl-style-spec';
import {
  Camera,
  GeoJSONSource,
  Layer,
  Map,
  Marker,
  UserLocation,
  type CameraRef,
  type InitialViewState,
  type MapRef,
  type ViewStateChangeEvent,
} from '@maplibre/maplibre-react-native';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import { router } from 'expo-router';
import { ChevronLeft, LocateFixed, Trash2, TriangleAlert, Undo2 } from 'lucide-react-native';
import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View, type LayoutChangeEvent, type NativeSyntheticEvent } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  FadeInUp,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { formatNumber, polygonAcres } from '@/lib/format';
import type { LngLat } from '@/lib/types';
import { useListingDraft } from '@/stores/listing-draft';
import { Button } from '@/ui/button';
import { IconButton } from '@/ui/icon-button';
import { PressableScale } from '@/ui/pressable-scale';
import { useScreenInsets } from '@/ui/screen';
import { Segmented } from '@/ui/segmented';
import { Label, Text } from '@/ui/text';
import { colors, font, gutter, palette, radius, shadow, space, spring, type } from '@/theme/tokens';

import { skeletonStatus, SLOT, useBasemap } from './map-basemap';
import { MapPin, PIN_HEIGHT, PinShadow } from './map-markers';
import { ImageryCredit, MapModeLayers, MapModeSwitch, useModeTiles, type MapMode } from './map-modes';
import { ScaleBar, type ScaleBarHandle } from './map-overlays';
import { MapSkeleton } from './map-skeleton';
import {
  acresAndGuntas,
  boundsOf,
  centroid,
  closeRing,
  DEFAULT_CENTER,
  DEFAULT_ZOOM,
  distanceM,
  edgeRotation,
  formatCoords,
  formatDistance,
  MAP_FONT_BOLD,
  pointInPolygon,
  runCamera,
  withAlpha,
} from './map-style';

type Mode = 'pin' | 'boundary';
type Place = { locality: string | null; district: string | null; state: string | null };
type PlaceSource = 'geocoder' | 'map' | null;

const MODES = [
  { value: 'pin', label: 'Pin' },
  { value: 'boundary', label: 'Boundary' },
] as const;

/** Sellers trace boundaries far more accurately on imagery; 3D would only skew the tracing. */
const PICKER_MODES: readonly MapMode[] = ['map', 'satellite'];

const PICK_ZOOM = 16;
const LIFT = 18;
/** Basemap place-label layers, read back as a free reverse-geocoder when the platform one is silent. */
const PLACE_LAYERS = ['label_village', 'label_town', 'label_city', 'label_city_capital', 'label_other'];

type DraftKind = 'fill' | 'edge' | 'closing' | 'node' | 'length';
type DraftProps = { kind: DraftKind; n?: number; first?: boolean; label?: string; rotate?: number };

function draftShape(vertices: LngLat[]): GeoJSON.FeatureCollection<GeoJSON.Geometry, DraftProps> {
  const features: GeoJSON.Feature<GeoJSON.Geometry, DraftProps>[] = [];
  const n = vertices.length;
  if (n >= 3) {
    features.push({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [closeRing(vertices)] },
      properties: { kind: 'fill' },
    });
    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: [vertices[n - 1], vertices[0]] },
      properties: { kind: 'closing' },
    });
  }
  if (n >= 2) {
    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: vertices },
      properties: { kind: 'edge' },
    });
  }
  const edges = n >= 3 ? n : n - 1;
  for (let i = 0; i < edges; i++) {
    const a = vertices[i];
    const b = vertices[(i + 1) % n];
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] },
      properties: { kind: 'length', label: formatDistance(distanceM(a, b)), rotate: edgeRotation(a, b) },
    });
  }
  vertices.forEach((v, i) =>
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: v },
      properties: { kind: 'node', n: i + 1, first: i === 0 },
    }),
  );
  return { type: 'FeatureCollection', features };
}

function perimeter(vertices: LngLat[]) {
  if (vertices.length < 2) return 0;
  let sum = 0;
  const closed = vertices.length >= 3;
  for (let i = 0; i < vertices.length - (closed ? 0 : 1); i++)
    sum += distanceM(vertices[i], vertices[(i + 1) % vertices.length]);
  return sum;
}

function crosses(p1: LngLat, p2: LngLat, p3: LngLat, p4: LngLat) {
  const d = (a: LngLat, b: LngLat, c: LngLat) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const d1 = d(p3, p4, p1);
  const d2 = d(p3, p4, p2);
  const d3 = d(p1, p2, p3);
  const d4 = d(p1, p2, p4);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/** A boundary whose edges cross would give a wrong area and an unreadable outline. */
function selfIntersects(v: LngLat[]) {
  const n = v.length;
  if (n < 4) return false;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (Math.abs(i - j) <= 1 || (i === 0 && j === n - 1)) continue;
      if (crosses(v[i], v[(i + 1) % n], v[j], v[(j + 1) % n])) return true;
    }
  }
  return false;
}

const expr = (e: unknown) => e as ExpressionSpecification;

// Async helpers live outside the component: the React Compiler cannot compile try/finally.

/** Location permission, asking once more when the OS still allows it. */
async function locationAllowed() {
  let perm = await Location.getForegroundPermissionsAsync();
  if (!perm.granted && perm.canAskAgain) perm = await Location.requestForegroundPermissionsAsync();
  return perm.granted;
}

async function devicePosition(): Promise<LngLat> {
  const pos =
    (await Location.getLastKnownPositionAsync({ maxAge: 60_000 })) ??
    (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }));
  return [pos.coords.longitude, pos.coords.latitude];
}

/** The platform geocoder first, the basemap's own place labels as fallback. `null` once superseded. */
async function lookUpPlace(
  at: LngLat,
  fromMap: (at: LngLat) => Promise<Place | null>,
  current: () => boolean,
): Promise<{ place: Place | null; source: PlaceSource } | null> {
  const [a] = await Location.reverseGeocodeAsync({ latitude: at[1], longitude: at[0] }).catch(() => []);
  if (!current()) return null;
  if (a && (a.district || a.city || a.subregion)) {
    return {
      place: {
        locality: a.district ?? a.city ?? a.name ?? null,
        district: a.subregion ?? a.city ?? null,
        state: a.region ?? null,
      },
      source: 'geocoder',
    };
  }
  const place = await fromMap(at);
  return { place, source: place ? 'map' : null };
}

/** Geotagging screen: a lifting crosshair pin over a moving map, plus parcel boundary drawing. */
export function LocationPicker() {
  const insets = useScreenInsets();
  const basemap = useBasemap();

  // Read the hand-off once; the store is written back only on confirm.
  const [initial] = useState(() => {
    const d = useListingDraft.getState();
    const center: LngLat | null = d.lat != null && d.lng != null ? [d.lng, d.lat] : null;
    const place: Place | null =
      d.locality || d.district || d.state ? { locality: d.locality, district: d.district, state: d.state } : null;
    return { center, boundary: d.boundary ?? [], place };
  });

  const [mode, setMode] = useState<Mode>('pin');
  const [mapMode, setMapMode] = useState<MapMode>('map');
  const [pin, setPin] = useState<LngLat>(initial.center ?? DEFAULT_CENTER);
  const [vertices, setVertices] = useState<LngLat[]>(initial.boundary);
  const [place, setPlace] = useState<Place | null>(initial.place);
  const [placeSource, setPlaceSource] = useState<PlaceSource>(initial.place ? 'geocoder' : null);
  const [geocoding, setGeocoding] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locationDenied, setLocationDenied] = useState(false);
  const [locationGranted, setLocationGranted] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [cardHeight, setCardHeight] = useState(0);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  const mapRef = useRef<MapRef>(null);
  const cameraRef = useRef<CameraRef>(null);
  const scaleRef = useRef<ScaleBarHandle>(null);
  const geocodeSeq = useRef(0);
  const geocodeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const moving = useRef(false);

  const lift = useSharedValue(0);
  const ping = useSharedValue(1);

  const initialView = useMemo<InitialViewState>(() => {
    const bounds = initial.boundary.length >= 3 ? boundsOf(initial.boundary) : null;
    if (bounds)
      return { bounds, padding: { top: space[16] * 2, bottom: space[16] * 5, left: space[12], right: space[12] } };
    return { center: initial.center ?? DEFAULT_CENTER, zoom: initial.center ? PICK_ZOOM : DEFAULT_ZOOM };
  }, [initial]);

  const tiles = useModeTiles(mapMode, () => pin);
  const satellite = mapMode === 'satellite';

  const shape = useMemo(() => draftShape(vertices), [vertices]);
  const acres = vertices.length >= 3 ? polygonAcres(vertices) : 0;
  const crossing = useMemo(() => selfIntersects(vertices), [vertices]);
  const edgesM = perimeter(vertices);

  // ── reverse geocoding: the platform geocoder first, the basemap's own place labels as fallback

  const placeFromMap = async (at: LngLat): Promise<Place | null> => {
    if (!size) return null;
    const cx = size.w / 2;
    const cy = size.h / 2;
    const r = Math.min(size.w, size.h) * 0.45;
    const features = await mapRef.current
      ?.queryRenderedFeatures(
        [
          [cx - r, cy - r],
          [cx + r, cy + r],
        ],
        { layers: PLACE_LAYERS },
      )
      .catch(() => null);
    let best: { name: string; d: number } | null = null;
    for (const f of features ?? []) {
      if (f.geometry.type !== 'Point') continue;
      const p = f.properties ?? {};
      const name = p['name:en'] ?? p.name_en ?? p['name:latin'] ?? p.name;
      if (typeof name !== 'string' || !name) continue;
      const d = distanceM(at, f.geometry.coordinates as LngLat);
      if (!best || d < best.d) best = { name, d };
    }
    if (!best) return null;
    return { locality: best.d < 600 ? best.name : `Near ${best.name}`, district: null, state: null };
  };

  const geocode = (at: LngLat) => {
    const seq = ++geocodeSeq.current;
    const current = () => seq === geocodeSeq.current;
    setGeocoding(true);
    lookUpPlace(at, placeFromMap, current)
      .then((found) => {
        if (!found || !current()) return;
        setPlace(found.place);
        setPlaceSource(found.source);
      })
      .catch(() => undefined)
      .finally(() => {
        if (current()) setGeocoding(false);
      });
  };

  const scheduleGeocode = (at: LngLat) => {
    if (geocodeTimer.current) clearTimeout(geocodeTimer.current);
    geocodeTimer.current = setTimeout(() => geocode(at), 380);
  };

  useEffect(
    () => () => {
      if (geocodeTimer.current) clearTimeout(geocodeTimer.current);
    },
    [],
  );

  // ── location

  const findMe = ({ quiet }: { quiet: boolean }) => {
    setLocating(true);
    locationAllowed()
      .then(async (granted) => {
        if (!granted) {
          if (!quiet) setLocationDenied(true);
          return;
        }
        setLocationGranted(true);
        setLocationDenied(false);
        const at = await devicePosition();
        runCamera(() => cameraRef.current?.flyTo({ center: at, zoom: PICK_ZOOM, duration: quiet ? 900 : 1100 }));
      })
      // Stay where we are; the map is still fully usable.
      .catch(() => undefined)
      .finally(() => setLocating(false));
  };

  // Seed once: editing starts from the draft, a new listing from the device (or Bengaluru).
  const onMount = useEffectEvent(() => {
    if (initial.center) {
      if (!initial.place) scheduleGeocode(initial.center);
      Location.getForegroundPermissionsAsync()
        .then((p) => setLocationGranted(p.granted))
        .catch(() => undefined);
    } else {
      findMe({ quiet: true });
    }
  });
  useEffect(() => onMount(), []);

  useEffect(() => {
    if (!confirmClear) return;
    const t = setTimeout(() => setConfirmClear(false), 2600);
    return () => clearTimeout(t);
  }, [confirmClear]);

  // ── crosshair lift / settle

  const pinStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -LIFT * lift.get() }, { scale: 1 + 0.06 * lift.get() }],
  }));
  const groundStyle = useAnimatedStyle(() => ({
    opacity: interpolate(lift.get(), [0, 1], [1, 0.4]),
    transform: [{ scale: interpolate(lift.get(), [0, 1], [1, 1.7]) }],
  }));
  // While lifted, a fine cross marks the exact point the tip will land on.
  const reticleStyle = useAnimatedStyle(() => ({
    opacity: lift.get(),
    transform: [{ scale: interpolate(lift.get(), [0, 1], [0.6, 1]) }],
  }));
  const pingStyle = useAnimatedStyle(() => ({
    opacity: interpolate(ping.get(), [0, 1], [0.5, 0]),
    transform: [
      { scaleX: interpolate(ping.get(), [0, 1], [0.6, 2.6]) },
      { scaleY: interpolate(ping.get(), [0, 1], [0.6, 2.6]) },
    ],
  }));

  const onMoveStart = () => {
    if (mode !== 'pin') return;
    moving.current = true;
    lift.set(withSpring(1, spring.snappy));
  };

  const onMoveEnd = (e: NativeSyntheticEvent<ViewStateChangeEvent>) => {
    const v = e.nativeEvent;
    scaleRef.current?.update(v.zoom, v.center[1]);
    if (mode !== 'pin') return;
    setPin(v.center);
    // Placing the stake is the one small celebration on this screen, so the drop may bounce.
    lift.set(withSpring(0, spring.bouncy));
    if (moving.current) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      ping.set(
        withSequence(
          withTiming(0, { duration: 0 }),
          withTiming(1, { duration: 640, easing: Easing.out(Easing.cubic) }),
        ),
      );
    }
    moving.current = false;
    scheduleGeocode(v.center);
  };

  // ── boundary

  const addVertex = (at: LngLat) => {
    if (mode !== 'boundary') return;
    setConfirmClear(false);
    if (vertices.length === 2) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    else Haptics.selectionAsync();
    setVertices((v) => [...v, at]);
  };

  const undo = () => {
    setConfirmClear(false);
    setVertices((v) => v.slice(0, -1));
  };

  const clear = () => {
    if (!confirmClear) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setConfirmClear(true);
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setConfirmClear(false);
    setVertices([]);
  };

  const switchMode = (next: Mode) => {
    setMode(next);
    setConfirmClear(false);
    if (next === 'pin') {
      // Bring the camera back over the pin so the crosshair and the stored point agree.
      runCamera(() => cameraRef.current?.easeTo({ center: pin, duration: 450 }));
    } else if (vertices.length >= 3) {
      const b = boundsOf(vertices);
      if (b) {
        runCamera(() =>
          cameraRef.current?.fitBounds(b, {
            padding: {
              top: insets.top + space[16] * 2,
              bottom: cardHeight + insets.bottom + space[10],
              left: space[12],
              right: space[12],
            },
            duration: 600,
            easing: 'ease',
          }),
        );
      }
    }
  };

  const boundaryIncomplete = vertices.length > 0 && vertices.length < 3;
  const hasBoundary = vertices.length >= 3;

  const confirm = () => {
    const boundary = hasBoundary ? vertices : null;
    // Keep the pin inside its own parcel; a stray pin falls back to the parcel's centre.
    const point = boundary && !pointInPolygon(pin, boundary) ? centroid(boundary) : pin;
    useListingDraft.getState().setLocation({
      lat: point[1],
      lng: point[0],
      boundary,
      locality: place?.locality ?? null,
      district: place?.district ?? null,
      state: place?.state ?? null,
    });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    router.back();
  };

  const placeLine = place ? [...new Set([place.locality, place.district, place.state].filter(Boolean))].join(', ') : '';
  const cta = boundaryIncomplete
    ? `Add ${3 - vertices.length} more ${3 - vertices.length === 1 ? 'corner' : 'corners'}`
    : crossing
      ? 'Edges cross — undo a corner'
      : hasBoundary
        ? `Confirm pin and ${vertices.length}-corner boundary`
        : 'Confirm pin';

  const isNode = ['==', ['get', 'kind'], 'node'];

  return (
    <View
      style={styles.screen}
      onLayout={(e: LayoutChangeEvent) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
      <Map
        key={basemap.attempt}
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        mapStyle={basemap.mapStyle}
        logo={false}
        compass={false}
        scaleBar={false}
        attribution
        attributionPosition={{ top: insets.top + 56, left: gutter }}
        tintColor={colors.inkTertiary}
        touchPitch={false}
        onDidFinishLoadingStyle={basemap.onDidFinishLoadingStyle}
        onDidFinishRenderingFrame={basemap.onDidFinishRenderingFrame}
        onDidFinishLoadingMap={basemap.onDidFinishLoadingMap}
        onDidFailLoadingMap={basemap.onDidFailLoadingMap}
        onRegionWillChange={onMoveStart}
        onRegionIsChanging={(e) => scaleRef.current?.update(e.nativeEvent.zoom, e.nativeEvent.center[1])}
        onRegionDidChange={onMoveEnd}
        onPress={(e) => addVertex(e.nativeEvent.lngLat)}>
        <Camera ref={cameraRef} initialViewState={initialView} minZoom={5} maxZoom={19} />
        <MapModeLayers mode={mapMode} enabled={basemap.branded} />

        {/* The drawn parcel reads as land: fill under the roads, edges under every name. Only the
            corner handles, which take taps, sit on top. */}
        <GeoJSONSource id="lc-draft" data={shape}>
          <Layer
            id="lc-draft-fill"
            type="fill"
            beforeId={SLOT.ground}
            filter={['==', ['get', 'kind'], 'fill']}
            paint={{
              'fill-color': crossing ? colors.danger : colors.accentBright,
              'fill-opacity': crossing ? 0.14 : 0.26,
            }}
          />
          <Layer
            id="lc-draft-casing"
            type="line"
            beforeId={SLOT.lines}
            filter={['==', ['get', 'kind'], 'edge']}
            layout={{ 'line-join': 'round', 'line-cap': 'round' }}
            paint={{ 'line-color': withAlpha(palette.white, 0.85), 'line-width': 5 }}
          />
          <Layer
            id="lc-draft-edge"
            type="line"
            beforeId={SLOT.lines}
            filter={['==', ['get', 'kind'], 'edge']}
            layout={{ 'line-join': 'round', 'line-cap': 'round' }}
            paint={{ 'line-color': crossing ? colors.danger : colors.accent, 'line-width': 2.4 }}
          />
          <Layer
            id="lc-draft-closing"
            type="line"
            beforeId={SLOT.lines}
            filter={['==', ['get', 'kind'], 'closing']}
            layout={{ 'line-cap': 'round' }}
            paint={{
              'line-color': crossing ? colors.danger : colors.accent,
              'line-width': 2,
              'line-opacity': 0.7,
              'line-dasharray': [1.5, 1.5],
            }}
          />
          <Layer
            id="lc-draft-lengths"
            type="symbol"
            beforeId={SLOT.labels}
            filter={['==', ['get', 'kind'], 'length']}
            layout={{
              'text-field': ['get', 'label'],
              'text-font': MAP_FONT_BOLD,
              'text-size': 11,
              'text-rotate': ['get', 'rotate'],
              'text-rotation-alignment': 'map',
              'text-offset': [0, -0.9],
              // Yields to road and village names; the sheet below always shows the perimeter.
              'text-padding': 1,
            }}
            paint={{
              'text-color': colors.ink,
              'text-halo-color': withAlpha(palette.white, 0.95),
              'text-halo-width': 1.6,
            }}
          />
          <Layer
            id="lc-draft-nodes"
            type="circle"
            filter={expr(isNode)}
            paint={{
              'circle-radius': 11,
              'circle-color': expr(['case', ['==', ['get', 'first'], true], colors.accent, colors.surface]),
              'circle-stroke-color': expr(['case', ['==', ['get', 'first'], true], colors.surface, colors.accent]),
              'circle-stroke-width': 2.2,
            }}
          />
          <Layer
            id="lc-draft-node-numbers"
            type="symbol"
            filter={expr(isNode)}
            layout={{
              'text-field': ['to-string', ['get', 'n']],
              'text-font': MAP_FONT_BOLD,
              'text-size': 11,
              'text-allow-overlap': true,
              'text-ignore-placement': true,
            }}
            paint={{ 'text-color': expr(['case', ['==', ['get', 'first'], true], colors.inkOnDark, colors.ink]) }}
          />
        </GeoJSONSource>

        {mode === 'boundary' ? (
          <Marker id="lc-pick-pin" lngLat={pin} anchor="bottom">
            <MapPin />
          </Marker>
        ) : null}

        {locationGranted ? <UserLocation /> : null}
      </Map>

      <MapSkeleton status={skeletonStatus(basemap)} onRetry={basemap.retry} />

      {/* Fixed crosshair: the map moves underneath it. */}
      {mode === 'pin' ? (
        <View style={styles.crosshair} pointerEvents="none">
          <View style={styles.crosshairBox}>
            <Animated.View style={[styles.ground, styles.pingWrap]}>
              <Animated.View style={[styles.ping, pingStyle]} />
            </Animated.View>
            <Animated.View style={[styles.ground, groundStyle]}>
              <PinShadow />
            </Animated.View>
            <Animated.View style={[styles.reticle, reticleStyle]}>
              <View style={styles.reticleH} />
              <View style={styles.reticleV} />
            </Animated.View>
            <Animated.View style={pinStyle}>
              <MapPin />
            </Animated.View>
          </View>
        </View>
      ) : null}

      {/* Header */}
      <Animated.View
        entering={FadeInDown.springify().damping(24).stiffness(200)}
        pointerEvents="box-none"
        style={[styles.header, { top: insets.top }]}>
        <IconButton label="Back" onPress={() => router.back()}>
          <ChevronLeft size={22} color={colors.ink} strokeWidth={2.2} />
        </IconButton>
        <View style={styles.hint}>
          <Text variant="captionStrong" numberOfLines={1}>
            {mode === 'pin'
              ? 'Move the map to place the pin'
              : vertices.length === 0
                ? 'Tap each corner of the parcel'
                : `Corner ${vertices.length} placed · tap the next`}
          </Text>
        </View>
      </Animated.View>

      {basemap.painted ? (
        <MapModeSwitch
          modes={PICKER_MODES}
          value={mapMode}
          onChange={setMapMode}
          style={[styles.modes, { top: insets.top + 44 + space[3] }]}
        />
      ) : null}

      {satellite && basemap.painted ? (
        <View pointerEvents="none" style={[styles.credit, { bottom: insets.bottom + cardHeight + space[3] + 40 }]}>
          <ImageryCredit />
        </View>
      ) : null}

      {/* Scale and use-my-location sit just above the sheet */}
      <Animated.View
        entering={FadeIn.delay(200).duration(240)}
        pointerEvents="none"
        style={[styles.scale, { bottom: insets.bottom + cardHeight + space[3] }]}>
        <ScaleBar ref={scaleRef} initial={{ zoom: initial.center ? PICK_ZOOM : DEFAULT_ZOOM, lat: pin[1] }} />
      </Animated.View>
      <Animated.View
        entering={FadeInUp.delay(140).springify().damping(24).stiffness(200)}
        style={[styles.locate, { bottom: insets.bottom + cardHeight + space[3] }]}>
        <IconButton label="Use my location" onPress={() => findMe({ quiet: false })}>
          {locating ? (
            <ActivityIndicator size="small" color={colors.accent} />
          ) : (
            <LocateFixed size={20} color={locationGranted ? colors.accent : colors.ink} strokeWidth={2.1} />
          )}
        </IconButton>
      </Animated.View>

      {/* Bottom sheet card */}
      <Animated.View
        entering={FadeInUp.delay(60).springify().damping(24).stiffness(200)}
        onLayout={(e) => setCardHeight(e.nativeEvent.layout.height)}
        style={[styles.sheet, { bottom: insets.bottom }]}>
        <Segmented options={MODES} value={mode} onChange={switchMode} />

        <View style={styles.block}>
          <Label>{mode === 'pin' ? 'Pinned at' : 'Pin'}</Label>
          <Text style={styles.coords} numberOfLines={1}>
            {formatCoords(pin[1], pin[0])}
          </Text>
          {geocoding ? (
            <View style={styles.skeleton} />
          ) : (
            <Text variant="caption" tone={placeLine ? 'secondary' : 'tertiary'} numberOfLines={1}>
              {placeLine
                ? placeSource === 'map'
                  ? `${placeLine} · from map labels`
                  : placeLine
                : 'Place name unavailable — add it in the listing'}
            </Text>
          )}
        </View>

        {mode === 'boundary' ? (
          <View style={styles.boundary}>
            <View style={styles.area}>
              <Label>{`Area · ${vertices.length} ${vertices.length === 1 ? 'corner' : 'corners'}`}</Label>
              <View style={styles.areaRow}>
                <Text style={type.figureSmall}>{acres > 0 ? formatNumber(Number(acres.toFixed(2))) : '0'}</Text>
                <Text variant="caption" tone="secondary">
                  acres
                </Text>
              </View>
              {crossing ? (
                <View style={styles.warn}>
                  <TriangleAlert size={13} color={colors.danger} strokeWidth={2.2} />
                  <Text variant="caption" tone="danger" numberOfLines={1}>
                    Edges cross. Undo and place corners in order.
                  </Text>
                </View>
              ) : (
                <Text variant="caption" tone="tertiary" numberOfLines={1} style={styles.tabular}>
                  {acres > 0
                    ? `${acresAndGuntas(acres)} · ${formatDistance(edgesM)} around`
                    : vertices.length > 0
                      ? `${formatDistance(edgesM)} of edge so far`
                      : 'Walk the corners in order, clockwise or not'}
                </Text>
              )}
            </View>
            <View style={styles.tools}>
              <IconButton label="Undo last corner" variant="sunken" onPress={undo} disabled={vertices.length === 0}>
                <Undo2 size={19} color={colors.ink} strokeWidth={2.1} />
              </IconButton>
              <IconButton
                label={confirmClear ? 'Tap again to clear the boundary' : 'Clear boundary'}
                variant={confirmClear ? 'danger' : 'sunken'}
                onPress={clear}
                disabled={vertices.length === 0}>
                <Trash2 size={19} color={confirmClear ? colors.inkOnDark : colors.danger} strokeWidth={2.1} />
              </IconButton>
            </View>
          </View>
        ) : null}

        {confirmClear ? (
          <Animated.View entering={FadeIn.duration(160)}>
            <Text variant="caption" tone="danger">
              Tap the bin again to clear every corner.
            </Text>
          </Animated.View>
        ) : satellite && tiles.status === 'failed' ? (
          <PressableScale haptic="selection" onPress={tiles.retry} accessibilityLabel="Retry satellite imagery">
            <Text variant="caption" tone="tertiary">
              Satellite imagery did not load, so the map shows instead.{' '}
              <Text variant="captionStrong" tone="accent">
                Retry
              </Text>
            </Text>
          </PressableScale>
        ) : locationDenied ? (
          <Text variant="caption" tone="tertiary">
            Location access is off. Move the map to your parcel instead.
          </Text>
        ) : null}

        <Button label={cta} variant="accent" disabled={boundaryIncomplete || crossing} onPress={confirm} />
      </Animated.View>
    </View>
  );
}

const RETICLE = 22;

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  crosshair: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Twice the pin height so the pin's tip lands exactly on the map centre.
  crosshairBox: { height: PIN_HEIGHT * 2, alignItems: 'center' },
  ground: { position: 'absolute', top: PIN_HEIGHT - 3 },
  pingWrap: { top: PIN_HEIGHT - 9, width: 18, height: 18, alignItems: 'center', justifyContent: 'center' },
  ping: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: colors.accent },
  reticle: {
    position: 'absolute',
    top: PIN_HEIGHT - RETICLE / 2,
    width: RETICLE,
    height: RETICLE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reticleH: { position: 'absolute', width: RETICLE, height: 1.5, backgroundColor: colors.ink },
  reticleV: { position: 'absolute', width: 1.5, height: RETICLE, backgroundColor: colors.ink },
  header: {
    position: 'absolute',
    left: gutter,
    right: gutter,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
  },
  hint: {
    flexShrink: 1,
    height: 44,
    justifyContent: 'center',
    paddingHorizontal: space[4],
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    boxShadow: shadow.card,
  },
  scale: { position: 'absolute', left: gutter },
  modes: { position: 'absolute', right: gutter },
  credit: { position: 'absolute', left: gutter },
  locate: { position: 'absolute', right: gutter },
  sheet: {
    position: 'absolute',
    left: space[3],
    right: space[3],
    gap: space[4],
    padding: space[4],
    borderRadius: radius.xxl,
    borderCurve: 'continuous',
    backgroundColor: colors.surface,
    boxShadow: shadow.float,
  },
  block: { gap: space[1] },
  coords: {
    fontFamily: font.mono,
    fontSize: 15,
    lineHeight: 22,
    color: colors.ink,
    fontVariant: ['tabular-nums'],
  },
  skeleton: {
    height: 12,
    width: '62%',
    marginVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSunken,
  },
  boundary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    padding: space[3],
    // Nested radius: radius.xxl − sheet padding.
    borderRadius: radius.xxl - space[4],
    borderCurve: 'continuous',
    backgroundColor: colors.surfaceMuted,
  },
  area: { flex: 1, gap: 2 },
  areaRow: { flexDirection: 'row', alignItems: 'baseline', gap: space[1] + 2 },
  warn: { flexDirection: 'row', alignItems: 'center', gap: space[1] },
  tabular: { fontVariant: ['tabular-nums'] },
  tools: { flexDirection: 'row', gap: space[2] },
});
