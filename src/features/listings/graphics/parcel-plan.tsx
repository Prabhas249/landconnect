import {
  BlurMask,
  Canvas,
  Circle,
  CornerPathEffect,
  DashPathEffect,
  Group,
  LinearGradient,
  Path,
  RoundedRect,
  Shadow,
  Skia,
  vec,
  type SkPath,
} from "@shopify/react-native-skia";
import { useMemo, type ComponentProps, type ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedReaction,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import Svg, { Path as SvgPath } from "react-native-svg";

import { groupIndian, polygonAcres, toAcres } from "@/lib/format";
import type { AreaUnit, LandType, LngLat } from "@/lib/types";
import { colors, font } from "@/theme/tokens";

import {
  edgeLengths,
  hasBoundary,
  openRing,
  projectMetres,
  rectangleForAcres,
  seeded,
  type Pt,
} from "../geometry";
import { useInView } from "../in-view";

export type ParcelPlanProps = {
  boundary: LngLat[] | null;
  areaValue: number;
  areaUnit: AreaUnit;
  landType?: LandType;
  /** Listing features; "Road access" / "Highway facing" draw a road, "Near water body" a pond. */
  features?: readonly string[];
  width: number;
  height?: number;
  /** Corner radius of the panel (match the host card's inner radius). */
  corner?: number;
  /** Stable seed (listing id) for the illustrated land patches. */
  seed?: string;
};

const GREEN = "#0F6E56";
const FOREST = "#0B5743";
const MINT = "#5DCAA5";
const AMBER = "#EF9F27";
const BLUE = "#3B6FD8";
/** Room around the parcel for the edge pills (a vertical edge's pill sits beside it). */
const PAD_X = 54;
const PAD_Y = 38;
const ROAD_BAND = 30;
const ROAD_W = 15;
const DRAW_MS = 1100;
const PILL_H = 22;
const COMPASS = 28;
const MAX_PILLS = 6;

type Rect = { x: number; y: number; w: number; h: number };

/** Road / water flags from the listing's features (exact option strings from `FEATURE_OPTIONS`). */
export function parcelContext(features: readonly string[] | undefined) {
  const f = new Set(features ?? []);
  const highway = f.has("Highway facing");
  return {
    road: highway || f.has("Road access"),
    roadLabel: highway ? "Highway" : "Access road",
    water: f.has("Near water body"),
  };
}

function overlaps(a: Rect, b: Rect, m = 4) {
  return (
    a.x < b.x + b.w + m &&
    b.x < a.x + a.w + m &&
    a.y < b.y + b.h + m &&
    b.y < a.y + a.h + m
  );
}

function ringPath(points: Pt[]): SkPath {
  const b = Skia.PathBuilder.Make();
  points.forEach((q, i) => (i === 0 ? b.moveTo(q.x, q.y) : b.lineTo(q.x, q.y)));
  b.close();
  return b.build();
}

function signedArea(points: Pt[]) {
  let a = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

function inside(pt: Pt, poly: Pt[]) {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (
      a.y > pt.y !== b.y > pt.y &&
      pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x
    )
      hit = !hit;
  }
  return hit;
}

function segmentsCross(a: Pt, b: Pt, c: Pt, d: Pt) {
  const o = (p: Pt, q: Pt, r: Pt) =>
    Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b);
}

/** Whether a label rect (grown by `m`) touches the polygon: overlap, containment either way, or a crossing edge. */
function rectHitsPolygon(r: Rect, poly: Pt[], m = 4) {
  const x0 = r.x - m;
  const y0 = r.y - m;
  const x1 = r.x + r.w + m;
  const y1 = r.y + r.h + m;
  const corners = [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
  if (poly.some((p) => p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1))
    return true;
  if (corners.some((c) => inside(c, poly))) return true;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    for (let k = 0; k < 4; k++) {
      if (segmentsCross(p, q, corners[k], corners[(k + 1) % 4])) return true;
    }
  }
  return false;
}

