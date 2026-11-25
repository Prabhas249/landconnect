import { Navigation, Rotate3d, Square } from 'lucide-react-native';
import { useEffect, useRef } from 'react';
import { StyleSheet, View, type LayoutChangeEvent, type LayoutRectangle } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import type { LandType } from '@/lib/types';
import { Text } from '@/ui/text';
import { colors, font, palette, radius, shadow, space, spring } from '@/theme/tokens';

import { OrbitRing } from './map-orbit';
import { LAND_COLORS, withAlpha } from './map-style';

const HEAD = 34;
const TAIL = 12;

/** Height of the drawn pin, so callers can offset it so the tip lands on the coordinate. */
export const PIN_HEIGHT = HEAD + TAIL / 2;

/** Custom map pin: dark head, mint core, tapered tip. Tip sits at the bottom centre. */
export function MapPin({ tone = 'dark' }: { tone?: 'dark' | 'accent' }) {
  const bg = tone === 'dark' ? colors.ink : colors.accent;
  return (
    <View style={styles.pin} pointerEvents="none">
      <View style={[styles.tail, { backgroundColor: bg }]} />
      <View style={[styles.head, { backgroundColor: bg }]}>
        <View style={styles.core} />
      </View>
    </View>
  );
}

/** Soft ground shadow drawn under a pin so it reads as sitting on the land. */
export function PinShadow() {
  return <View style={styles.ground} pointerEvents="none" />;
}

/** Room under the selected pill for the ground dot and its pulse; the marker offset centres the dot on the point. */
const GROUND = 26;
export const SELECTED_PIN_OFFSET: [number, number] = [0, GROUND / 2];

/**
 * Horizontal hit zones of the callout's action segments, in points from the marker view's left
 * edge, plus the view's size. Marker children are positioned natively on Android, so React
 * Native's touch regions for them are unreliable; the map's own marker press reports the tap
 * point and the screen resolves the action from these zones instead (see explore-map).
 */
export type CalloutZones = { width: number; height: number; orbit: [number, number]; directions: [number, number] };

export type CalloutActions = {
  orbiting: boolean;
  /** Orbit progress 0..1 for the ring. */
  progress: SharedValue<number>;
  onZones: (zones: CalloutZones) => void;
};

/**
 * The one live view on the explore map: the selected listing's price, raised, darkened and
 * pointing at its parcel, with 360° orbit and directions actions on the same capsule. Every
 * other listing is a symbol layer, so this is the only React view the map has to track while
 * the camera moves.
 */
