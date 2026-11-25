import { useEffect } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import Svg, { Circle, G, Path } from 'react-native-svg';

import type { LandType } from '@/lib/types';

import { genericPlot, polygonPath, seeded, smoothClosedPath, type Pt } from '../geometry';
import { LAND_TINT } from '../meta';

const W = 400;
const H = 300;

type Hill = { rings: { d: string; index: boolean; opacity: number }[] };

/** Generates a deterministic topographic map: two or three hills of noisy concentric contours. */
function buildTerrain(seed: string) {
  const rand = seeded(seed);
  const hills: Hill[] = [];
  const count = 2 + Math.floor(rand() * 2);
  for (let h = 0; h < count; h++) {
    const cx = W * (0.15 + rand() * 0.7);
    const cy = H * (0.15 + rand() * 0.7);
    const ringCount = 7 + Math.floor(rand() * 4);
    const step = 16 + rand() * 10;
    const phase = [rand() * 6.28, rand() * 6.28, rand() * 6.28];
    const amp = [0.12 + rand() * 0.12, 0.05 + rand() * 0.08, 0.03 + rand() * 0.04];
    const rings: Hill['rings'] = [];
    for (let k = 0; k < ringCount; k++) {
      const r = 10 + k * step;
      const pts: Pt[] = [];
      for (let i = 0; i < 40; i++) {
        const t = (i / 40) * Math.PI * 2;
        // Noise grows outward so inner rings stay round and outer ones wander like real terrain.
        const wobble =
          1 +
          (amp[0] * Math.sin(2 * t + phase[0]) + amp[1] * Math.sin(3 * t + phase[1]) + amp[2] * Math.sin(5 * t + phase[2])) *
            (0.5 + k / ringCount);
        pts.push({ x: cx + Math.cos(t) * r * wobble * 1.25, y: cy + Math.sin(t) * r * wobble });
      }
      rings.push({ d: smoothClosedPath(pts), index: k % 4 === 3, opacity: 0.34 - (k / ringCount) * 0.2 });
    }
    hills.push({ rings });
  }

  const plot = genericPlot(seed).map((p) => ({ x: W * (0.32 + p.x * 0.36), y: H * (0.3 + p.y * 0.4) }));
  return { hills, plot: polygonPath(plot), pin: plot[0] };
}

export type ContourArtProps = {
  seed: string;
  landType: LandType;
  /** Slow drift — reserve for heroes; feed cards stay still to keep scrolling cheap. */
  animated?: boolean;
  /** Draw the dashed sample plot in the middle. */
  plot?: boolean;
  style?: StyleProp<ViewStyle>;
};

/** Designed placeholder for listings without photos: a topographic survey sheet tinted by land type. */
export function ContourArt({ seed, landType, animated, plot = true, style }: ContourArtProps) {
  const tint = LAND_TINT[landType];
  const terrain = buildTerrain(seed);

  const drift = useSharedValue(0);
  useEffect(() => {
    if (!animated) return;
    drift.set(withRepeat(withTiming(1, { duration: 9000, easing: Easing.inOut(Easing.sin) }), -1, true));
  }, [animated, drift]);

  const driftStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1.04 + drift.get() * 0.05 }, { translateX: drift.get() * -8 }],
  }));

  return (
    <View style={[styles.wrap, { backgroundColor: tint.wash }, style]}>
      <Animated.View style={[StyleSheet.absoluteFill, driftStyle]}>
        <Svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice">
          <G opacity={0.5}>
            {Array.from({ length: 9 }, (_, i) =>
              Array.from({ length: 7 }, (__, j) => (
                <Circle key={`${i}-${j}`} cx={20 + i * 45} cy={15 + j * 45} r={1.2} fill={tint.base} opacity={0.35} />
              )),
            )}
          </G>
          {terrain.hills.map((hill, h) => (
            <G key={h}>
              {hill.rings.map((ring, k) => (
                <Path
                  key={k}
                  d={ring.d}
                  fill="none"
                  stroke={tint.base}
                  strokeOpacity={ring.opacity}
                  strokeWidth={ring.index ? 1.6 : 0.9}
                />
              ))}
            </G>
          ))}
          {plot ? (
            <G>
              <Path
                d={terrain.plot}
                fill={tint.base}
                fillOpacity={0.1}
                stroke={tint.base}
                strokeWidth={1.8}
                strokeDasharray="6 5"
                strokeLinejoin="round"
              />
              <Circle cx={terrain.pin.x} cy={terrain.pin.y} r={9} fill={tint.base} opacity={0.16} />
              <Circle cx={terrain.pin.x} cy={terrain.pin.y} r={4} fill={tint.base} />
            </G>
          ) : null}
        </Svg>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { overflow: 'hidden' },
});