/** Shrinks a quad toward its centre so neighbouring patches keep a soft gap between them. */
function inset(quad: Pt[], by: number): Pt[] {
  const c = {
    x: quad.reduce((s, p) => s + p.x, 0) / quad.length,
    y: quad.reduce((s, p) => s + p.y, 0) / quad.length,
  };
  return quad.map((p) => {
    const dx = p.x - c.x;
    const dy = p.y - c.y;
    const d = Math.hypot(dx, dy) || 1;
    const k = Math.max(0, d - by) / d;
    return { x: c.x + dx * k, y: c.y + dy * k };
  });
}

function pondPath(cx: number, cy: number, r: number, rnd: () => number) {
  const n = 7;
  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const k = r * (0.82 + rnd() * 0.3);
    pts.push({ x: cx + Math.cos(a) * k * 1.25, y: cy + Math.sin(a) * k * 0.8 });
  }
  // Closed Catmull-Rom through the points, for an organic outline.
  const b = Skia.PathBuilder.Make();
  b.moveTo(pts[0].x, pts[0].y);
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];
    b.cubicTo(
      p1.x + (p2.x - p0.x) / 6,
      p1.y + (p2.y - p0.y) / 6,
      p2.x - (p3.x - p1.x) / 6,
      p2.y - (p3.y - p1.y) / 6,
      p2.x,
      p2.y,
    );
  }
  b.close();
  return b.build();
}

function metresText(m: number) {
  return m >= 1000 ? `${groupIndian(m / 1000, 2)} km` : `${groupIndian(m)} m`;
}

/**
 * The parcel drawn to scale as an illustrated survey card: a mint-to-white panel with soft land
 * patches, a pale access road (and pond, or a few trees) only when the listing says so, the parcel
 * as a soft green shape with an inner shadow and a crisp forest outline that traces itself in when
 * the card scrolls into view, white corner stakes, edge lengths as white pills outside the edges
 * (placed so they never touch the shape or each other) and a small compass. The area itself is read
 * out below the drawing by the host card. When the owner traced a boundary and the declared area
 * differs, the declared area is drawn as a dashed amber ring of the same shape for comparison.
 */
