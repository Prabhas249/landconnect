import { useEffect, useRef, useState } from 'react';
import type { StyleSpecification } from '@maplibre/maplibre-react-native';

import { colors, palette } from '@/theme/tokens';

import { MAP_FONT_BOLD, MAP_FONT_ITALIC, MAP_FONT_REGULAR, MAP_STYLE_URL, mix, withAlpha } from './map-style';
import positron from './positron-style.json';

/**
 * LandConnect basemap: OpenFreeMap "positron" recoloured toward the brand's pale mint and forest.
 *
 * A snapshot of the style JSON is bundled (tiles, glyphs and sprites still stream from OpenFreeMap),
 * so the branded map draws on the first frame with no extra request. If it ever fails to load,
 * screens fall back to the stock positron URL — see `useBasemap`.
 */

type AnyLayer = { id: string; type: string; paint?: Record<string, unknown>; layout?: Record<string, unknown> };
type Patch = { paint?: Record<string, unknown>; layout?: Record<string, unknown>; dropLayout?: string[] };

const land = mix(colors.canvas, palette.mintWash, 0.5);
const waterHue = mix(palette.mint, palette.blue, 0.42);
const water = mix(waterHue, colors.canvas, 0.7);
const waterLine = mix(waterHue, colors.canvas, 0.55);
const waterInk = mix(waterHue, palette.forest, 0.38);
const park = mix(palette.mintSoft, colors.canvas, 0.58);
const wood = mix(palette.mintSoft, colors.canvas, 0.42);
const built = mix(colors.canvasDeep, colors.canvas, 0.3);
const building = mix(colors.canvasDeep, palette.forest, 0.035);
const buildingEdge = mix(colors.canvasDeep, palette.forest, 0.09);
const casing = mix(colors.canvasDeep, palette.forest, 0.11);
const minorRoad = mix(colors.canvasDeep, palette.forest, 0.045);
const path = mix(colors.canvasDeep, palette.forest, 0.03);
const motorway = mix(palette.white, palette.mintSoft, 0.55);
const motorwayCasing = mix(palette.mintSoft, palette.forest, 0.2);
const rail = mix(colors.canvasDeep, palette.forest, 0.13);
const halo = withAlpha(colors.canvas, 0.92);
const adminLine = withAlpha(palette.green, 0.38);
const countryLine = mix(palette.green, colors.canvas, 0.55);

/** Latin name only: one quiet line instead of the stacked bilingual default. */
const NAME = ['coalesce', ['get', 'name:en'], ['get', 'name_en'], ['get', 'name:latin'], ['get', 'name']];

const quietText = (color: string, width = 1.3) => ({
  'text-color': color,
  'text-halo-color': halo,
  'text-halo-width': width,
  'text-halo-blur': 0.4,
});

// Place labels drop their black dots; the parcels carry the points of interest.
const NO_DOT = ['icon-image', 'icon-size', 'icon-allow-overlap', 'icon-optional'];

