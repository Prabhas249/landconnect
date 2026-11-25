import { Skia, type SkMatrix, type SkPath } from '@shopify/react-native-skia';

import { palette } from '@/theme/tokens';

/* ------------------------------------------------------------------ */
/* Colour helpers — every tone is derived from brand tokens, never new. */
/* ------------------------------------------------------------------ */

function hexToRgb(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255] as const;
}

export function mix(a: string, b: string, t: number) {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  // Returns hex so mixed tones can be mixed again.
  return `#${ca.map((v, i) => Math.round(v + (cb[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
}

export function withAlpha(hex: string, alpha: number) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** Deterministic PRNG so the patchwork is identical on every launch. */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------------ */
/* Scene model                                                          */
/* ------------------------------------------------------------------ */

export type Pt = { x: number; y: number };
type UV = { u: number; v: number };

export type ParcelModel = {
  key: string;
  top: SkPath;
  left: SkPath;
  right: SkPath;
  rows: SkPath | null;
  fill: string;
  leftFill: string;
  rightFill: string;
  rowColor: string;
  rowOpacity: number;
  /** Rise delay (ms) — a ripple spreading out from the surveyed plot. */
  delay: number;
  /**
   * A real aerial photograph on the top face, for a few parcels. The isometric projection is affine,
   * so one matrix maps the (square) photo exactly onto the face; `index` picks the photo.
   */
  ground: { index: number; matrix: SkMatrix } | null;
};

export type TreeModel = { key: string; x: number; y: number; r: number; delay: number };

export type Plot = {
  /** Raised top face. Corners run top → right → bottom → left in screen space. */
  top: SkPath;
  corners: Pt[];
  center: Pt;
  /** Real edge lengths in metres, matching `corners[i] → corners[i + 1]`. */
  edges: number[];
  areaSqm: number;
  /** Screen-space extent of the top face. */
  extent: { w: number; h: number };
};

export type Land = {
  parcels: ParcelModel[];
  trees: TreeModel[];
  road: SkPath;
  plot: Plot;
  /** Centres of the three listed parcels: [chosen (the plot), Kanakapura, Hoskote]. */
  listings: [Pt, Pt, Pt];
  unit: number;
};

/** Grid extent in parcel units. */
const GRID = 10;
/**
 * Metres per grid unit. LandConnect deals in large parcels, so the chosen plot measures 120 acres
 * (about 825 m × 589 m); every figure in the story — its area and its four edges — agrees with
 * the drawing.
 */
export const METRES_PER_UNIT = 372.7;
/** Road runs along u, between these v values. */
const ROAD: [number, number] = [4.6, 5.3];
const BANDS: [number, number][] = [
  [0, 1.5],
  [1.5, 2.9],
  [2.9, ROAD[0]],
  [ROAD[1], 6.8],
  [6.8, 8.3],
  [8.3, GRID],
];
/** Field boundaries, inset from each cut so the ground reads between parcels. */
const GAP = 0.06;
const PLOT_TARGET: UV = { u: 6.3, v: 3.7 };
/** The two other matching listings: one up the hill, one across the road. */
const LISTING_TARGETS: UV[] = [
  { u: 2.6, v: 3.75 },
  { u: 6.3, v: 6.05 },
];
/** Parcels that show real ground: the three listings first, then two neighbours. Index = photo. */
const GROUND_TARGETS: UV[] = [PLOT_TARGET, LISTING_TARGETS[0], LISTING_TARGETS[1], { u: 5.8, v: 2.2 }, { u: 3.9, v: 6.05 }];
/** Ground photos are square; this is their pixel size. */
export const GROUND_PX = 512;
/**
 * Side tones for photo parcels, matched to each photo's average colour but built only from brand
 * tokens, so the extruded block still belongs to the illustration.
 */
const GROUND_TONES = [
  mix(mix(palette.amber, palette.mintSoft, 0.5), palette.forest, 0.2),
  mix(palette.amber, palette.forest, 0.7),
  mix(mix(palette.amber, palette.green, 0.4), palette.mintSoft, 0.3),
  mix(palette.amber, palette.forest, 0.45),
  mix(palette.amber, palette.forest, 0.82),
];
/** Photo order per target: the plot is a dry harvested field, Kanakapura a young plantation on red soil… */
const GROUND_PHOTO = [0, 1, 4, 2, 3];

const FIELD_TONES = [
  { fill: palette.mintSoft, weight: 0.3 },
  { fill: mix(palette.mintWash, palette.mintSoft, 0.4), weight: 0.18 },
  { fill: palette.mint, weight: 0.24 },
  { fill: mix(palette.mint, palette.green, 0.5), weight: 0.16 },
  { fill: palette.green, weight: 0.12 },
] as const;

function pickTone(r: number) {
  let acc = 0;
  for (const tone of FIELD_TONES) {
    acc += tone.weight;
    if (r <= acc) return tone.fill;
  }
  return FIELD_TONES[0].fill;
}

export function polygon(points: Pt[]) {
  const b = Skia.PathBuilder.Make();
  points.forEach((p, i) => (i === 0 ? b.moveTo(p.x, p.y) : b.lineTo(p.x, p.y)));
  b.close();
  return b.build();
}

/**
 * Builds the aerial patchwork once per canvas size. Everything here is static geometry;
 * animation only ever touches transforms, opacity and trim on top of it.
 */
export function buildLand(width: number, height: number): Land {
  const s = width * 0.135;
  const cos30 = 0.866;
  const ox = width / 2;
  const oy = height * 0.46 - (GRID / 2) * s;
  const lift = s * 0.09;

  const project = ({ u, v }: UV, raised = true): Pt => ({
    x: ox + (u - v) * s * cos30,
    y: oy + (u + v) * s * 0.5 - (raised ? lift : 0),
  });

  const rand = mulberry32(20261125);

  // 1. Partition each band into fields of varied width.
  type Cell = { u0: number; u1: number; v0: number; v1: number };
  const cells: Cell[] = [];
  for (const [v0, v1] of BANDS) {
    let u = 0;
    while (u < GRID - 0.01) {
      let w = 1.1 + rand() * 1.6;
      if (GRID - (u + w) < 0.8) w = GRID - u;
      cells.push({ u0: u, u1: u + w, v0, v1 });
      u += w;
    }
  }

  // 2. The surveyed plot is the field nearest the target point.
  let plotIndex = 0;
  let best = Infinity;
  cells.forEach((c, i) => {
    const du = (c.u0 + c.u1) / 2 - PLOT_TARGET.u;
    const dv = (c.v0 + c.v1) / 2 - PLOT_TARGET.v;
    const d = du * du + dv * dv;
    if (d < best) {
      best = d;
      plotIndex = i;
    }
  });
  const hc = cells[plotIndex];
  const hu = (hc.u0 + hc.u1) / 2;
  const hv = (hc.v0 + hc.v1) / 2;

  const nearest = (target: UV, taken: number[]) => {
    let pick = -1;
    let d0 = Infinity;
    cells.forEach((c, i) => {
      if (taken.includes(i)) return;
      const du = (c.u0 + c.u1) / 2 - target.u;
      const dv = (c.v0 + c.v1) / 2 - target.v;
      if (du * du + dv * dv < d0) {
        d0 = du * du + dv * dv;
        pick = i;
      }
    });
    return pick;
  };
  const groundCells: number[] = [plotIndex];
  GROUND_TARGETS.slice(1).forEach((t) => groundCells.push(nearest(t, groundCells)));
  const centreOf = (i: number) => {
    const c = cells[i];
    return project({ u: (c.u0 + c.u1) / 2, v: (c.v0 + c.v1) / 2 });
  };

  // Painter's order: back (small u+v) to front.
  const order = cells.map((c, i) => ({ c, i, depth: c.u1 + c.v1 })).sort((a, b) => a.depth - b.depth);

  const parcels: ParcelModel[] = order.map(({ c, i }) => {
    const A = { u: c.u0 + GAP, v: c.v0 + GAP };
    const B = { u: c.u1 - GAP, v: c.v0 + GAP };
    const C = { u: c.u1 - GAP, v: c.v1 - GAP };
    const D = { u: c.u0 + GAP, v: c.v1 - GAP };

    const fill = i === plotIndex ? palette.mintSoft : pickTone(rand());
    const dark = fill === palette.green || fill === FIELD_TONES[3].fill;
    const groundSlot = groundCells.indexOf(i);

    // Crop rows on roughly half the fields, alternating direction for a patchwork feel.
    let rows: SkPath | null = null;
    if (i !== plotIndex && rand() > 0.48) {
      const b = Skia.PathBuilder.Make();
      const alongU = rand() > 0.5;
      const span = alongU ? C.v - A.v : C.u - A.u;
      const count = Math.max(2, Math.floor(span / 0.26));
      for (let k = 1; k < count; k++) {
        const t = k / count;
        const p0 = alongU ? project({ u: A.u + 0.08, v: A.v + span * t }) : project({ u: A.u + span * t, v: A.v + 0.08 });
        const p1 = alongU ? project({ u: B.u - 0.08, v: A.v + span * t }) : project({ u: A.u + span * t, v: D.v - 0.08 });
        b.moveTo(p0.x, p0.y).lineTo(p1.x, p1.y);
      }
      rows = b.build();
    }

    const tA = project(A);
    const tB = project(B);
    const tC = project(C);
    const tD = project(D);
    const gB = project(B, false);
    const gC = project(C, false);
    const gD = project(D, false);

    const du = (c.u0 + c.u1) / 2 - hu;
    const dv = (c.v0 + c.v1) / 2 - hv;
    const photo = groundSlot >= 0 ? GROUND_PHOTO[groundSlot] : -1;
    const side = photo >= 0 ? GROUND_TONES[photo] : fill;

    return {
      key: `p${i}`,
      top: polygon([tA, tB, tC, tD]),
      left: polygon([tD, tC, gC, gD]),
      right: polygon([tC, tB, gB, gC]),
      rows: photo >= 0 ? null : rows,
      fill,
      leftFill: mix(side, palette.forest, 0.16),
      rightFill: mix(side, palette.forest, 0.3),
      rowColor: dark ? palette.white : palette.green,
      rowOpacity: dark ? 0.2 : 0.14,
      delay: 60 + Math.sqrt(du * du + dv * dv) * 85,
      ground: photo >= 0 ? { index: photo, matrix: groundMatrix(tA, tB, tD, B.u - A.u, D.v - A.v) } : null,
    };
  });

  const corners = [
    project({ u: hc.u0 + GAP, v: hc.v0 + GAP }),
    project({ u: hc.u1 - GAP, v: hc.v0 + GAP }),
    project({ u: hc.u1 - GAP, v: hc.v1 - GAP }),
    project({ u: hc.u0 + GAP, v: hc.v1 - GAP }),
  ];
  const lu = (hc.u1 - hc.u0 - GAP * 2) * METRES_PER_UNIT;
  const lv = (hc.v1 - hc.v0 - GAP * 2) * METRES_PER_UNIT;
  const xs = corners.map((c) => c.x);
  const ys = corners.map((c) => c.y);

  // Road: a ground-level band that runs past both edges of the grid.
  const road = polygon([
    project({ u: -2, v: ROAD[0] }, false),
    project({ u: GRID + 2, v: ROAD[0] }, false),
    project({ u: GRID + 2, v: ROAD[1] }, false),
    project({ u: -2, v: ROAD[1] }, false),
  ]);

  // A few trees along the road: just enough to give the land scale.
  const treeSpots: UV[] = [
    { u: 1.4, v: ROAD[0] - 0.12 },
    { u: 8.7, v: ROAD[0] - 0.12 },
    { u: 3.6, v: ROAD[1] + 0.14 },
    { u: 7.4, v: ROAD[1] + 0.14 },
    { u: 4.4, v: 7.0 },
  ];
  const trees = treeSpots.map((spot, i) => {
    const p = project(spot);
    return { key: `t${i}`, x: p.x, y: p.y, r: s * 0.12, delay: 520 + i * 70 };
  });

  return {
    parcels,
    trees,
    road,
    plot: {
      top: polygon(corners),
      corners,
      center: project({ u: hu, v: hv }),
      edges: [lu, lv, lu, lv],
      areaSqm: lu * lv,
      extent: { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) },
    },
    listings: [project({ u: hu, v: hv }), centreOf(groundCells[1]), centreOf(groundCells[2])],
    unit: s,
  };
}

/**
 * Maps a square ground photo onto a parcel's top face. The face is the projection of a u×v
 * rectangle, so the map is affine; the photo is centre-cropped to the field's proportions first
 * so it is never stretched.
 */
function groundMatrix(a: Pt, b: Pt, d: Pt, spanU: number, spanV: number) {
  const S = GROUND_PX;
  const w = spanU >= spanV ? S : (S * spanU) / spanV;
  const h = spanU >= spanV ? (S * spanV) / spanU : S;
  const x0 = (S - w) / 2;
  const y0 = (S - h) / 2;
  const m00 = (b.x - a.x) / w;
  const m01 = (d.x - a.x) / h;
  const m10 = (b.y - a.y) / w;
  const m11 = (d.y - a.y) / h;
  return Skia.Matrix([m00, m01, a.x - m00 * x0 - m01 * y0, m10, m11, a.y - m10 * x0 - m11 * y0, 0, 0, 1]);
}

/* ------------------------------------------------------------------ */
/* Camera                                                               */
/* ------------------------------------------------------------------ */

/** Screen = target + zoom · (world − focus). */
export type Camera = { tx: number; ty: number; z: number; fx: number; fy: number };

export function applyCamera(c: Camera, p: Pt): Pt {
  return { x: c.tx + c.z * (p.x - c.fx), y: c.ty + c.z * (p.y - c.fy) };
}

/** Camera for a fractional pager position. Zoom interpolates in log space so the push-in feels even. */
export function cameraAt(cams: Camera[], p: number): Camera {
  'worklet';
  const q = Math.min(2, Math.max(0, p));
  const i = Math.min(1, Math.floor(q));
  const t = q - i;
  const a = cams[i];
  const b = cams[i + 1];
  return {
    tx: a.tx + (b.tx - a.tx) * t,
    ty: a.ty + (b.ty - a.ty) * t,
    z: Math.exp(Math.log(a.z) + (Math.log(b.z) - Math.log(a.z)) * t),
    fx: a.fx + (b.fx - a.fx) * t,
    fy: a.fy + (b.fy - a.fy) * t,
  };
}

/** Room below the plot's bottom corner for the geotag capsule. */
const GEOTAG_SPACE = 40;
/** Fraction of the hero height where the land starts dissolving into the canvas under the copy. */
export const FADE_START = 0.6;
/** Keeps the plot clear of the screen edge. */
const EDGE_MARGIN = 20;

/* ------------------------------------------------------------------ */
/* Story layout: discovery by area, approval, a private call           */
/* ------------------------------------------------------------------ */

/**
 * Radius of each listing's approximate area, in land units: [chosen, Kanakapura, Hoskote]. Wide
 * enough that the circle never gives away the exact boundary.
 */
export const DISC_R = [1.55, 1.15, 1.0] as const;
/** Isometric ground circles are ellipses: y is squashed by this. */
export const ISO_Y = 0.577;
/** The in-call card on step 2 (and the identity chips it leaves behind on step 3). */
export const CALL_CARD = { h: 172, pad: 16, portrait: 56, portraitTop: 40 } as const;

/** Top of the call card, given the first y taken by the copy below the hero. */
export function callCardTop(bottom: number) {
  return bottom - 8 - CALL_CARD.h;
}

/**
 * One camera per step, all looking at the same land:
 * 0 — the wide field with three approximate areas; 1 — closer on the chosen plot, framed above
 * the call card; 2 — pushed in on the plot so its survey reads above the identity chips.
 * `top` is the first y below the brand row; `bottom` the first y taken by the copy.
 */
export function buildStoryCameras(land: Land, width: number, top: number, bottom: number): [Camera, Camera, Camera] {
  const { plot, unit } = land;
  const reach = Math.max(Math.max(...plot.corners.map((c) => c.x)) - plot.center.x, unit * DISC_R[0]);
  // Every area must clear the brand row; the highest one decides.
  const above = Math.max(...land.listings.map((l, i) => plot.center.y - l.y + unit * DISC_R[i] * ISO_Y));
  const wide: Camera = {
    tx: Math.min(plot.center.x, width - EDGE_MARGIN - reach),
    ty: Math.max(plot.center.y, top + 10 + above),
    z: 1,
    fx: plot.center.x,
    fy: plot.center.y,
  };

  const cardTop = callCardTop(bottom);
  const focusZoom = 1.15;
  const focus: Camera = { tx: width / 2, ty: (top + cardTop) / 2, z: focusZoom, fx: plot.center.x, fy: plot.center.y };

  // On step 3 the card has dissolved, leaving the two identity chips; the survey sits above them.
  const bandTop = top + 24;
  const bandBottom = cardTop + CALL_CARD.portraitTop - 12 - GEOTAG_SPACE;
  const zoom = Math.max(1, Math.min(2.4, (width * 0.58) / plot.extent.w, (bandBottom - bandTop) / plot.extent.h));
  const survey: Camera = { tx: width / 2, ty: (bandTop + bandBottom) / 2, z: zoom, fx: plot.center.x, fy: plot.center.y };
  return [wide, focus, survey];
}
