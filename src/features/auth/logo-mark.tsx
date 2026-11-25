import { Poppins_600SemiBold } from '@expo-google-fonts/poppins/600SemiBold';
import { useFonts } from 'expo-font';
import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSpring,
  type SharedValue,
} from 'react-native-reanimated';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

import { palette, spring } from '@/theme/tokens';

/*
 * Geometry copied verbatim from landconnect.si (no reinterpretation):
 * - TILE_* from https://www.landconnect.si/icon.svg (the app-icon form, on a forest tile)
 * - BARE_* from the site header's inline <svg aria-label="LandConnect logo"> (the mark on a light ground)
 * Two parcels slope toward a shared centre; the amber survey point with its dark core sits between them.
 */
const TILE = {
  left: 'M6 32 L19 24 L19 39 L6 39 Z',
  right: 'M42 32 L29 24 L29 39 L42 39 Z',
  radius: 10,
} as const;
const BARE = {
  left: 'M4 30 L18 22 L18 38 L4 38 Z',
  right: 'M44 30 L30 22 L30 38 L44 38 Z',
} as const;

export type LogoMarkProps = {
  size?: number;
  /** `true` (default): the app-icon form on a forest tile. `false`: the bare mark, as in the site header. */
  tile?: boolean;
  /** Assemble on mount: tile, then the two parcels rise, then the survey point settles. */
  animate?: boolean;
  /** Extra delay before the entrance (ms). */
  delay?: number;
};

export function LogoMark({ size = 40, tile = true, animate = false, delay = 0 }: LogoMarkProps) {
  const reduced = useReducedMotion();
  if (!animate || reduced) {
    return (
      <Svg width={size} height={size} viewBox="0 0 48 48" accessibilityRole="image" accessibilityLabel="LandConnect">
        <Layers tile={tile} part="all" />
      </Svg>
    );
  }
  return <AssemblingMark size={size} tile={tile} delay={delay} />;
}

type Part = 'all' | 'tile' | 'left' | 'right' | 'point';

function Layers({ tile, part }: { tile: boolean; part: Part }) {
  const g = tile ? TILE : BARE;
  const show = (p: Part) => part === 'all' || part === p;
  return (
    <>
      {tile && show('tile') ? <Rect x={0} y={0} width={48} height={48} rx={TILE.radius} fill={palette.forest} /> : null}
      {show('left') ? <Path d={g.left} fill={palette.green} /> : null}
      {show('right') ? <Path d={g.right} fill={palette.mint} /> : null}
      {show('point') ? (
        <>
          <Circle cx={24} cy={24} r={5.5} fill={palette.amber} />
          <Circle cx={24} cy={24} r={2} fill={palette.forest} />
        </>
      ) : null}
    </>
  );
}

/** Each layer is its own SVG under an animated view, so the entrance is pure transform + opacity. */
function AssemblingMark({ size, tile, delay }: { size: number; tile: boolean; delay: number }) {
  const base = useSharedValue(0);
  const left = useSharedValue(0);
  const right = useSharedValue(0);
  const point = useSharedValue(0);

  useEffect(() => {
    base.set(withDelay(delay, withSpring(1, spring.gentle)));
    left.set(withDelay(delay + 140, withSpring(1, spring.gentle)));
    right.set(withDelay(delay + 220, withSpring(1, spring.gentle)));
    point.set(withDelay(delay + 380, withSpring(1, { damping: 15, stiffness: 210, mass: 0.8 })));
  }, [delay, base, left, right, point]);

  const u = size / 48;
  const tileStyle = useAnimatedStyle(() => ({
    opacity: Math.min(1, base.get() * 1.5),
    transform: [{ scale: 0.82 + base.get() * 0.18 }],
  }));
  const leftStyle = useRise(left, 9 * u);
  const rightStyle = useRise(right, 9 * u);
  // The survey point lands on the shared boundary: it scales in from its own centre.
  const pointStyle = useAnimatedStyle(() => ({
    opacity: Math.min(1, point.get() * 2),
    transform: [{ scale: 0.4 + point.get() * 0.6 }],
  }));

  const layer = (p: Part, style: object) => (
    <Animated.View style={[StyleSheet.absoluteFill, style]}>
      <Svg width={size} height={size} viewBox="0 0 48 48">
        <Layers tile={tile} part={p} />
      </Svg>
    </Animated.View>
  );

  return (
    <View style={{ width: size, height: size }} accessibilityRole="image" accessibilityLabel="LandConnect">
      {tile ? layer('tile', tileStyle) : null}
      {layer('left', leftStyle)}
      {layer('right', rightStyle)}
      {layer('point', pointStyle)}
    </View>
  );
}

function useRise(p: SharedValue<number>, distance: number) {
  return useAnimatedStyle(() => ({
    opacity: Math.min(1, p.get() * 1.6),
    transform: [{ translateY: (1 - p.get()) * distance }],
  }));
}

export type WordmarkProps = {
  /** Cap-height-driven size; the site sets the wordmark at 18px next to a 32px mark. */
  size?: number;
  /** On dark grounds the site uses white + mint instead of forest + green. */
  onDark?: boolean;
};

/**
 * The site's wordmark: "Land" in the dark brand colour, "Connect" in brand green, Poppins SemiBold,
 * tight tracking. Poppins is the brand face (landconnect.si loads it for everything); it is used only
 * here so the logotype matches the company exactly while the UI keeps its own text face.
 */
export function Wordmark({ size = 18, onDark = false }: WordmarkProps) {
  const [loaded] = useFonts({ Poppins_600SemiBold });
  const base = {
    fontFamily: loaded ? 'Poppins_600SemiBold' : undefined,
    fontWeight: loaded ? undefined : ('600' as const),
    fontSize: size,
    lineHeight: Math.round(size * 1.4),
    letterSpacing: -0.025 * size,
    includeFontPadding: false,
  };
  return (
    <Text
      allowFontScaling={false}
      accessibilityRole="header"
      style={[base, { color: onDark ? palette.white : palette.forest }]}>
      Land
      <Text style={{ color: onDark ? palette.mint : palette.green }}>Connect</Text>
    </Text>
  );
}

/** Mark + wordmark lockup as in the site header (bare mark on light grounds; the tile form on dark grounds, where the green parcel would otherwise disappear). 32px mark, 10px gap, 18px wordmark. */
export function LogoLockup({ scale = 1, onDark = false, animate = false }: { scale?: number; onDark?: boolean; animate?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 * scale }}>
      <LogoMark size={32 * scale} tile={onDark} animate={animate} />
      <Wordmark size={18 * scale} onDark={onDark} />
    </View>
  );
}
