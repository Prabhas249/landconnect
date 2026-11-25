import type { ExpressionSpecification } from '@maplibre/maplibre-gl-style-spec';
import {
  Camera,
  GeoJSONSource,
  Images,
  Layer,
  Map,
  Marker,
  UserLocation,
  type CameraRef,
  type CameraStop,
  type GeoJSONSourceRef,
  type InitialViewState,
  type LngLatBounds,
  type MapRef,
  type MarkerEvent,
  type ViewPadding,
  type ViewStateChangeEvent,
} from '@maplibre/maplibre-react-native';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { useQuery } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import { router, useLocalSearchParams } from 'expo-router';
import { CloudOff, Expand, LocateFixed, MapPinOff, Navigation, Search, SearchX, X } from 'lucide-react-native';
import { useEffect, useEffectEvent, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Keyboard,
  Linking,
  ScrollView,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import Animated, {
  FadeIn,
  FadeInDown,
  FadeInUp,
  useAnimatedScrollHandler,
  useSharedValue,
} from 'react-native-reanimated';

import { fetchListings } from '@/data/listings';
import { qk } from '@/data/keys';
import { openDirections } from '@/lib/directions';
import { formatArea } from '@/lib/format';
import { LAND_TYPES, type LandType, type LngLat } from '@/lib/types';
import { useSession } from '@/stores/session';
import { IconButton } from '@/ui/icon-button';
import { PressableScale } from '@/ui/pressable-scale';
import { useScreenInsets } from '@/ui/screen';
import { Label, Text } from '@/ui/text';
import { colors, font, gutter, palette, radius, shadow, space } from '@/theme/tokens';

import { FocusParcel, type FocusTarget } from './focus-parcel';
import { skeletonStatus, SLOT, useBasemap } from './map-basemap';
import { GuideLine } from './map-guide';
import { MAP_CARD_HEIGHT, MapListingCard, MapListingCardSkeleton } from './map-listing-card';
import { SELECTED_PIN_OFFSET, SelectedPin, type CalloutZones } from './map-markers';
import { ImageryCredit, MapModeLayers, MapModeSwitch, PITCH_3D, useModeTiles, type MapMode } from './map-modes';
import { MapNotice } from './map-notice';
import { OrbitHud, useOrbit, type OrbitHudHandle, type OrbitOptions } from './map-orbit';
import { Compass, FloatingPill, ScaleBar, type ScaleBarHandle } from './map-overlays';
import { MapSkeleton } from './map-skeleton';
import { PILL_HEIGHT, PILL_PAD, pillImages } from './map-sprites';
import {
  APPROX_RADIUS_M,
  boundsOf,
  byLandType,
  centroid,
  circleRing,
  DEFAULT_CENTER,
  DEFAULT_ZOOM,
  distanceM,
  FOCUS_PITCH,
  FOCUS_ZOOM,
  formatDistance,
  inBounds,
  LAND_COLORS,
  listingAreas,
  listingPoints,
  MAP_FONT_BOLD,
  PARCEL_ZOOM,
  PILL_ZOOM,
  runCamera,
  toMapListings,
  withAlpha,
  type MapListing,
} from './map-style';

const AnimatedList = Animated.createAnimatedComponent(FlashList<MapListing>);

const POINTS_SOURCE = 'lc-listings';
const SEARCH_H = 52;
const CHIP_ROW_H = 36 + space[2] * 2;
/** Vertical room around carousel cards so their float shadow is not clipped by the list. */
const SHADOW_ROOM = space[6];
const CARD_GAP = space[3];
/** Approximate height of a MapNotice, so the controls can step above it. */
const NOTICE_H = 64;
/** Pills float a little above their dot: 2 pt between the sprite's bottom edge and the point. */
const PILL_LIFT = 2;
const PILL_CENTER = PILL_LIFT + PILL_PAD + PILL_HEIGHT / 2;
const PILL_TEXT_SIZE = 12;
/** Room the imagery credit takes above the carousel; controls step up by it in satellite mode. */
const CREDIT_ROOM = space[5];

const EXPLORE_MODES: readonly MapMode[] = ['map', 'satellite', '3d'];
/** Orbit pitch: steep enough to see the plot's sides and its neighbours' heights. */
const ORBIT_PITCH = 56;
/** Buildings start rising at z14; switching to 3D from further out flies in to the parcel. */
const BUILDINGS_ZOOM = 14;

const INITIAL_VIEW: InitialViewState = { center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM };

const FILTERS: { value: LandType | 'all'; label: string }[] = [{ value: 'all', label: 'All land' }, ...LAND_TYPES];

const expr = (e: unknown) => e as ExpressionSpecification;

/** Camera stop that frames one listing: its boundary, its approximate disc, or its pin. */
function framingFor(
  m: MapListing,
  o: { padding: ViewPadding; three: boolean; bearing: number; zoom: number },
): CameraStop {
  if (m.approximate) {
    const bounds = boundsOf(circleRing(m.lngLat, APPROX_RADIUS_M * 1.15, 16));
    if (bounds) return { bounds, padding: o.padding, pitch: o.three ? 45 : 0, bearing: o.bearing };
  }
  const bounds = m.boundary ? boundsOf(m.boundary, 0.0009) : null;
  if (bounds) return { bounds, padding: o.padding, pitch: o.three ? PITCH_3D : FOCUS_PITCH, bearing: o.bearing };
  return {
    center: m.lngLat,
    zoom: Math.max(o.zoom, o.three ? 16 : FOCUS_ZOOM),
    pitch: o.three ? PITCH_3D : FOCUS_PITCH,
    bearing: o.bearing,
    padding: o.padding,
  };
}

/** Location permission, asking once more when the OS still allows it. */
async function locationAllowed() {
  let perm = await Location.getForegroundPermissionsAsync();
  if (!perm.granted && perm.canAskAgain) perm = await Location.requestForegroundPermissionsAsync();
  return perm.granted;
}

function boundsOfListings(items: MapListing[]) {
  return boundsOf(
    items.flatMap((m) => (m.boundary ? [m.lngLat, ...m.boundary] : [m.lngLat])),
    0.02,
  );
}

function FilterChip({
  label,
  count,
  landType,
  selected,
  onPress,
}: {
  label: string;
  count: number;
  landType: LandType | 'all';
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <PressableScale
      haptic="selection"
      onPress={onPress}
      accessibilityState={{ selected }}
      accessibilityLabel={`${label}, ${count}`}
      style={[styles.chip, selected ? styles.chipSelected : null]}>
      {landType === 'all' ? (
        <View style={styles.dotStack}>
          {(['agricultural', 'residential', 'commercial'] as const).map((t, i) => (
            <View
              key={t}
              style={[
                styles.legendDot,
                styles.stackedDot,
                { backgroundColor: LAND_COLORS[t].fill, marginLeft: i ? -4 : 0 },
              ]}
            />
          ))}
        </View>
      ) : (
        <View style={[styles.legendDot, { backgroundColor: LAND_COLORS[landType].fill }]} />
      )}
      <Text variant="captionStrong" tone={selected ? 'onDark' : 'ink'} numberOfLines={1}>
        {label}
      </Text>
      <Text variant="caption" tone={selected ? 'onDarkSecondary' : 'tertiary'} style={styles.tabular}>
        {String(count)}
      </Text>
    </PressableScale>
  );
}

/**
 * Full-screen explore map. Listings are price pills on a branded basemap; the carousel and the
 * map are one system — swiping flies the camera to the parcel, tapping a pill snaps the carousel.
 */
export function ExploreMap() {
  const insets = useScreenInsets({ tabBar: true });
  const { width } = useWindowDimensions();
  const viewerId = useSession((s) => s.userId);

  const listings = useQuery({ queryKey: qk.listings(), queryFn: () => fetchListings() });
  // "Open in map" from a listing: `/map?focus=<listingId>`. Consumed once, then cleared.
  const params = useLocalSearchParams<{ focus?: string }>();
  const focusParam = typeof params.focus === 'string' && params.focus ? params.focus : null;
  const basemap = useBasemap();
  // Controls, framing and focus requests start at the first painted frame, not the last tile.
  const mapReady = basemap.painted;

  const [landType, setLandType] = useState<LandType | 'all'>('all');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [areaBounds, setAreaBounds] = useState<LngLatBounds | null>(null);
  const [searchHere, setSearchHere] = useState(false);
  const [inView, setInView] = useState<number | null>(null);
  const [locationGranted, setLocationGranted] = useState(false);
  const [locationIssue, setLocationIssue] = useState<'denied' | 'unavailable' | null>(null);
  const [userLngLat, setUserLngLat] = useState<LngLat | null>(null);

  const [mode, setMode] = useState<MapMode>('map');
  const [directionsAsk, setDirectionsAsk] = useState<string | null>(null);
  const [directionsFailed, setDirectionsFailed] = useState(false);

  const mapRef = useRef<MapRef>(null);
  const cameraRef = useRef<CameraRef>(null);
  const pointsRef = useRef<GeoJSONSourceRef>(null);
  const hudRef = useRef<OrbitHudHandle>(null);
  const zonesRef = useRef<CalloutZones | null>(null);
  const listRef = useRef<FlashListRef<MapListing>>(null);
  const scaleRef = useRef<ScaleBarHandle>(null);
  const viewRef = useRef<ViewStateChangeEvent | null>(null);
  const movingRef = useRef(false);
  const zoomRef = useRef(DEFAULT_ZOOM);
  const activeRef = useRef<string | null>(null);

  const bearing = useSharedValue(0);
  const pitch = useSharedValue(0);
  const scrollX = useSharedValue(0);

  const orbit = useOrbit(cameraRef);
  const is3d = mode === '3d';

  // ── data

  const all = useMemo(() => toMapListings(listings.data ?? [], viewerId), [listings.data, viewerId]);
  const searched = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return all;
    return all.filter(({ listing: l }) =>
      [l.title, l.locality, l.district].some((v) => v?.toLowerCase().includes(term)),
    );
  }, [all, search]);
  const matches = useMemo(
    () => (landType === 'all' ? searched : searched.filter((m) => m.listing.land_type === landType)),
    [searched, landType],
  );
  const items = useMemo(
    () => (areaBounds ? matches.filter((m) => inBounds(m.lngLat, areaBounds)) : matches),
    [matches, areaBounds],
  );

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: searched.length };
    for (const m of searched) c[m.listing.land_type] = (c[m.listing.land_type] ?? 0) + 1;
    return c;
  }, [searched]);

  const points = useMemo(() => listingPoints(items), [items]);
  const areas = useMemo(() => listingAreas(items), [items]);

  // The centred card is always the selection; with nothing chosen yet that is the first card.
  const active = items.find((m) => m.listing.id === selectedId) ?? items[0] ?? null;
  const activeId = active?.listing.id ?? null;
  useEffect(() => {
    activeRef.current = activeId;
    // The callout re-measures for the new listing; stale zones must not route a tap.
    zonesRef.current = null;
  }, [activeId]);
  const hasCarousel = items.length > 0;

  const tiles = useModeTiles(mode, () => viewRef.current?.center ?? active?.lngLat ?? DEFAULT_CENTER);

  const focusTarget = useMemo<FocusTarget | null>(
    () =>
      active
        ? {
            id: active.listing.id,
            landType: active.listing.land_type,
            boundary: active.boundary,
            center: active.lngLat,
            approximate: active.approximate,
          }
        : null,
    [active],
  );

  const origin = userLngLat ?? DEFAULT_CENTER;
  const distanceLabel = (m: MapListing) =>
    `${formatDistance(distanceM(origin, m.lngLat))} ${userLngLat ? 'away' : 'from city'}`;

  // ── layout shared by overlays and camera padding

  const cardWidth = Math.min(width - gutter * 2 - space[8], 420);
  const itemWidth = cardWidth + CARD_GAP;
  const sideInset = (width - itemWidth) / 2;
  const carouselBottom = insets.bottom - SHADOW_ROOM;
  const overlayAboveCarousel = insets.bottom + MAP_CARD_HEIGHT + space[4];
  const creditRoom = mode === 'satellite' ? CREDIT_ROOM : 0;
  const topOverlay = insets.top + SEARCH_H + CHIP_ROW_H;
  const cameraPadding: ViewPadding = {
    top: topOverlay + space[4],
    bottom: overlayAboveCarousel + space[4],
    left: gutter,
    right: gutter,
  };
  // Parcels leave headroom for the raised price pill above them.
  const focusPadding: ViewPadding = {
    top: topOverlay + space[16],
    bottom: overlayAboveCarousel + space[6],
    left: gutter + space[6],
    right: gutter + space[6],
  };
  const fitPadding: ViewPadding = { ...cameraPadding, left: gutter + space[8], right: gutter + space[8] };

  // The first view is already the right one whenever the data is cached (it usually is: the feed
  // or the listing screen loaded it). Arriving with `?focus=` opens straight on that parcel, so the
  // map never loads Bengaluru-wide tiles only to fly away from them.
  const [initialView] = useState<InitialViewState>(() => {
    const known = toMapListings(listings.data ?? [], viewerId);
    const target = focusParam ? known.find((m) => m.listing.id === focusParam) : undefined;
    if (target) return framingFor(target, { padding: focusPadding, three: false, bearing: 0, zoom: DEFAULT_ZOOM });
    const bounds = boundsOfListings(known);
    return bounds ? { bounds, padding: fitPadding } : INITIAL_VIEW;
  });
  const didFitRef = useRef(initialView !== INITIAL_VIEW);

  // ── camera

  /** Every camera command goes through here: a new framing always ends a running orbit. */
  const move = (command: () => unknown) => {
    orbit.stop({ halt: false });
    runCamera(command);
  };

  /** `instant` jumps: used when arriving from elsewhere, where a long flight would only cost time and tiles. */
  const focus = (m: MapListing, inMode: MapMode = mode, { instant = false }: { instant?: boolean } = {}) => {
    const three = inMode === '3d';
    const stop = framingFor(m, {
      padding: focusPadding,
      three,
      bearing: three ? (viewRef.current?.bearing ?? 0) : 0,
      zoom: zoomRef.current,
    });
    const timing = instant
      ? { duration: 0 }
      : { duration: m.boundary && !m.approximate ? 1400 : 1300, easing: 'fly' as const };
    move(() => cameraRef.current?.setStop({ ...stop, ...timing }));
  };

  const fitAll = (duration = 1000) => {
    const bounds = boundsOfListings(items);
    if (!bounds) return;
    move(() =>
      cameraRef.current?.fitBounds(bounds, {
        padding: fitPadding,
        pitch: is3d ? 40 : 0,
        bearing: 0,
        duration,
        easing: 'ease',
      }),
    );
  };

  // North-up; flat too, except in 3D where flat would undo the mode.
  const squareUp = () => {
    move(() => cameraRef.current?.setStop({ bearing: 0, pitch: is3d ? PITCH_3D : 0, duration: 520, easing: 'ease' }));
  };

  const changeMode = (next: MapMode) => {
    const prev = mode;
    setMode(next);
    // A running orbit owns the camera and keeps its pitch across modes.
    if (orbit.running) return;
    const v = viewRef.current;
    if (next === '3d') {
      if (active && (!v || v.zoom < BUILDINGS_ZOOM)) focus(active, next);
      else move(() => cameraRef.current?.setStop({ pitch: PITCH_3D, duration: 900, easing: 'ease' }));
    } else if (prev === '3d') {
      const settle = v && v.zoom >= PARCEL_ZOOM && active && !active.approximate ? FOCUS_PITCH : 0;
      move(() => cameraRef.current?.setStop({ pitch: settle, duration: 800, easing: 'ease' }));
    }
  };

  // ── 360° orbit around the selected parcel

  const orbitPlan = (m: MapListing): OrbitOptions => {
    const from = viewRef.current?.bearing ?? 0;
    // Frame a circle around the plot, not its box, so it stays in view at every bearing.
    const center = m.boundary ? centroid(m.boundary) : m.lngLat;
    let r = m.approximate ? APPROX_RADIUS_M : 90;
    if (m.boundary) for (const p of m.boundary) r = Math.max(r, distanceM(center, p));
    const bounds = boundsOf(circleRing(center, r * (m.approximate ? 1.05 : 1.2), 24));
    return {
      fromBearing: from,
      sweep: 360,
      durationMs: 14_000,
      intro: bounds
        ? { bounds, padding: focusPadding, pitch: m.approximate ? 48 : ORBIT_PITCH, bearing: from }
        : { center, zoom: 16, padding: focusPadding, pitch: ORBIT_PITCH, bearing: from },
    };
  };

  const toggleOrbit = (m: MapListing) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    orbit.toggle(orbitPlan(m));
  };

  // ── directions: always the public point; hidden locations confirm the approximation first

  const launchDirections = async (m: MapListing) => {
    setDirectionsAsk(null);
    const ok = await openDirections({
      lat: m.lngLat[1],
      lng: m.lngLat[0],
      label: m.approximate ? `Approximate area near ${m.listing.locality}` : m.listing.title,
    });
    if (!ok) setDirectionsFailed(true);
  };

  const directionsTo = (m: MapListing) => {
    Haptics.selectionAsync();
    setDirectionsFailed(false);
    if (m.approximate) setDirectionsAsk(m.listing.id);
    else launchDirections(m);
  };

  useEffect(() => {
    if (!directionsAsk && !directionsFailed) return;
    const t = setTimeout(() => {
      setDirectionsAsk(null);
      setDirectionsFailed(false);
    }, 8000);
    return () => clearTimeout(t);
  }, [directionsAsk, directionsFailed]);

  /**
   * The callout is a native-positioned marker view, so its buttons cannot rely on React Native
   * touch regions. The marker press reports the tap point; project the marker's anchor and match
   * the tap against the zones the callout measured. Anything else opens the listing.
   */
  const onSelectedPress = async (e: NativeSyntheticEvent<MarkerEvent>) => {
    const m = active;
    if (!m) return;
    const zones = zonesRef.current;
    const [tapX] = e.nativeEvent.point;
    const anchor = zones ? await mapRef.current?.project(m.lngLat).catch(() => null) : null;
    if (zones && anchor) {
      const offsetX = m.approximate ? 0 : SELECTED_PIN_OFFSET[0];
      const x = tapX - (anchor[0] - zones.width / 2 + offsetX);
      const slack = space[1];
      if (x >= zones.orbit[0] - slack && x <= zones.orbit[1] + slack) {
        toggleOrbit(m);
        return;
      }
      if (x >= zones.directions[0] - slack && x <= zones.directions[1] + slack * 2) {
        directionsTo(m);
        return;
      }
    }
    router.push(`/listing/${m.listing.id}`);
  };

  const clearFilters = () => {
    setSearch('');
    setLandType('all');
    setAreaBounds(null);
  };

  // A camera that starts framed emits no move events; a zero-length stop reports where it is, so
  // the scale bar and the in-view count start right. Declared first so any framing below overrides it.
  useEffect(() => {
    if (mapReady) runCamera(() => cameraRef.current?.setStop({ duration: 0 }));
  }, [mapReady]);

  // Frame every listing once, when the data arrives after the map has already drawn (when it was
  // cached, the initial view already frames it). A pending focus request frames the camera itself.
  const onFirstFrame = useEffectEvent(() => {
    if (didFitRef.current || items.length === 0) return;
    didFitRef.current = true;
    if (focusParam) return;
    fitAll(900);
  });
  useEffect(() => {
    if (mapReady) onFirstFrame();
  }, [mapReady, items.length]);

  // A new filter starts the carousel from its first card; a new land type also reframes.
  // Only real changes count: the mount run must not move a camera that already starts framed.
  const lastFilters = useRef({ landType, search, areaBounds });
  const onFilterChanged = useEffectEvent((reframe: boolean) => {
    setSelectedId(null);
    scrollX.set(0);
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
    if (reframe && didFitRef.current) fitAll();
  });
  useEffect(() => {
    const prev = lastFilters.current;
    if (prev.landType === landType && prev.search === search && prev.areaBounds === areaBounds) return;
    lastFilters.current = { landType, search, areaBounds };
    onFilterChanged(prev.landType !== landType);
  }, [landType, search, areaBounds]);

  // Declared after the filter effects so a focus request wins over their reset and reframe.
  const onFocusRequest = useEffectEvent((id: string) => {
    const target = all.find((m) => m.listing.id === id);
    if (!target) {
      // Still loading: wait for data. Loaded and absent (removed, hidden): drop the request.
      if (!listings.isPending) router.setParams({ focus: undefined });
      return;
    }
    const index = items.findIndex((m) => m.listing.id === id);
    if (index < 0) {
      // Filtered out of the carousel: clear filters; this runs again with the full list.
      clearFilters();
      return;
    }
    router.setParams({ focus: undefined });
    activeRef.current = id;
    setSelectedId(id);
    requestAnimationFrame(() => listRef.current?.scrollToOffset({ offset: index * itemWidth, animated: false }));
    // `target` is already the public point: fuzzed for hidden locations unless the viewer owns it.
    // Jump, then select: the parcel draws itself in once the camera is there.
    focus(target, mode, { instant: true });
  });
  useEffect(() => {
    if (focusParam && mapReady) onFocusRequest(focusParam);
  }, [focusParam, mapReady, items]);

  // ── camera-driven chrome

  const countInView = (bounds: LngLatBounds) => {
    let n = 0;
    for (const m of items) if (inBounds(m.lngLat, bounds)) n++;
    return n;
  };

  const onCameraMove = (e: NativeSyntheticEvent<ViewStateChangeEvent>) => {
    const v = e.nativeEvent;
    bearing.set(v.bearing);
    pitch.set(v.pitch);
    scaleRef.current?.update(v.zoom, v.center[1]);
    hudRef.current?.update(v.bearing);
  };

  const onCameraIdle = (e: NativeSyntheticEvent<ViewStateChangeEvent>) => {
    const v = e.nativeEvent;
    movingRef.current = false;
    viewRef.current = v;
    zoomRef.current = v.zoom;
    onCameraMove(e);
    const n = countInView(v.bounds);
    setInView((prev) => (prev === n ? prev : n));
    if (v.userInteraction) setSearchHere(true);
  };

  // Recount when the result set changes under a still camera.
  useEffect(() => {
    const v = viewRef.current;
    if (!v) return;
    let n = 0;
    for (const m of items) if (inBounds(m.lngLat, v.bounds)) n++;
    setInView(n);
  }, [items]);

  const searchThisArea = () => {
    const v = viewRef.current;
    if (!v) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setAreaBounds(v.bounds);
    setSearchHere(false);
  };

  // ── selection, linked both ways

  const scrollCarouselTo = (index: number) => {
    listRef.current?.scrollToOffset({ offset: index * itemWidth, animated: true });
  };

  const selectFromMap = (id: string) => {
    const index = items.findIndex((m) => m.listing.id === id);
    if (index < 0) return;
    Haptics.selectionAsync();
    activeRef.current = id;
    setSelectedId(id);
    scrollCarouselTo(index);
    focus(items[index]);
  };

  const onCarouselSettled = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const index = Math.max(0, Math.min(items.length - 1, Math.round(e.nativeEvent.contentOffset.x / itemWidth)));
    const m = items[index];
    if (!m || m.listing.id === activeRef.current) return;
    Haptics.selectionAsync();
    activeRef.current = m.listing.id;
    setSelectedId(m.listing.id);
    focus(m);
  };

  const onScroll = useAnimatedScrollHandler({
    onScroll: (e) => {
      scrollX.set(e.contentOffset.x);
    },
  });

  const onPointsPress = async (feature: GeoJSON.Feature | undefined) => {
    if (!feature || feature.geometry.type !== 'Point') return;
    const props = feature.properties ?? {};
    if (props.cluster) {
      Haptics.selectionAsync();
      const center = feature.geometry.coordinates as LngLat;
      const zoom = await pointsRef.current?.getClusterExpansionZoom(Number(props.cluster_id)).catch(() => null);
      move(() =>
        cameraRef.current?.easeTo({
          center,
          zoom: (zoom ?? zoomRef.current + 2) + 0.35,
          padding: cameraPadding,
          duration: 720,
          easing: 'ease',
        }),
      );
      return;
    }
    if (typeof props.id === 'string') selectFromMap(props.id);
  };

  // ── location

  const readPosition = async () => {
    const pos =
      (await Location.getLastKnownPositionAsync({ maxAge: 300_000 })) ??
      (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
    const at: LngLat = [pos.coords.longitude, pos.coords.latitude];
    setUserLngLat(at);
    return at;
  };

  const onMount = useEffectEvent(() => {
    Location.getForegroundPermissionsAsync()
      .then((p) => {
        setLocationGranted(p.granted);
        if (p.granted) readPosition().catch(() => undefined);
      })
      .catch(() => undefined);
  });
  useEffect(() => onMount(), []);

  useEffect(() => {
    if (!locationIssue) return;
    const t = setTimeout(() => setLocationIssue(null), 6000);
    return () => clearTimeout(t);
  }, [locationIssue]);

  const recenter = () => {
    locationAllowed()
      .then(async (granted) => {
        if (!granted) {
          setLocationIssue('denied');
          return;
        }
        setLocationGranted(true);
        setLocationIssue(null);
        const at = await readPosition();
        move(() =>
          cameraRef.current?.flyTo({
            center: at,
            zoom: 12.5,
            pitch: 0,
            bearing: 0,
            padding: cameraPadding,
            duration: 1300,
          }),
        );
      })
      .catch(() => setLocationIssue('unavailable'));
  };

  // ── notice: one calm message at a time

  const askFor = directionsAsk ? (all.find((m) => m.listing.id === directionsAsk) ?? null) : null;

  let notice: ReactNode = null;
  if (askFor) {
    notice = (
      <MapNotice
        icon={<Navigation size={18} color={colors.accent} strokeWidth={2.1} />}
        title="Directions to approximate area"
        body="The exact spot stays private. Maps will guide you to within about 750 m."
        action={{ label: 'Open maps', onPress: () => launchDirections(askFor) }}
      />
    );
  } else if (directionsFailed) {
    notice = (
      <MapNotice
        icon={<Navigation size={18} color={colors.accent} strokeWidth={2.1} />}
        title="No maps app opened"
        body="Install or enable a maps app to get directions."
      />
    );
  } else if (listings.isPending) {
    notice = null;
  } else if (listings.isError) {
    notice = (
      <MapNotice
        icon={<CloudOff size={20} color={colors.accent} strokeWidth={2.1} />}
        title="Listings did not load"
        body="Check your connection. The map still works."
        action={{ label: 'Retry', onPress: () => listings.refetch() }}
      />
    );
  } else if (all.length === 0) {
    notice = (
      <MapNotice
        icon={<MapPinOff size={20} color={colors.accent} strokeWidth={2.1} />}
        title="No land listed yet"
        body="New parcels show up here as sellers publish them."
      />
    );
  } else if (matches.length === 0) {
    notice = (
      <MapNotice
        icon={<SearchX size={20} color={colors.accent} strokeWidth={2.1} />}
        title="Nothing matches"
        body="Try another land type or place."
        action={{ label: 'Clear', onPress: clearFilters }}
      />
    );
  } else if (items.length === 0) {
    notice = (
      <MapNotice
        icon={<SearchX size={20} color={colors.accent} strokeWidth={2.1} />}
        title="No parcels in this area"
        body={`${matches.length} ${matches.length === 1 ? 'match sits' : 'matches sit'} outside it.`}
        action={{ label: 'Show all', onPress: () => setAreaBounds(null) }}
      />
    );
  } else if (mapReady && tiles.status === 'failed') {
    notice = (
      <MapNotice
        icon={<CloudOff size={20} color={colors.accent} strokeWidth={2.1} />}
        title={mode === 'satellite' ? 'Satellite imagery did not load' : 'Terrain did not load'}
        body={
          mode === 'satellite'
            ? 'Showing the map underneath. Check your connection.'
            : 'Buildings and the parcel are still in 3D.'
        }
        action={{ label: 'Retry', onPress: tiles.retry }}
      />
    );
  } else if (mapReady && inView === 0) {
    notice = (
      <MapNotice
        icon={<MapPinOff size={20} color={colors.accent} strokeWidth={2.1} />}
        title="No parcels in view"
        body="Zoom out or jump back to every listing."
        action={{ label: 'Show all', onPress: () => fitAll() }}
      />
    );
  } else if (locationIssue) {
    notice = (
      <MapNotice
        icon={<LocateFixed size={20} color={colors.accent} strokeWidth={2.1} />}
        title={locationIssue === 'denied' ? 'Location is off' : 'Location unavailable'}
        body={
          locationIssue === 'denied'
            ? 'Allow location access to centre the map on you.'
            : 'Your position could not be found just now.'
        }
        action={locationIssue === 'denied' ? { label: 'Settings', onPress: () => Linking.openSettings() } : undefined}
      />
    );
  }

  const activeExpr = activeId ?? '';
  const isActive = ['==', ['get', 'id'], activeExpr];
  const isApprox = ['==', ['get', 'approx'], true];
  const showAreaChip = !!areaBounds && !searchHere;

  return (
    <View style={styles.screen}>
      {/* Any touch on the map ends an orbit at once, before a gesture even starts. */}
      <View style={StyleSheet.absoluteFill} onTouchStart={orbit.onMapTouch}>
        <Map
          key={basemap.attempt}
          ref={mapRef}
          style={StyleSheet.absoluteFill}
          mapStyle={basemap.mapStyle}
          logo={false}
          compass={false}
          scaleBar={false}
          attribution
          attributionPosition={{ bottom: overlayAboveCarousel + 2, left: gutter - 4 }}
          tintColor={colors.inkTertiary}
          onDidFinishLoadingStyle={basemap.onDidFinishLoadingStyle}
          onDidFinishRenderingFrame={basemap.onDidFinishRenderingFrame}
          onDidFinishLoadingMap={basemap.onDidFinishLoadingMap}
          onDidFailLoadingMap={basemap.onDidFailLoadingMap}
          onPress={() => Keyboard.dismiss()}
          onRegionWillChange={(e) => {
            movingRef.current = true;
            orbit.onRegionWillChange(e);
          }}
          onRegionIsChanging={onCameraMove}
          onRegionDidChange={onCameraIdle}>
          <Camera ref={cameraRef} initialViewState={initialView} minZoom={5} maxZoom={18} />
          <Images images={pillImages} />
          <MapModeLayers mode={mode} enabled={basemap.branded} />

          {/* Every other parcel: a quiet tint under the roads that fades in once parcels are larger
              than their pill, with a hairline outline above the roads and under every name. */}
          <GeoJSONSource
            id="lc-areas"
            data={areas}
            onPress={(e) => {
              e.stopPropagation();
              const id = e.nativeEvent.features[0]?.properties?.id;
              if (typeof id === 'string') selectFromMap(id);
            }}>
            <Layer
              id="lc-area-fill"
              type="fill"
              beforeId={SLOT.ground}
              filter={expr(['!=', ['get', 'id'], activeExpr])}
              paint={{
                'fill-color': byLandType('fill'),
                'fill-opacity': expr([
                  'interpolate',
                  ['linear'],
                  ['zoom'],
                  PARCEL_ZOOM - 1.5,
                  0,
                  PARCEL_ZOOM,
                  ['case', ['==', ['get', 'kind'], 'approx'], 0.07, 0.16],
                ]),
              }}
            />
            <Layer
              id="lc-area-line"
              type="line"
              beforeId={SLOT.lines}
              filter={expr(['all', ['==', ['get', 'kind'], 'parcel'], ['!=', ['get', 'id'], activeExpr]])}
              layout={{ 'line-join': 'round', 'line-cap': 'round' }}
              paint={{
                'line-color': byLandType('ink'),
                'line-opacity': expr([
                  'interpolate',
                  ['linear'],
                  ['zoom'],
                  PARCEL_ZOOM - 1,
                  0,
                  PARCEL_ZOOM + 0.5,
                  0.85,
                ]),
                'line-width': expr(['interpolate', ['linear'], ['zoom'], PARCEL_ZOOM, 0.8, 17, 1.8]),
              }}
            />
            <Layer
              id="lc-approx-line"
              type="line"
              beforeId={SLOT.lines}
              filter={expr(['all', ['==', ['get', 'kind'], 'approx'], ['!=', ['get', 'id'], activeExpr]])}
              paint={{
                'line-color': byLandType('ink'),
                'line-opacity': expr(['interpolate', ['linear'], ['zoom'], PARCEL_ZOOM - 1.5, 0, PARCEL_ZOOM, 0.45]),
                'line-width': 1.1,
                'line-dasharray': [2, 2],
              }}
            />
          </GeoJSONSource>

          <GuideLine from={locationGranted ? userLngLat : null} to={active?.lngLat ?? null} />

          <FocusParcel target={focusTarget} pausedRef={movingRef} extrude={is3d} />

          {/* Markers proper stay on top of the whole stack: clusters, dots and price pills. */}
          <GeoJSONSource
            ref={pointsRef}
            id={POINTS_SOURCE}
            data={points}
            cluster
            clusterRadius={56}
            clusterMaxZoom={PILL_ZOOM}
            onPress={(e) => {
              e.stopPropagation();
              onPointsPress(e.nativeEvent.features[0]);
            }}>
            <Layer
              id="lc-cluster-halo"
              type="circle"
              filter={['has', 'point_count']}
              paint={{
                'circle-color': palette.mint,
                'circle-opacity': 0.22,
                'circle-radius': expr(['step', ['get', 'point_count'], 23, 8, 28, 20, 34]),
                'circle-blur': 0.15,
              }}
            />
            <Layer
              id="lc-cluster"
              type="circle"
              filter={['has', 'point_count']}
              paint={{
                'circle-color': colors.ink,
                'circle-radius': expr(['step', ['get', 'point_count'], 15, 8, 18, 20, 22]),
                'circle-stroke-color': palette.mint,
                'circle-stroke-width': 2.5,
              }}
            />
            <Layer
              id="lc-cluster-count"
              type="symbol"
              filter={['has', 'point_count']}
              layout={{
                'text-field': ['get', 'point_count_abbreviated'],
                'text-font': MAP_FONT_BOLD,
                'text-size': 12.5,
                'text-allow-overlap': true,
                'text-ignore-placement': true,
              }}
              paint={{ 'text-color': colors.inkOnDark }}
            />
            <Layer
              id="lc-dots"
              type="circle"
              filter={['!', ['has', 'point_count']]}
              paint={{
                'circle-color': expr(['case', isApprox, colors.surface, byLandType('fill')]),
                'circle-radius': expr(['interpolate', ['linear'], ['zoom'], 8, 3, 15, 4.5]),
                'circle-stroke-color': expr(['case', isApprox, byLandType('ink'), colors.surface]),
                'circle-stroke-width': 1.6,
                'circle-opacity': expr(['case', isActive, 0, 1]),
                'circle-stroke-opacity': expr(['case', isActive, 0, 1]),
              }}
            />
            {/* Price pills: one SDF sprite per width, tinted by land type. Approximate ones are hollow. */}
            <Layer
              id="lc-pills"
              type="symbol"
              filter={['!', ['has', 'point_count']]}
              layout={{
                'icon-image': ['get', 'pill'],
                'icon-anchor': 'bottom',
                'icon-offset': [0, -PILL_LIFT],
                'icon-padding': [0],
                'text-field': ['get', 'priceLabel'],
                'text-font': MAP_FONT_BOLD,
                'text-size': PILL_TEXT_SIZE,
                'text-anchor': 'center',
                // Centre the text on the pill body (ems), nudged for Noto's digit baseline.
                'text-offset': [0, -PILL_CENTER / PILL_TEXT_SIZE + 0.06],
                'text-padding': 0,
                'symbol-sort-key': expr(['case', isApprox, 1, 0]),
              }}
              paint={{
                'icon-color': expr(['case', isApprox, colors.surface, byLandType('fill')]),
                'icon-halo-color': expr(['case', isApprox, byLandType('ink'), withAlpha(palette.white, 0.92)]),
                'icon-halo-width': expr(['case', isApprox, 1.3, 1.6]),
                'icon-opacity': expr(['case', isActive, 0, 1]),
                'text-color': expr(['case', isApprox, byLandType('ink'), byLandType('on')]),
                'text-opacity': expr(['case', isActive, 0, 1]),
              }}
            />
          </GeoJSONSource>

          {active ? (
            <Marker
              key={active.listing.id}
              id="lc-selected"
              lngLat={active.lngLat}
              anchor={active.approximate ? 'center' : 'bottom'}
              offset={active.approximate ? [0, 0] : SELECTED_PIN_OFFSET}
              onPress={onSelectedPress}>
              <SelectedPin
                price={active.priceLabel}
                detail={
                  active.approximate ? 'Approx. area' : formatArea(active.listing.area_value, active.listing.area_unit)
                }
                landType={active.listing.land_type}
                approximate={active.approximate}
                actions={{
                  orbiting: orbit.running,
                  progress: orbit.progress,
                  onZones: (z) => {
                    zonesRef.current = z;
                  },
                }}
              />
            </Marker>
          ) : null}

          {locationGranted ? <UserLocation accuracy /> : null}
        </Map>
      </View>

      <MapSkeleton status={skeletonStatus(basemap)} onRetry={basemap.retry} />

      {/* Search + land-type filters, which double as the colour legend */}
      <Animated.View
        entering={FadeInDown.springify().damping(24).stiffness(200)}
        pointerEvents="box-none"
        style={[styles.top, { paddingTop: insets.top }]}>
        <View style={styles.search}>
          <Search size={19} color={colors.inkSecondary} strokeWidth={2.1} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search a village or taluk"
            placeholderTextColor={colors.inkTertiary}
            selectionColor={colors.accent}
            cursorColor={colors.accent}
            returnKeyType="search"
            autoCorrect={false}
            allowFontScaling={false}
            style={styles.searchInput}
          />
          {search ? (
            <PressableScale
              haptic="selection"
              onPress={() => setSearch('')}
              accessibilityLabel="Clear search"
              style={styles.clear}>
              <X size={14} color={colors.inkSecondary} strokeWidth={2.3} />
            </PressableScale>
          ) : (
            <Label tone="secondary" style={styles.count}>
              {listings.isPending ? 'Loading' : `${items.length} ${items.length === 1 ? 'parcel' : 'parcels'}`}
            </Label>
          )}
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.chips}>
          {FILTERS.map((f) => (
            <FilterChip
              key={f.value}
              label={f.label}
              landType={f.value}
              count={counts[f.value] ?? 0}
              selected={landType === f.value}
              onPress={() => setLandType(f.value)}
            />
          ))}
        </ScrollView>

        <View pointerEvents="box-none" style={styles.areaRow}>
          {orbit.running ? (
            <OrbitHud
              key="orbit"
              ref={hudRef}
              progress={orbit.progress}
              initialBearing={bearing.get()}
              onStop={() => orbit.stop()}
            />
          ) : searchHere && mapReady && matches.length > 0 ? (
            <FloatingPill
              key="search"
              icon={<Search size={16} color={colors.accent} strokeWidth={2.3} />}
              label="Search this area"
              onPress={searchThisArea}
            />
          ) : showAreaChip ? (
            <FloatingPill
              key="area"
              tone="dark"
              icon={<X size={15} color={colors.inkOnDark} strokeWidth={2.3} />}
              label={`In this area · ${items.length}`}
              accessibilityLabel="Show listings everywhere"
              onPress={() => setAreaBounds(null)}
            />
          ) : null}
        </View>
      </Animated.View>

      {/* Scale bar sits beside the attribution button, above the carousel */}
      {mapReady ? (
        <Animated.View
          entering={FadeIn.duration(260)}
          pointerEvents="none"
          style={[styles.scale, { bottom: overlayAboveCarousel + creditRoom + (notice ? NOTICE_H + space[3] : 0) }]}>
          <ScaleBar ref={scaleRef} initial={{ zoom: DEFAULT_ZOOM, lat: DEFAULT_CENTER[1] }} />
        </Animated.View>
      ) : null}

      {/* Floating map controls */}
      <Animated.View
        entering={FadeIn.delay(180).duration(260)}
        pointerEvents="box-none"
        style={[styles.fabs, { bottom: overlayAboveCarousel + creditRoom + (notice ? NOTICE_H + space[3] : 0) }]}>
        <Compass bearing={bearing} pitch={pitch} onPress={squareUp} />
        <IconButton label="Show all listings" onPress={() => fitAll()} disabled={items.length === 0}>
          <Expand size={19} color={colors.ink} strokeWidth={2.1} />
        </IconButton>
        <IconButton label="Centre on my location" onPress={recenter}>
          <LocateFixed size={20} color={locationGranted ? colors.accent : colors.ink} strokeWidth={2.1} />
        </IconButton>
      </Animated.View>

      {mapReady ? (
        <MapModeSwitch
          modes={EXPLORE_MODES}
          value={mode}
          onChange={changeMode}
          style={[styles.modes, { top: topOverlay + space[1] }]}
        />
      ) : null}

      {mode === 'satellite' && mapReady ? (
        <View pointerEvents="none" style={[styles.credit, { bottom: overlayAboveCarousel - space[1] }]}>
          <ImageryCredit />
        </View>
      ) : null}

      {notice ? <View style={[styles.notice, { bottom: overlayAboveCarousel + creditRoom }]}>{notice}</View> : null}

      {/* Carousel linked to the camera */}
      {listings.isPending ? (
        <View
          pointerEvents="none"
          style={[styles.skeletonRow, { bottom: insets.bottom, left: sideInset + CARD_GAP / 2 - itemWidth }]}>
          {[0, 1, 2].map((i) => (
            <View key={i} style={{ opacity: i === 1 ? 1 : 0.6, marginRight: CARD_GAP }}>
              <MapListingCardSkeleton width={cardWidth} />
            </View>
          ))}
        </View>
      ) : hasCarousel ? (
        <Animated.View
          entering={FadeInUp.delay(120).springify().damping(24).stiffness(200)}
          style={[styles.carousel, { bottom: carouselBottom, height: MAP_CARD_HEIGHT + SHADOW_ROOM * 2 }]}>
          <AnimatedList
            ref={listRef}
            data={items}
            horizontal
            keyExtractor={(m) => m.listing.id}
            extraData={userLngLat}
            showsHorizontalScrollIndicator={false}
            snapToInterval={itemWidth}
            snapToAlignment="start"
            decelerationRate="fast"
            disableIntervalMomentum
            onScroll={onScroll}
            scrollEventThrottle={16}
            onMomentumScrollEnd={onCarouselSettled}
            ListHeaderComponent={<View style={{ width: sideInset }} />}
            ListFooterComponent={<View style={{ width: sideInset }} />}
            renderItem={({ item, index }) => (
              <View style={[styles.slide, { width: itemWidth }]}>
                <MapListingCard
                  item={item}
                  index={index}
                  scrollX={scrollX}
                  itemWidth={itemWidth}
                  width={cardWidth}
                  distance={distanceLabel(item)}
                  onPress={() => router.push(`/listing/${item.listing.id}`)}
                  onDirections={() => directionsTo(item)}
                />
              </View>
            )}
          />
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  top: { position: 'absolute', top: 0, left: 0, right: 0 },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    height: SEARCH_H,
    marginHorizontal: gutter,
    paddingLeft: space[4],
    paddingRight: space[2] + 2,
    borderRadius: radius.pill,
    borderCurve: 'continuous',
    backgroundColor: colors.surface,
    boxShadow: shadow.float,
  },
  searchInput: {
    flex: 1,
    height: SEARCH_H,
    fontFamily: font.medium,
    fontSize: 15,
    letterSpacing: -0.1,
    color: colors.ink,
    paddingVertical: 0,
  },
  count: { paddingRight: space[2], fontVariant: ['tabular-nums'] },
  clear: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSunken,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chips: { gap: space[2], paddingHorizontal: gutter, paddingVertical: space[2] },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    height: 36,
    paddingLeft: space[3],
    paddingRight: space[3] + 2,
    borderRadius: radius.pill,
    borderCurve: 'continuous',
    backgroundColor: colors.surface,
    boxShadow: shadow.card,
  },
  chipSelected: { backgroundColor: colors.ink },
  legendDot: { width: 9, height: 9, borderRadius: 5 },
  dotStack: { flexDirection: 'row' },
  stackedDot: { borderWidth: 1.5, borderColor: colors.surface, width: 11, height: 11, borderRadius: 6 },
  tabular: { fontVariant: ['tabular-nums'] },
  areaRow: { alignItems: 'center', minHeight: 40 },
  scale: { position: 'absolute', left: gutter + space[6] },
  fabs: { position: 'absolute', right: gutter, gap: space[3] },
  modes: { position: 'absolute', right: gutter },
  credit: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  notice: { position: 'absolute', left: gutter, right: gutter },
  carousel: { position: 'absolute', left: 0, right: 0 },
  skeletonRow: { position: 'absolute', flexDirection: 'row' },
  slide: { paddingHorizontal: CARD_GAP / 2, paddingVertical: SHADOW_ROOM, alignItems: 'center' },
});
