import { Layer } from '@maplibre/maplibre-react-native';
import { Map as MapIcon, Satellite } from 'lucide-react-native';
import { useEffect, useEffectEvent, useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { FadeIn, FadeOut, useAnimatedStyle, useDerivedValue, withSpring } from 'react-native-reanimated';

import type { LngLat } from '@/lib/types';
import { PressableScale } from '@/ui/pressable-scale';
import { Label, Text } from '@/ui/text';
import { colors, radius, shadow, space, spring } from '@/theme/tokens';

import { DEM_TILES, IMAGERY_TILES, MODE_LAYER } from './map-basemap';
import { withAlpha } from './map-style';

/**
 * Map modes shared by the explore map, the location picker and the listing preview.
 *
 * - `map`: the branded vector basemap only. No imagery or elevation tiles are requested.
 * - `satellite`: Esri World Imagery under our roads, boundaries and labels (hybrid).
 * - `3d`: pitched camera, extruded buildings, terrain shading, the parcel as a slab.
 */
export type MapMode = 'map' | 'satellite' | '3d';

export const MODE_NAME: Record<MapMode, string> = { map: 'Map', satellite: 'Satellite', '3d': '3D' };

/** Pitch the 3D mode settles at. MapLibre caps pitch at 60. */
export const PITCH_3D = 58;

const FADE = { duration: 360, delay: 0 };

/**
 * Adopts the mode layers baked into the branded style (see map-basemap) and drives them with the
 * few properties whose Android setters take plain numbers or strings: visibility and opacity.
 * Render inside `<Map>`, and only while the branded style is active (`basemap.branded`): the
 * stock fallback style has no such layers.
 */
export function MapModeLayers({ mode, enabled }: { mode: MapMode; enabled: boolean }) {
  const satellite = mode === 'satellite';
  const three = mode === '3d';
  // Imagery stays drawable for one fade after satellite is left, then hides so it holds no tiles.
  const [imageryLingers, setImageryLingers] = useState(false);
  useEffect(() => {
    if (satellite) {
      setImageryLingers(true);
      return;
    }
    const t = setTimeout(() => setImageryLingers(false), FADE.duration + 80);
    return () => clearTimeout(t);
  }, [satellite]);

  if (!enabled) return null;
  return (
    <>
      <Layer
        id={MODE_LAYER.imagery}
        type="raster"
        layout={{ visibility: satellite || imageryLingers ? 'visible' : 'none' }}
        paint={{ 'raster-opacity': satellite ? 1 : 0, 'raster-opacity-transition': FADE }}
      />
      <Layer
        id={MODE_LAYER.hillshade}
        type="hillshade"
        // Relief only in 3D: in Map mode it cost a stream of elevation tiles for a barely visible tint.
        layout={{ visibility: three ? 'visible' : 'none' }}
        paint={{ 'hillshade-exaggeration': 0.5 }}
      />
      <Layer id={MODE_LAYER.buildings} type="fill-extrusion" layout={{ visibility: three ? 'visible' : 'none' }} />
      {/* Hybrid look: the pale minor roads would read as glare on photos, so they step back. */}
      <Layer
        id="highway_minor"
        type="line"
        paint={{ 'line-opacity': satellite ? 0.5 : 0.9, 'line-opacity-transition': FADE }}
      />
      <Layer
        id="highway_path"
        type="line"
        paint={{ 'line-opacity': satellite ? 0.4 : 0.9, 'line-opacity-transition': FADE }}
      />
    </>
  );
}

// ── tile health: MapLibre Native reports no per-tile errors, so a mode probes one real tile

export type ModeTiles = 'idle' | 'checking' | 'ok' | 'failed';

function tileAt([lng, lat]: LngLat, z: number) {
  const n = 2 ** z;
  const r = (Math.max(-85, Math.min(85, lat)) * Math.PI) / 180;
  const x = Math.floor(((lng + 180) / 360) * n);
  const y = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
  const clamp = (v: number) => Math.max(0, Math.min(n - 1, v));
  return { x: clamp(x), y: clamp(y), z };
}

function probeUrl(mode: MapMode, at: LngLat) {
  if (mode === 'satellite') {
    const t = tileAt(at, 15);
    return IMAGERY_TILES.replace('{z}', String(t.z)).replace('{y}', String(t.y)).replace('{x}', String(t.x));
  }
  if (mode === '3d') {
    const t = tileAt(at, 11);
    return DEM_TILES.replace('{z}', String(t.z)).replace('{x}', String(t.x)).replace('{y}', String(t.y));
  }
  return null;
}

const PROBE_TIMEOUT_MS = 9000;

/**
 * Fetches one imagery (satellite) or elevation (3D) tile near `at()` when a mode is chosen.
 * A failure never blanks the map — the branded vector map stays underneath — but the screen
 * can say why the photos or relief are missing and offer a retry.
 */
export function useModeTiles(mode: MapMode, at: () => LngLat) {
  const [result, setResult] = useState<{ key: string; status: ModeTiles } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const key = `${mode}:${attempt}`;

  const resolveUrl = useEffectEvent(() => probeUrl(mode, at()));

  useEffect(() => {
    const url = resolveUrl();
    if (!url) return;
    let live = true;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
    setResult({ key, status: 'checking' });
    fetch(url, { signal: ctrl.signal })
      .then((res) => {
        if (live) setResult({ key, status: res.ok ? 'ok' : 'failed' });
      })
      .catch(() => {
        if (live) setResult({ key, status: 'failed' });
      })
      .finally(() => clearTimeout(timer));
    return () => {
      live = false;
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [key]);

  const status: ModeTiles = mode === 'map' ? 'idle' : result?.key === key ? result.status : 'checking';
  return { status, retry: () => setAttempt((a) => a + 1) };
}

// ── switcher

const ITEM = 44;
const PAD = 4;

function ModeGlyph({ mode, active }: { mode: MapMode; active: boolean }) {
  const color = active ? colors.inkOnDark : colors.ink;
  if (mode === 'map') return <MapIcon size={19} color={color} strokeWidth={2.1} />;
  if (mode === 'satellite') return <Satellite size={19} color={color} strokeWidth={2.1} />;
  return (
    <Text variant="captionStrong" tone={active ? 'onDark' : 'ink'} style={styles.glyph3d}>
      3D
    </Text>
  );
}

/**
 * Stacked mode switch: a floating capsule whose dark thumb slides between modes. The chosen
 * mode's name flashes beside it, so icons never have to be guessed.
 */
export function MapModeSwitch({
  modes,
  value,
  onChange,
  style,
}: {
  modes: readonly MapMode[];
  value: MapMode;
  onChange: (mode: MapMode) => void;
  style?: StyleProp<ViewStyle>;
}) {
  const index = Math.max(0, modes.indexOf(value));
  const [flash, setFlash] = useState<{ mode: MapMode; n: number } | null>(null);

  const y = useDerivedValue(() => withSpring(index * ITEM, spring.snappy));
  const thumb = useAnimatedStyle(() => ({ transform: [{ translateY: y.get() }] }));

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 1500);
    return () => clearTimeout(t);
  }, [flash]);

  return (
    <View style={[styles.wrap, style]} pointerEvents="box-none">
      {flash ? (
        <Animated.View
          key={flash.n}
          entering={FadeIn.duration(160)}
          exiting={FadeOut.duration(220)}
          pointerEvents="none"
          style={[styles.flash, { top: PAD + index * ITEM + (ITEM - 28) / 2 }]}>
          <Label tone="onDark">{MODE_NAME[flash.mode]}</Label>
        </Animated.View>
      ) : null}
      <View style={styles.track} accessibilityRole="tablist">
        <Animated.View style={[styles.thumb, thumb]} />
        {modes.map((m) => {
          const active = m === value;
          return (
            <PressableScale
              key={m}
              to={0.9}
              haptic="selection"
              accessibilityRole="tab"
              accessibilityLabel={`${MODE_NAME[m]} view`}
              accessibilityState={{ selected: active }}
              hitSlop={{ left: 8, right: 8, top: 0, bottom: 0 }}
              onPress={() => {
                setFlash((f) => ({ mode: m, n: (f?.n ?? 0) + 1 }));
                if (!active) onChange(m);
              }}
              style={styles.item}>
              <ModeGlyph mode={m} active={active} />
            </PressableScale>
          );
        })}
      </View>
    </View>
  );
}

