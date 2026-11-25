import Svg, { Circle, Path } from 'react-native-svg';

import type { LandType, LngLat } from '@/lib/types';

import { fitToBox, genericPlot, hasBoundary, openRing, polygonPath, projectMetres } from '../geometry';

export type ParcelGlyphProps = {
  boundary: LngLat[] | null;
  seed: string;
  /** Kept for callers; the glyph uses the same green language as the detail survey plan. */
  landType?: LandType;
  size?: number;
};

const FOREST = '#0B5743';
const GREEN = '#0F6E56';

/**
 * Tiny version of the detail page's survey plan: the parcel's real shape as a soft-green fill with
 * a forest outline and white corner stakes (or a dashed generic plot when no boundary is traced).
 */
export function ParcelGlyph({ boundary, seed, size = 30 }: ParcelGlyphProps) {
  const traced = hasBoundary(boundary);
  const raw = traced ? projectMetres(openRing(boundary)) : genericPlot(seed);
  const { points } = fitToBox(raw, size, size, 4);

  return (
    <Svg width={size} height={size}>
      <Path
        d={polygonPath(points)}
        fill="#A9DFC7"
        stroke={FOREST}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeDasharray={traced ? undefined : '2.5 2'}
      />
      {traced && points.length <= 10
        ? points.map((p, i) => (
            <Circle key={i} cx={p.x} cy={p.y} r={1.9} fill="#FFFFFF" stroke={GREEN} strokeWidth={1.1} />
          ))
        : null}
    </Svg>
  );
}