export function SelectedPin({
  price,
  detail,
  landType,
  approximate,
  actions,
}: {
  price: string;
  detail: string | null;
  landType: LandType;
  approximate: boolean;
  actions?: CalloutActions;
}) {
  const enter = useSharedValue(0);
  const pulse = useSharedValue(0);
  const frames = useRef<Record<'wrap' | 'stack' | 'pill' | 'orbit' | 'directions', LayoutRectangle | null>>({
    wrap: null,
    stack: null,
    pill: null,
    orbit: null,
    directions: null,
  });

  useEffect(() => {
    enter.set(withSpring(1, spring.snappy));
    pulse.set(
      withDelay(220, withRepeat(withTiming(1, { duration: 1100, easing: Easing.out(Easing.cubic) }), 2, false)),
    );
  }, [enter, pulse]);

  const pillStyle = useAnimatedStyle(() => ({
    opacity: Math.min(1, enter.get() * 1.4),
    transform: [{ translateY: (1 - enter.get()) * 14 }, { scale: 0.72 + 0.28 * enter.get() }],
  }));
  const ringStyle = useAnimatedStyle(() => ({
    opacity: 0.55 * (1 - pulse.get()),
    transform: [{ scale: 0.6 + pulse.get() * 1.9 }],
  }));

  const tone = LAND_COLORS[landType];

  // Layout values are untransformed, so the entrance scale does not skew the zones.
  const measure = (key: keyof typeof frames.current) => (e: LayoutChangeEvent) => {
    frames.current[key] = e.nativeEvent.layout;
    const { wrap, stack, pill, orbit, directions } = frames.current;
    if (!actions || !wrap || !stack || !pill || !orbit || !directions) return;
    const x0 = stack.x + pill.x;
    actions.onZones({
      width: wrap.width,
      height: wrap.height,
      orbit: [x0 + orbit.x, x0 + orbit.x + orbit.width],
      directions: [x0 + directions.x, x0 + directions.x + directions.width],
    });
  };

  return (
    <View style={styles.selectedWrap} pointerEvents="box-none" onLayout={measure('wrap')}>
      <Animated.View style={[styles.selectedStack, pillStyle]} onLayout={measure('stack')}>
        <View style={[styles.selectedPill, actions ? styles.selectedPillActions : null]} onLayout={measure('pill')}>
          <View style={[styles.typeDot, { backgroundColor: tone.fill }]} />
          <Text style={styles.selectedPrice} numberOfLines={1}>
            {price}
          </Text>
          {detail ? (
            <Text variant="captionStrong" tone="onDarkSecondary" numberOfLines={1} style={styles.tabular}>
              {detail}
            </Text>
          ) : null}
          {actions ? (
            <>
              <View style={styles.divider} />
              <View style={styles.action} onLayout={measure('orbit')}>
                {actions.orbiting ? (
                  <>
                    <OrbitRing progress={actions.progress} size={26} stroke={2.2} />
                    <Square size={9} color={colors.inkOnDark} fill={colors.inkOnDark} strokeWidth={2} />
                  </>
                ) : (
                  <Rotate3d size={18} color={colors.inkOnDark} strokeWidth={2.1} />
                )}
              </View>
              <View style={styles.divider} />
              <View style={styles.action} onLayout={measure('directions')}>
                <Navigation size={16} color={palette.mint} fill={palette.mint} strokeWidth={2.1} />
              </View>
            </>
          ) : null}
        </View>
        {approximate ? null : <View style={styles.pointer} />}
      </Animated.View>
      {/* The ground keeps the pill's spacing for approximate areas too, so both sit at the same height. */}
      <View style={styles.groundBox}>
        {approximate ? null : (
          <>
            <Animated.View style={[styles.ring, { borderColor: tone.fill }, ringStyle]} />
            <View style={[styles.groundDot, { backgroundColor: tone.fill }]} />
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  pin: { width: HEAD, height: PIN_HEIGHT, alignItems: 'center' },
  head: {
    width: HEAD,
    height: HEAD,
    borderRadius: HEAD / 2,
    borderWidth: 3,
    borderColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: shadow.raised,
  },
  core: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.accentBright },
  tail: {
    position: 'absolute',
    bottom: 0,
    width: TAIL,
    height: TAIL,
    borderRadius: 2,
    transform: [{ rotate: '45deg' }],
  },
  ground: {
    width: 18,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.scrim,
    opacity: 0.35,
  },

  selectedWrap: { alignItems: 'center', paddingHorizontal: space[2], paddingTop: space[2] },
  selectedStack: { alignItems: 'center' },
  selectedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    height: 38,
    paddingLeft: space[3],
    paddingRight: space[4],
    borderRadius: radius.pill,
    borderCurve: 'continuous',
    backgroundColor: colors.ink,
    boxShadow: shadow.float,
  },
  // Action segments run to the capsule's right edge.
  selectedPillActions: { paddingRight: space[1] },
  divider: { width: StyleSheet.hairlineWidth * 2, height: 18, backgroundColor: withAlpha(palette.white, 0.18) },
  action: { width: 40, height: 38, alignItems: 'center', justifyContent: 'center' },
  typeDot: { width: 10, height: 10, borderRadius: 5, borderWidth: 2, borderColor: colors.surface },
  selectedPrice: {
    fontFamily: font.semibold,
    fontSize: 15,
    lineHeight: 20,
    letterSpacing: -0.2,
    color: colors.inkOnDark,
    fontVariant: ['tabular-nums'],
  },
  tabular: { fontVariant: ['tabular-nums'] },
  pointer: {
    width: 12,
    height: 12,
    marginTop: -7,
    borderBottomRightRadius: 3,
    backgroundColor: colors.ink,
    transform: [{ rotate: '45deg' }],
  },
  groundBox: {
    width: GROUND,
    height: GROUND,
    marginTop: -GROUND / 2 + 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    position: 'absolute',
    width: GROUND / 2,
    height: GROUND / 2,
    borderRadius: GROUND / 4,
    borderWidth: 2,
  },
  groundDot: { width: 10, height: 10, borderRadius: 5, borderWidth: 2, borderColor: colors.surface },
});