/** Required credit while imagery is on screen. The full text also sits in the map's (i) sheet. */
export function ImageryCredit({ style }: { style?: StyleProp<ViewStyle> }) {
  return (
    <Animated.View
      entering={FadeIn.duration(220)}
      exiting={FadeOut.duration(160)}
      pointerEvents="none"
      style={[styles.credit, style]}>
      <Label tone="secondary" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>
        Powered by Esri · Maxar, Earthstar
      </Label>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'flex-start' },
  track: {
    width: ITEM + PAD * 2,
    padding: PAD,
    borderRadius: radius.pill,
    borderCurve: 'continuous',
    backgroundColor: colors.surface,
    boxShadow: shadow.card,
  },
  thumb: {
    position: 'absolute',
    top: PAD,
    left: PAD,
    width: ITEM,
    height: ITEM,
    // Nested radius: track radius (ITEM / 2 + PAD) − PAD.
    borderRadius: radius.lg,
    backgroundColor: colors.ink,
  },
  item: { width: ITEM, height: ITEM, alignItems: 'center', justifyContent: 'center' },
  glyph3d: { letterSpacing: 0.2 },
  flash: {
    position: 'absolute',
    right: ITEM + PAD * 2 + space[2],
    height: 28,
    justifyContent: 'center',
    paddingHorizontal: space[3],
    borderRadius: radius.pill,
    backgroundColor: colors.ink,
    boxShadow: shadow.card,
  },
  credit: {
    alignSelf: 'flex-start',
    paddingHorizontal: space[2],
    paddingVertical: space[1],
    borderRadius: radius.xs,
    borderCurve: 'continuous',
    backgroundColor: withAlpha(colors.surface, 0.9),
  },
});