const PATCHES: Record<string, Patch> = {
  background: { paint: { 'background-color': land } },
  park: { paint: { 'fill-color': park } },
  water: { paint: { 'fill-color': water } },
  landuse_residential: { paint: { 'fill-color': built } },
  landcover_wood: { paint: { 'fill-color': wood } },
  waterway: { paint: { 'line-color': waterLine } },
  building: { paint: { 'fill-color': building, 'fill-outline-color': buildingEdge } },

  tunnel_motorway_casing: { paint: { 'line-color': motorwayCasing } },
  tunnel_motorway_inner: { paint: { 'line-color': motorway } },
  'aeroway-taxiway': { paint: { 'line-color': minorRoad } },
  'aeroway-runway-casing': { paint: { 'line-color': minorRoad } },
  'aeroway-area': { paint: { 'fill-color': palette.white } },
  road_area_pier: { paint: { 'fill-color': land } },
  road_pier: { paint: { 'line-color': land } },
  highway_path: { paint: { 'line-color': path } },
  highway_minor: { paint: { 'line-color': minorRoad } },
  highway_major_casing: { paint: { 'line-color': casing } },
  highway_major_inner: { paint: { 'line-color': palette.white } },
  highway_major_subtle: { paint: { 'line-color': withAlpha(casing, 0.7) } },
  highway_motorway_casing: { paint: { 'line-color': motorwayCasing } },
  highway_motorway_inner: {
    paint: { 'line-color': ['interpolate', ['linear'], ['zoom'], 5.8, withAlpha(motorwayCasing, 0.5), 6, motorway] },
  },
  highway_motorway_subtle: { paint: { 'line-color': withAlpha(motorwayCasing, 0.55) } },
  highway_motorway_bridge_casing: { paint: { 'line-color': motorwayCasing } },
  highway_motorway_bridge_inner: {
    paint: { 'line-color': ['interpolate', ['linear'], ['zoom'], 5.8, withAlpha(motorwayCasing, 0.5), 6, motorway] },
  },
  railway_transit: { paint: { 'line-color': rail } },
  railway_service: { paint: { 'line-color': rail } },
  railway: { paint: { 'line-color': rail } },
  railway_transit_dashline: { paint: { 'line-color': land } },
  railway_service_dashline: { paint: { 'line-color': land } },
  railway_dashline: { paint: { 'line-color': land } },

  // State, district and taluk lines (admin 3–6): a little stronger and green, they frame the market.
  boundary_3: {
    paint: {
      'line-color': adminLine,
      'line-dasharray': [3, 2],
      'line-width': ['interpolate', ['linear'], ['zoom'], 7, 0.9, 11, 1.6, 15, 2.2],
    },
  },
  boundary_2: { paint: { 'line-color': countryLine } },
  boundary_disputed: { paint: { 'line-color': countryLine } },

  waterway_line_label: { layout: { 'text-field': NAME, 'text-size': 11 }, paint: quietText(waterInk) },
  water_name_point_label: {
    layout: { 'text-field': NAME, 'text-size': ['interpolate', ['linear'], ['zoom'], 0, 10, 8, 12] },
    paint: quietText(waterInk),
  },
  water_name_line_label: { layout: { 'text-field': NAME, 'text-size': 11 }, paint: quietText(waterInk) },
  'highway-name-path': { layout: { 'text-field': NAME, 'text-size': 10.5 }, paint: quietText(colors.inkTertiary, 1) },
  'highway-name-minor': { layout: { 'text-field': NAME, 'text-size': 10.5 }, paint: quietText(colors.inkTertiary, 1) },
  'highway-name-major': { layout: { 'text-field': NAME, 'text-size': 11 }, paint: quietText(colors.inkTertiary, 1) },
  'highway-shield-non-us': { paint: { 'text-color': colors.inkSecondary, 'icon-opacity': 0.75 } },
  airport: { layout: { 'text-field': NAME }, paint: quietText(colors.inkSecondary) },

  label_other: {
    layout: {
      'text-field': NAME,
      'text-size': ['interpolate', ['linear'], ['zoom'], 8, 8.5, 13, 10],
      'text-letter-spacing': 0.14,
    },
    paint: quietText(colors.inkTertiary),
  },
  label_village: {
    layout: {
      'text-field': NAME,
      'text-font': MAP_FONT_REGULAR,
      'text-anchor': 'center',
      'text-size': ['interpolate', ['linear'], ['zoom'], 9, 10, 13, 12],
    },
    dropLayout: NO_DOT,
    paint: quietText(colors.inkSecondary),
  },
  // Towns are taluk headquarters around Bengaluru (Devanahalli, Hoskote, Kanakapura): the names buyers search for.
  label_town: {
    layout: {
      'text-field': NAME,
      'text-font': MAP_FONT_BOLD,
      'text-anchor': 'center',
      'text-letter-spacing': 0.02,
      'text-size': ['interpolate', ['linear'], ['zoom'], 7, 11, 11, 13.5, 14, 15],
    },
    dropLayout: NO_DOT,
    paint: quietText(palette.forest, 1.6),
  },
  label_state: {
    layout: { 'text-field': NAME, 'text-font': MAP_FONT_ITALIC, 'text-letter-spacing': 0.3 },
    paint: quietText(colors.inkTertiary),
  },
  label_city: {
    layout: { 'text-field': NAME, 'text-font': MAP_FONT_BOLD, 'text-anchor': 'center', 'text-offset': [0, 0] },
    dropLayout: NO_DOT,
    paint: quietText(palette.forest, 1.8),
  },
  label_city_capital: {
    layout: { 'text-field': NAME, 'text-anchor': 'center', 'text-offset': [0, 0], 'text-letter-spacing': 0.04 },
    dropLayout: NO_DOT,
    paint: quietText(palette.forest, 2),
  },
  label_country_3: { layout: { 'text-field': NAME }, paint: quietText(colors.inkSecondary) },
  label_country_2: { layout: { 'text-field': NAME }, paint: quietText(colors.inkSecondary) },
  label_country_1: { layout: { 'text-field': NAME }, paint: quietText(colors.inkSecondary) },
};

// ── map modes baked into the branded style
//
// Satellite imagery, terrain shading and 3D buildings live in the style JSON itself, so MapLibre
// Native's own style parser builds them (no React Native property setters involved — several of
// the Android setters for hillshade expect arrays and crash on plain values). Each starts with
// `visibility: none`; `MapModeLayers` adopts the layers by id and toggles only visibility and
// opacity at runtime. A hidden layer requests no tiles, so plain Map mode never touches the
// imagery or elevation servers.