export function ParcelPlan({
  boundary,
  areaValue,
  areaUnit,
  landType,
  features,
  width,
  height = 236,
  corner = 18,
  seed,
}: ParcelPlanProps) {
  const { ref, seen, onLayout, reduced } = useInView(0.8);
  const traced = hasBoundary(boundary);
  const declaredAcres = toAcres(areaValue, areaUnit);
  const ctx = parcelContext(features);
  const trees = landType === "farmhouse";

  const model = useMemo(() => {
    const ring = traced ? openRing(boundary) : null;
    const tracedAcres = ring ? polygonAcres(ring) : 0;
    const metres = ring ? projectMetres(ring) : rectangleForAcres(declaredAcres);
    const lengths = edgeLengths(metres);
    const rnd = seeded(seed ?? `${areaValue}${areaUnit}${width}`);

    // Declared ring: the same shape scaled to the declared area, only when it differs noticeably.
    let declaredM: Pt[] | null = null;
    if (
      ring &&
      tracedAcres > 0 &&
      declaredAcres > 0 &&
      Math.abs(declaredAcres / tracedAcres - 1) > 0.03
    ) {
      const c = {
        x: metres.reduce((s, p) => s + p.x, 0) / metres.length,
        y: metres.reduce((s, p) => s + p.y, 0) / metres.length,
      };
      const k = Math.sqrt(declaredAcres / tracedAcres);
      declaredM = metres.map((p) => ({
        x: c.x + (p.x - c.x) * k,
        y: c.y + (p.y - c.y) * k,
      }));
    }

    // Fit the union of both rings into the drawing area (above the road band when there is one),
    // with room on every side for the edge pills. Any shape keeps its aspect and is centred.
    const roadBand = ctx.road ? ROAD_BAND : 0;
    const area = {
      x: PAD_X,
      y: PAD_Y,
      w: width - PAD_X * 2,
      h: height - PAD_Y * 2 - roadBand,
    };
    const all = declaredM ? [...metres, ...declaredM] : metres;
    const minX = Math.min(...all.map((p) => p.x));
    const maxX = Math.max(...all.map((p) => p.x));
    const minY = Math.min(...all.map((p) => p.y));
    const maxY = Math.max(...all.map((p) => p.y));
    const bw = maxX - minX || 1;
    const bh = maxY - minY || 1;
    const scale = Math.min(area.w / bw, area.h / bh);
    const ox = area.x + (area.w - bw * scale) / 2;
    const oy = area.y + (area.h - bh * scale) / 2;
    const map = (p: Pt) => ({
      x: ox + (p.x - minX) * scale,
      y: oy + (p.y - minY) * scale,
    });
    const points = metres.map(map);
    const declared = declaredM ? declaredM.map(map) : null;
    const box = { x: ox, y: oy, w: bw * scale, h: bh * scale };

    // Where the trace reaches each vertex and each edge midpoint (0..1 of the perimeter).
    const screenLen = edgeLengths(points);
    const perim = screenLen.reduce((s, l) => s + l, 0) || 1;
    const vertexAt: number[] = [];
    const midAt: number[] = [];
    let run = 0;
    for (let i = 0; i < points.length; i++) {
      vertexAt.push(run / perim);
      midAt.push((run + screenLen[i] / 2) / perim);
      run += screenLen[i];
    }

    // Road: a pale lane through the band under the parcel, its label on the freer side.
    const roadY = height - roadBand / 2 - 8;
    let roadLabel: Rect | null = null;
    if (ctx.road) {
      const lw = ctx.roadLabel.length * 5.6 + 16;
      const left = box.x;
      const right = width - (box.x + box.w);
      const x = right >= left ? width - lw - 16 : 16;
      roadLabel = { x, y: roadY - 8, w: lw, h: 16 };
    }

    // Labels: compass and road label first, then edges longest-first wherever they fit cleanly.
    const compass: Rect = { x: width - COMPASS - 10, y: 10, w: COMPASS, h: COMPASS };
    const taken: Rect[] = [compass];
    if (roadLabel) taken.push(roadLabel);
    const polys = declared ? [points, declared] : [points];
    const orient = Math.sign(signedArea(points)) || 1;
    const candidates = points
      .map((p, i) => ({ i, p, q: points[(i + 1) % points.length], len: screenLen[i] }))
      .filter((e) => e.len >= 30 && (ring ? true : e.i < 2))
      .sort((a, b) => b.len - a.len);
    const edges: { key: string; text: string; rect: Rect; at: number }[] = [];
    for (const e of candidates) {
      if (edges.length >= MAX_PILLS) break;
      const dx = e.q.x - e.p.x;
      const dy = e.q.y - e.p.y;
      const n = Math.hypot(dx, dy) || 1;
      // Outward normal from the ring's winding, so concave (L-shaped) edges label the right side.
      const nx = (orient * dy) / n;
      const ny = (orient * -dx) / n;
      const text = `${ring ? "" : "≈ "}${metresText(lengths[e.i])}`;
      const w = text.length * 6.3 + 18;
      const d = (w / 2) * Math.abs(nx) + (PILL_H / 2) * Math.abs(ny) + 7;
      for (const t of [0.5, 0.36, 0.64]) {
        const cx = e.p.x + dx * t + nx * d;
        const cy = e.p.y + dy * t + ny * d;
        const rect: Rect = { x: cx - w / 2, y: cy - PILL_H / 2, w, h: PILL_H };
        if (
          rect.x < 6 ||
          rect.y < 6 ||
          rect.x + rect.w > width - 6 ||
          rect.y + rect.h > height - 6
        )
          continue;
        if (taken.some((r) => overlaps(r, rect))) continue;
        if (polys.some((poly) => rectHitsPolygon(rect, poly, 3))) continue;
        taken.push(rect);
        edges.push({ key: `e${e.i}`, text, rect, at: midAt[e.i] });
        break;
      }
    }

    // Free corners (clear of the parcel, its labels and the road) for the pond and trees.
    const keepOut = { x: box.x - 8, y: box.y - 8, w: box.w + 16, h: box.h + 16 };
    const corners = (s: number): Rect[] =>
      [
        { x: 12, y: 12, w: s * 1.5, h: s },
        { x: 12, y: height - roadBand - s - 14, w: s * 1.5, h: s },
        { x: width - s * 1.5 - 12, y: height - roadBand - s - 14, w: s * 1.5, h: s },
        { x: width - s * 1.5 - COMPASS - 20, y: 12, w: s * 1.5, h: s },
      ].filter(
        (r) =>
          !overlaps(r, keepOut, 0) &&
          !taken.some((t) => overlaps(t, r, 2)) &&
          !rectHitsPolygon(r, points, 4),
      );
    let pond: SkPath | null = null;
    let pondRect: Rect | null = null;
    if (ctx.water) {
      const spot = corners(30)[0];
      if (spot) {
        pondRect = spot;
        pond = pondPath(spot.x + spot.w / 2, spot.y + spot.h / 2, spot.h / 2, rnd);
      }
    }
    const treeDots: { x: number; y: number; r: number }[] = [];
    if (trees) {
      const spot = corners(24).find((r) => !pondRect || !overlaps(r, pondRect, 4));
      if (spot) {
        const r0 = 7;
        treeDots.push(
          { x: spot.x + r0 + 2, y: spot.y + spot.h - r0, r: r0 },
          { x: spot.x + r0 * 2.4, y: spot.y + r0 + 1, r: r0 * 0.85 },
          { x: spot.x + r0 * 3.7, y: spot.y + spot.h - r0 - 1, r: r0 * 0.75 },
        );
      }
    }

    // Soft land patches: a jittered field grid with rounded, inset cells in a few mint tints.
    const cw = 70;
    const ch = 56;
    const cols = Math.ceil(width / cw) + 1;
    const rows = Math.ceil(height / ch) + 1;
    const vtx: Pt[][] = [];
    for (let i = 0; i <= cols; i++) {
      vtx.push([]);
      for (let j = 0; j <= rows; j++) {
        vtx[i].push({
          x: (i - 0.5) * cw + (rnd() - 0.5) * cw * 0.4,
          y: (j - 0.5) * ch + (rnd() - 0.5) * ch * 0.4,
        });
      }
    }
    const patchB = [Skia.PathBuilder.Make(), Skia.PathBuilder.Make(), Skia.PathBuilder.Make()];
    const near = { x: box.x - 16, y: box.y - 16, w: box.w + 32, h: box.h + 32 };
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        const quad = [vtx[i][j], vtx[i + 1][j], vtx[i + 1][j + 1], vtx[i][j + 1]];
        const qx = Math.min(...quad.map((p) => p.x));
        const qy = Math.min(...quad.map((p) => p.y));
        const cell = {
          x: qx,
          y: qy,
          w: Math.max(...quad.map((p) => p.x)) - qx,
          h: Math.max(...quad.map((p) => p.y)) - qy,
        };
        const roll = rnd();
        if (overlaps(cell, near, 0) || roll < 0.22) continue;
        patchB[Math.floor(rnd() * 3)].addPath(ringPath(inset(quad, 4)));
      }
    }

    let road: SkPath | null = null;
    if (ctx.road) {
      const b = Skia.PathBuilder.Make();
      b.moveTo(-12, roadY + 3);
      b.cubicTo(width * 0.32, roadY - 5, width * 0.66, roadY + 5, width + 12, roadY - 2);
      road = b.build();
    }

    return {
      ring: !!ring,
      points,
      path: ringPath(points),
      declaredPath: declared ? ringPath(declared) : null,
      box,
      vertexAt,
      edges,
      patches: patchB.map((b) => b.build()),
      road,
      roadLabel,
      pond,
      treeDots,
      acresShown: ring ? tracedAcres : declaredAcres,
    };
  }, [
    traced,
    boundary,
    declaredAcres,
    width,
    height,
    seed,
    areaValue,
    areaUnit,
    ctx.road,
    ctx.roadLabel,
    ctx.water,
    trees,
  ]);

  const draw = useSharedValue(reduced ? 1 : 0);
  useAnimatedReaction(
    () => seen.get(),
    (now, prev) => {
      if (now === 1 && prev !== 1) {
        draw.set(
          reduced
            ? 1
            : withTiming(1, { duration: DRAW_MS, easing: Easing.inOut(Easing.cubic) }),
        );
      }
    },
    [reduced],
  );
  const fillOpacity = useDerivedValue(() =>
    Math.min(1, Math.max(0, (draw.get() - 0.3) / 0.5)),
  );
  const declaredOpacity = useDerivedValue(() =>
    Math.min(1, Math.max(0, (draw.get() - 0.7) / 0.3)),
  );

  const { box } = model;
  const clip = Skia.RRectXY(Skia.XYWHRect(0, 0, width, height), corner, corner);
  const a11y = `Parcel drawing, ${groupIndian(model.acresShown, 2)} acres${
    ctx.road ? `, ${ctx.roadLabel.toLowerCase()} alongside` : ""
  }${ctx.water ? ", water body nearby" : ""}`;

  return (
    <Animated.View
      ref={ref}
      onLayout={onLayout}
      accessible
      accessibilityLabel={a11y}
      style={[styles.panel, { width, height, borderRadius: corner }]}
    >
      <Canvas style={{ width, height }}>
        <Group clip={clip}>
          <RoundedRect x={0} y={0} width={width} height={height} r={corner}>
            <LinearGradient
              start={vec(0, 0)}
              end={vec(width * 0.35, height)}
              colors={["#E3F3EA", "#F1F9F5", "#FFFFFF"]}
              positions={[0, 0.55, 1]}
            />
          </RoundedRect>
          {/* Two airy light pools, for depth without lines. */}
          <Circle cx={width * 0.12} cy={height * 0.18} r={70} color={MINT} opacity={0.12}>
            <BlurMask blur={36} style="normal" />
          </Circle>
          <Circle cx={width * 0.9} cy={height * 0.85} r={80} color="#FFFFFF" opacity={0.9}>
            <BlurMask blur={40} style="normal" />
          </Circle>

          <Path path={model.patches[0]} color={MINT} opacity={0.1}>
            <CornerPathEffect r={12} />
          </Path>
          <Path path={model.patches[1]} color={MINT} opacity={0.16}>
            <CornerPathEffect r={12} />
          </Path>
          <Path path={model.patches[2]} color={GREEN} opacity={0.06}>
            <CornerPathEffect r={12} />
          </Path>

          {model.road ? (
            <Group>
              <Path
                path={model.road}
                style="stroke"
                strokeWidth={ROAD_W + 4}
                strokeCap="round"
                color={colors.ink}
                opacity={0.05}
              >
                <BlurMask blur={3} style="normal" />
              </Path>
              <Path
                path={model.road}
                style="stroke"
                strokeWidth={ROAD_W}
                strokeCap="round"
                color="#FFFFFF"
              />
            </Group>
          ) : null}

          {model.pond ? (
            <Group>
              <Path path={model.pond} color={BLUE} opacity={0.16} />
              <Path path={model.pond} color="#FFFFFF" opacity={0.5}>
                <BlurMask blur={6} style="inner" />
              </Path>
            </Group>
          ) : null}

          {model.treeDots.map((t, i) => (
            <Group key={`t${i}`}>
              <Circle cx={t.x + 1} cy={t.y + 2} r={t.r} color={GREEN} opacity={0.12} />
              <Circle cx={t.x} cy={t.y} r={t.r} color={MINT} opacity={0.75} />
              <Circle cx={t.x - t.r * 0.3} cy={t.y - t.r * 0.3} r={t.r * 0.45} color="#FFFFFF" opacity={0.35} />
            </Group>
          ))}
        </Group>

        {/* Parcel: soft drop shadow, a soft-green fill with an inner shadow, then the outline. */}
        <Group opacity={fillOpacity}>
          <Path path={model.path} color="#FFFFFF">
            <Shadow dx={0} dy={6} blur={12} color="rgba(15,110,86,0.20)" shadowOnly />
          </Path>
          <Path path={model.path}>
            <LinearGradient
              start={vec(box.x, box.y)}
              end={vec(box.x + box.w, box.y + box.h)}
              colors={["#BFE9D6", "#A3DDC4"]}
            />
            <Shadow dx={0} dy={2} blur={7} color="rgba(11,87,67,0.30)" inner />
          </Path>
        </Group>
        {model.declaredPath ? (
          <Path
            path={model.declaredPath}
            style="stroke"
            strokeWidth={1.6}
            strokeJoin="round"
            color={AMBER}
            opacity={declaredOpacity}
          >
            <DashPathEffect intervals={[6, 5]} />
          </Path>
        ) : null}
        <Path
          path={model.path}
          style="stroke"
          strokeWidth={2}
          strokeJoin="round"
          strokeCap="round"
          color={FOREST}
          start={0}
          end={draw}
        >
          {model.ring ? null : <DashPathEffect intervals={[7, 5]} />}
        </Path>
        {model.ring
          ? model.points.map((p, i) => (
              <Stake key={`s${i}`} x={p.x} y={p.y} at={model.vertexAt[i]} draw={draw} />
            ))
          : null}
      </Canvas>

      {model.roadLabel ? (
        <View
          pointerEvents="none"
          style={[
            styles.roadLabel,
            { left: model.roadLabel.x, top: model.roadLabel.y, width: model.roadLabel.w },
          ]}
        >
          <Text style={styles.roadText} numberOfLines={1}>
            {ctx.roadLabel.toUpperCase()}
          </Text>
        </View>
      ) : null}

      {model.edges.map((e) => (
        <Reveal
          key={e.key}
          draw={draw}
          at={e.at}
          style={[styles.edgePill, { left: e.rect.x, top: e.rect.y, width: e.rect.w }]}
        >
          <Text style={styles.edgeText} numberOfLines={1}>
            {e.text}
          </Text>
        </Reveal>
      ))}

      <View pointerEvents="none" style={[styles.compass, { left: width - COMPASS - 10, top: 10 }]}>
        <Svg width={10} height={12} viewBox="0 0 12 14">
          <SvgPath d="M6 0 L11.5 13 L6 10 Z" fill={colors.ink} />
          <SvgPath d="M6 0 L0.5 13 L6 10 Z" fill={colors.inkTertiary} />
        </Svg>
        <Text style={styles.compassText}>N</Text>
      </View>
    </Animated.View>
  );
}

