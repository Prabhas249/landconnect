import {
  Canvas,
  DashPathEffect,
  Group,
  LinearGradient,
  Path,
  Rect,
  Skia,
  vec,
  type Transforms3d,
} from '@shopify/react-native-skia';
import { CloudOff } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  useDerivedValue,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { Button } from '@/ui/button';
import { Text } from '@/ui/text';
import { colors, gutter, palette, radius, shadow, space } from '@/theme/tokens';

import { withAlpha } from './map-style';

const MINOR = 24;
const MAJOR = MINOR * 4;

/** Deterministic quadrilaterals so the sketch is identical on every launch. */
function sketchParcels(w: number, h: number) {
  let seed = 7;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const path = Skia.PathBuilder.Make();
  const count = Math.max(3, Math.round((w * h) / 90_000));
  for (let i = 0; i < count; i++) {
    const cx = rand() * w;
    const cy = rand() * h;
    const s = 30 + rand() * 46;
    path.moveTo(cx - s * (0.8 + rand() * 0.3), cy - s * (0.5 + rand() * 0.3));
    path.lineTo(cx + s * (0.7 + rand() * 0.4), cy - s * (0.6 + rand() * 0.3));
    path.lineTo(cx + s * (0.8 + rand() * 0.3), cy + s * (0.5 + rand() * 0.4));
    path.lineTo(cx - s * (0.6 + rand() * 0.3), cy + s * (0.6 + rand() * 0.3));
    path.close();
  }
  return path.detach();
}

function grid(w: number, h: number, step: number) {
  const path = Skia.PathBuilder.Make();
  for (let x = step; x < w; x += step) {
    path.moveTo(x, 0);
    path.lineTo(x, h);
  }
  for (let y = step; y < h; y += step) {
    path.moveTo(0, y);
    path.lineTo(w, y);
  }
  return path.detach();
}

/** Survey crosses at every major intersection, like the ticks on a village map sheet. */
function ticks(w: number, h: number) {
  const path = Skia.PathBuilder.Make();
  const t = 4;
  for (let x = MAJOR; x < w; x += MAJOR) {
    for (let y = MAJOR; y < h; y += MAJOR) {
      path.moveTo(x - t, y);
      path.lineTo(x + t, y);
      path.moveTo(x, y - t);
      path.lineTo(x, y + t);
    }
  }
  return path.detach();
}

function SurveyGrid({ width, height }: { width: number; height: number }) {
  const reduced = useReducedMotion();
  const sweep = useSharedValue(0);

  useEffect(() => {
    if (reduced) return;
    sweep.set(withRepeat(withTiming(1, { duration: 1700, easing: Easing.inOut(Easing.quad) }), -1, false));
  }, [sweep, reduced]);

  const paths = useMemo(
    () => ({
      minor: grid(width, height, MINOR),
      major: grid(width, height, MAJOR),
      ticks: ticks(width, height),
      parcels: sketchParcels(width, height),
    }),
    [width, height],
  );

  const band = Math.max(160, width * 0.55);
  const transform = useDerivedValue<Transforms3d>(() => [{ translateX: -band + sweep.get() * (width + band * 2) }]);

  return (
    <Canvas style={StyleSheet.absoluteFill}>
      <Rect x={0} y={0} width={width} height={height} color={colors.canvas} />
      <Path
        path={paths.minor}
        style="stroke"
        strokeWidth={StyleSheet.hairlineWidth}
        color={withAlpha(palette.forest, 0.05)}
      />
      <Path path={paths.major} style="stroke" strokeWidth={1} color={withAlpha(palette.green, 0.08)} />
      <Path path={paths.ticks} style="stroke" strokeWidth={1.4} color={withAlpha(palette.green, 0.22)} />
      <Path path={paths.parcels} color={withAlpha(palette.mint, 0.07)} />
      <Path path={paths.parcels} style="stroke" strokeWidth={1.2} color={withAlpha(palette.green, 0.2)}>
        <DashPathEffect intervals={[6, 5]} />
      </Path>
      <Group transform={transform}>
        <Rect x={0} y={0} width={band} height={height}>
          <LinearGradient
            start={vec(0, 0)}
            end={vec(band, height * 0.18)}
            colors={[withAlpha(colors.canvas, 0), withAlpha(palette.white, 0.75), withAlpha(colors.canvas, 0)]}
          />
        </Rect>
      </Group>
    </Canvas>
  );
}

export type MapSkeletonProps = {
  status: 'loading' | 'ready' | 'failed';
  onRetry?: () => void;
  /** Small embedded maps get a one-line failure label instead of a card. */
  compact?: boolean;
};

/**
 * Designed loading for maps: a survey sheet (grid, ticks, sketched parcels) with a slow shimmer,
 * dissolving once tiles have drawn. When tiles fail it stays and explains, with a retry.
 */
export function MapSkeleton({ status, onRetry, compact }: MapSkeletonProps) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize((s) => (s && s.w === width && s.h === height ? s : { w: width, h: height }));
  };

  if (status === 'ready') return null;

  return (
    <Animated.View
      exiting={FadeOut.duration(420)}
      onLayout={onLayout}
      pointerEvents={status === 'failed' ? 'box-none' : 'none'}
      style={StyleSheet.absoluteFill}>
      {size ? <SurveyGrid width={size.w} height={size.h} /> : null}
      {status === 'failed' ? (
        compact ? (
          <Animated.View entering={FadeIn.duration(220)} style={styles.compactWrap}>
            <View style={styles.compact}>
              <CloudOff size={14} color={colors.inkSecondary} strokeWidth={2.1} />
              <Text variant="captionStrong" tone="secondary">
                Map unavailable offline
              </Text>
            </View>
          </Animated.View>
        ) : (
          <Animated.View entering={FadeIn.duration(220)} pointerEvents="box-none" style={styles.center}>
            <View style={styles.card}>
              <View style={styles.badge}>
                <CloudOff size={20} color={colors.accent} strokeWidth={2.1} />
              </View>
              <Text variant="bodyStrong" center>
                Map tiles did not load
              </Text>
              <Text variant="caption" tone="secondary" center>
                Check your connection. Listings and search still work while the map is away.
              </Text>
              {onRetry ? <Button label="Try again" variant="soft" size="sm" block={false} onPress={onRetry} /> : null}
            </View>
          </Animated.View>
        )
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  center: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', padding: gutter },
  card: {
    alignItems: 'center',
    gap: space[2],
    maxWidth: 320,
    padding: space[5],
    borderRadius: radius.xl,
    borderCurve: 'continuous',
    backgroundColor: colors.surface,
    boxShadow: shadow.float,
  },
  badge: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space[1],
  },
  compactWrap: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  compact: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    height: 32,
    paddingHorizontal: space[3],
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    boxShadow: shadow.card,
  },
});