/** Esri World Imagery: keyless XYZ tiles. Note the {z}/{y}/{x} order. */
export const IMAGERY_TILES =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
/** Imagery stops at z18 here; above that MapLibre overzooms instead of fetching "no data" tiles. */
export const IMAGERY_MAX_ZOOM = 18;
export const IMAGERY_ATTRIBUTION =
  'Powered by Esri. Imagery: Esri, Maxar, Earthstar Geographics, and the GIS User Community';
/** AWS open terrain tiles (Terrarium encoding), keyless. */
export const DEM_TILES = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
const DEM_MAX_ZOOM = 13;

export const MODE_LAYER = {
  imagery: 'lc-imagery',
  hillshade: 'lc-hillshade',
  buildings: 'lc-buildings-3d',
} as const;

const SOURCES = {
  'lc-imagery-src': {
    type: 'raster',
    tiles: [IMAGERY_TILES],
    tileSize: 256,
    maxzoom: IMAGERY_MAX_ZOOM,
    attribution: IMAGERY_ATTRIBUTION,
  },
  'lc-dem-src': {
    type: 'raster-dem',
    tiles: [DEM_TILES],
    tileSize: 256,
    maxzoom: DEM_MAX_ZOOM,
    encoding: 'terrarium',
    attribution: 'Terrain: Mapzen, AWS Open Data',
  },
};

const building3d = mix(colors.canvasDeep, palette.forest, 0.05);

/** Inserted in front of the named basemap layer (falls back to the top of the stack). */
const MODE_LAYERS: { before: string; layer: AnyLayer & Record<string, unknown> }[] = [
  {
    // Relief sits on the land colours and under water, roads and labels.
    before: 'waterway',
    layer: {
      id: MODE_LAYER.hillshade,
      type: 'hillshade',
      source: 'lc-dem-src',
      layout: { visibility: 'none' },
      paint: {
        'hillshade-exaggeration': 0.2,
        'hillshade-illumination-direction': 315,
        'hillshade-shadow-color': withAlpha(palette.forest, 0.34),
        'hillshade-highlight-color': withAlpha(palette.white, 0.42),
        'hillshade-accent-color': withAlpha(palette.forest, 0.18),
      },
    },
  },
  {
    // Imagery covers every land fill (and tunnels, airport aprons) but stays under roads,
    // boundaries and labels: a hybrid map.
    before: 'highway_path',
    layer: {
      id: MODE_LAYER.imagery,
      type: 'raster',
      source: 'lc-imagery-src',
      layout: { visibility: 'none' },
      paint: {
        'raster-opacity': 0,
        'raster-fade-duration': 240,
        'raster-saturation': -0.12,
        'raster-contrast': 0.04,
      },
    },
  },
  {
    // Above roads, below labels. Height grows in from z14 so buildings rise as you zoom in.
    before: 'waterway_line_label',
    layer: {
      id: MODE_LAYER.buildings,
      type: 'fill-extrusion',
      source: 'openmaptiles',
      'source-layer': 'building',
      minzoom: 14,
      filter: ['!=', ['get', 'hide_3d'], true],
      layout: { visibility: 'none' },
      paint: {
        'fill-extrusion-color': building3d,
        'fill-extrusion-height': [
          'interpolate',
          ['linear'],
          ['zoom'],
          14,
          0,
          15.5,
          ['coalesce', ['get', 'render_height'], 5],
        ],
        'fill-extrusion-base': [
          'interpolate',
          ['linear'],
          ['zoom'],
          14,
          0,
          15.5,
          ['coalesce', ['get', 'render_min_height'], 0],
        ],
        'fill-extrusion-opacity': ['interpolate', ['linear'], ['zoom'], 14, 0, 15, 0.86],
      },
    },
  },
];

/**
 * Where LandConnect drawings sit in the basemap stack. Pass as `beforeId` on every overlay layer.
 * These ids exist in both the branded style and the stock positron fallback (an anchor that is
 * missing makes MapLibre wait forever and never add the layer), and must never change while a
 * layer is mounted.
 *
 * Stack, bottom to top: land cover, buildings, satellite imagery → `ground` (parcel and
 * approximate-area fills) → paths, roads, rail, bridges → `lines` (parcel outlines, guide line,
 * survey nodes, the 3D slab) → admin boundaries, 3D buildings → `labels` (edge lengths, guide
 * distance; they collide with and yield to the basemap labels above) → water, road and place
 * names → appended last: clusters, dots, price pills, then marker views (selected callout, pins).
 */