/** A corner stake: a small white dot with a green ring, fading in as the trace reaches it. */
function Stake({ x, y, at, draw }: { x: number; y: number; at: number; draw: SharedValue<number> }) {
  const t = useDerivedValue(() => Math.min(1, Math.max(0, (draw.get() - at) / 0.08)));
  const r = useDerivedValue(() => 3.2 + 1.3 * t.get());
  return (
    <Group opacity={t}>
      <Circle cx={x} cy={y + 1} r={r} color="rgba(16,32,28,0.16)">
        <BlurMask blur={1.5} style="normal" />
      </Circle>
      <Circle cx={x} cy={y} r={r} color="#FFFFFF" />
      <Circle cx={x} cy={y} r={r} style="stroke" strokeWidth={1.8} color={GREEN} />
    </Group>
  );
}

/** Edge pill entrance: fades and settles 4pt toward its edge once the trace passes it (no overshoot). */
function Reveal({
  draw,
  at,
  style,
  children,
}: {
  draw: SharedValue<number>;
  at: number;
  style: ComponentProps<typeof Animated.View>["style"];
  children: ReactNode;
}) {
  const anim = useAnimatedStyle(() => {
    const t = Math.min(1, Math.max(0, (draw.get() - at) / 0.16));
    const e = 1 - (1 - t) * (1 - t) * (1 - t);
    return { opacity: e, transform: [{ translateY: 4 * (1 - e) }] };
  });
  return (
    <Animated.View pointerEvents="none" style={[style, anim]}>
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  panel: {
    overflow: "hidden",
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: "rgba(16,32,28,0.05)",
  },
  edgePill: {
    position: "absolute",
    height: PILL_H,
    borderRadius: PILL_H / 2,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(16,32,28,0.05)",
    boxShadow: "0 3px 10px rgba(16,32,28,0.10)",
  },
  edgeText: {
    fontFamily: font.mono,
    fontSize: 10.5,
    color: colors.ink,
    fontVariant: ["tabular-nums"],
  },
  roadLabel: { position: "absolute", height: 16, alignItems: "center", justifyContent: "center" },
  roadText: {
    fontFamily: font.mono,
    fontSize: 8.5,
    letterSpacing: 0.9,
    color: colors.inkTertiary,
  },
  compass: {
    position: "absolute",
    width: COMPASS,
    height: COMPASS,
    borderRadius: COMPASS / 2,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(16,32,28,0.05)",
    boxShadow: "0 2px 8px rgba(16,32,28,0.08)",
  },
  compassText: {
    fontFamily: font.monoBold,
    fontSize: 7,
    lineHeight: 8,
    color: colors.ink,
    marginTop: 1,
  },
});