export const SLOT = {
  ground: 'highway_path',
  lines: 'boundary_3',
  labels: 'waterway_line_label',
} as const;

/** Soft daylight for extrusions (buildings and the selected parcel's slab). */
const LIGHT = { anchor: 'viewport', color: palette.white, intensity: 0.38, position: [1.15, 210, 30] };

function withModes(layers: AnyLayer[]): AnyLayer[] {
  const out = [...layers];
  for (const { before, layer } of MODE_LAYERS) {
    const at = out.findIndex((l) => l.id === before);
    out.splice(at < 0 ? out.length : at, 0, layer);
  }
  return out;
}

function brand(base: StyleSpecification): StyleSpecification {
  const layers = (base.layers as unknown as AnyLayer[]).map((layer) => {
    const patch = PATCHES[layer.id];
    if (!patch) return layer;
    const layout = { ...layer.layout, ...patch.layout };
    for (const key of patch.dropLayout ?? []) delete layout[key];
    return {
      ...layer,
      paint: { ...layer.paint, ...patch.paint },
      ...(layer.layout || patch.layout ? { layout } : null),
    };
  });
  return {
    ...base,
    name: 'LandConnect',
    sources: { ...base.sources, ...SOURCES },
    light: LIGHT,
    layers: withModes(layers),
  } as unknown as StyleSpecification;
}

/** Branded style object (for validation scripts and tests). */
export function brandedStyleSpec(): StyleSpecification {
  return brand(positron as unknown as StyleSpecification);
}

let branded: string | null = null;

/**
 * Serialised once: `Map` stringifies object styles on every render, and an identical
 * string is what keeps the native side from reloading the style.
 */
export function brandedStyle(): string {
  if (!branded) {
    try {
      branded = JSON.stringify(brandedStyleSpec());
    } catch {
      branded = MAP_STYLE_URL;
    }
  }
  return branded;
}

export type BasemapMode = 'brand' | 'stock';

export function basemapFor(mode: BasemapMode) {
  return mode === 'brand' ? brandedStyle() : MAP_STYLE_URL;
}

export type BasemapStatus = 'loading' | 'ready' | 'failed';

/**
 * Style choice and load state for one map view: branded first, stock positron if the branded
 * style fails, and a "failed" state when tiles never arrive (offline, blocked) so the screen can say so.
 */
export function useBasemap({ timeoutMs = 20_000 }: { timeoutMs?: number } = {}) {
  const [mode, setMode] = useState<BasemapMode>('brand');
  const [status, setStatus] = useState<BasemapStatus>('loading');
  const [attempt, setAttempt] = useState(0);
  const [painted, setPainted] = useState(false);
  const styleLoaded = useRef(false);

  useEffect(() => {
    if (status !== 'loading') return;
    const t = setTimeout(() => setStatus((s) => (s === 'loading' ? 'failed' : s)), timeoutMs);
    return () => clearTimeout(t);
  }, [status, attempt, timeoutMs]);

  return {
    mapStyle: basemapFor(mode),
    /**
     * True while the branded style is in use. Only it carries the satellite / terrain / 3D layers;
     * the stock fallback is plain positron, so mode layers must not be mounted against it.
     */
    branded: mode === 'brand',
    /** Remount key for a full retry. */
    attempt,
    /** `ready` once every tile of the first view has arrived (MapLibre's "finished loading"). */
    status,
    /**
     * True from the first frame drawn with the style in place: the map is on screen and takes
     * camera commands, even while some tiles are still streaming in.
     */
    painted: painted || status === 'ready',
    onDidFinishLoadingStyle: () => {
      styleLoaded.current = true;
    },
    // Detached after the first frame so later frames cost nothing on the JS side.
    onDidFinishRenderingFrame: painted
      ? undefined
      : () => {
          if (styleLoaded.current) setPainted(true);
        },
    onDidFinishLoadingMap: () => {
      setPainted(true);
      setStatus('ready');
    },
    onDidFailLoadingMap: () => {
      styleLoaded.current = false;
      setPainted(false);
      if (mode === 'brand') setMode('stock');
      else setStatus('failed');
    },
    retry: () => {
      styleLoaded.current = false;
      setPainted(false);
      setMode('brand');
      setStatus('loading');
      setAttempt((a) => a + 1);
    },
  };
}

/** Skeleton state for a full-screen map: it dissolves at the first painted frame, not the last tile. */
export function skeletonStatus(basemap: { status: BasemapStatus; painted: boolean }): BasemapStatus {
  if (basemap.status === 'failed') return 'failed';
  return basemap.painted ? 'ready' : 'loading';
}
