import { Canvas, Circle, Group, Path, vec, type Transforms3d } from '@shopify/react-native-skia';
import { Check } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useDerivedValue,
  useReducedMotion,
  withDelay,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { ROLE_COPY, type UserRole } from '@/lib/types';
import { colors, duration, radius, shadow, space, spring } from '@/theme/tokens';
import { PressableScale } from '@/ui/pressable-scale';
import { Text } from '@/ui/text';

import { AUTH_CARD, ROLE_TINT, wash } from './auth-surface';
import { RoleGlyph } from './role-glyph';

const PAD = space[4];
const GLYPH = 56;
const CHECK = 26;
/** How far a selected card rises off the canvas. */
const LIFT = 3;

const CHECK_PATH = 'M8 13.4 L11.6 16.8 L18.2 9.6';

export type RoleCardProps = {
  role: UserRole;
  selected: boolean;
  onSelect: (role: UserRole) => void;
};

/**
 * A large selectable role option: bespoke glyph, blurb, and what the role can do.
 * Selecting it is physical: the card lifts onto a deeper shadow, its glyph comes alive,
 * and the check is drawn rather than switched on.
 */
export function RoleCard({ role, selected, onSelect }: RoleCardProps) {
  const copy = ROLE_COPY[role];
  const reduced = useReducedMotion();

  const tint = useDerivedValue<number>(() =>
    reduced ? (selected ? 1 : 0) : withTiming(selected ? 1 : 0, { duration: duration.base }),
  );
  const lift = useDerivedValue<number>(() =>
    reduced ? (selected ? 1 : 0) : selected ? withSpring(1, spring.gentle) : withSpring(0, spring.snappy),
  );
  const pop = useDerivedValue<number>(() =>
    reduced ? (selected ? 1 : 0) : selected ? withSpring(1, spring.bouncy) : withTiming(0, { duration: duration.fast }),
  );
  const draw = useDerivedValue<number>(() =>
    reduced
      ? selected
        ? 1
        : 0
      : selected
        ? withDelay(90, withTiming(1, { duration: 300, easing: Easing.out(Easing.cubic) }))
        : withTiming(0, { duration: duration.fast }),
  );

  const liftStyle = useAnimatedStyle(() => ({ transform: [{ translateY: -LIFT * lift.get() }] }));
  // The deeper shadow lives on its own layer and fades in, so only opacity animates.
  const raisedStyle = useAnimatedStyle(() => ({ opacity: lift.get() }));
  const tintStyle = useAnimatedStyle(() => ({ opacity: tint.get() }));

  return (
    <Animated.View style={liftStyle}>
      <Animated.View pointerEvents="none" style={[styles.raised, raisedStyle]} />
      <PressableScale
        haptic="selection"
        onPress={() => onSelect(role)}
        accessibilityRole="radio"
        accessibilityState={{ selected }}
        accessibilityLabel={`${copy.label}. ${copy.blurb}`}
        style={styles.card}>
        <Animated.View pointerEvents="none" style={[styles.tint, tintStyle]} />

        <View style={styles.head}>
          <View style={[styles.glyphWell, { backgroundColor: wash(ROLE_TINT[role]) }]}>
            <RoleGlyph role={role} size={GLYPH} active={selected} />
          </View>
          <View style={styles.headText}>
            <Text variant="bodyStrong">{copy.label}</Text>
            <Text variant="caption" tone="secondary">
              {copy.blurb}
            </Text>
          </View>
          <View style={styles.checkRing}>
            <DrawnCheck pop={pop} draw={draw} />
          </View>
        </View>

        <View style={styles.list}>
          {copy.can.map((item) => (
            <View key={item} style={styles.row}>
              <View style={styles.bullet}>
                <Check size={11} color={colors.accent} strokeWidth={3} />
              </View>
              <Text variant="caption" tone="secondary" style={styles.rowText}>
                {item}
              </Text>
            </View>
          ))}
        </View>
      </PressableScale>
    </Animated.View>
  );
}

function DrawnCheck({ pop, draw }: { pop: SharedValue<number>; draw: SharedValue<number> }) {
  const transform = useDerivedValue<Transforms3d>(() => [{ scale: 0.4 + pop.get() * 0.6 }]);
  const opacity = useDerivedValue(() => Math.min(1, pop.get() * 1.5));
  return (
    <Canvas style={styles.checkCanvas} pointerEvents="none">
      <Group transform={transform} origin={vec(CHECK / 2, CHECK / 2)} opacity={opacity}>
        <Circle cx={CHECK / 2} cy={CHECK / 2} r={CHECK / 2} color={colors.accent} />
      </Group>
      <Path
        path={CHECK_PATH}
        style="stroke"
        strokeWidth={2.6}
        strokeCap="round"
        strokeJoin="round"
        color={colors.inkOnDark}
        start={0}
        end={draw}
      />
    </Canvas>
  );
}

const styles = StyleSheet.create({
  raised: {
    ...StyleSheet.absoluteFill,
    borderRadius: radius.xl,
    borderCurve: 'continuous',
    backgroundColor: colors.surface,
    boxShadow: shadow.raised,
  },
  card: {
    padding: PAD,
    gap: space[3],
    borderRadius: radius.xl,
    borderCurve: 'continuous',
    backgroundColor: colors.surface,
    ...AUTH_CARD,
    overflow: 'hidden',
  },
  tint: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.accentSoft,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  glyphWell: {
    width: GLYPH,
    height: GLYPH,
    borderRadius: GLYPH / 2,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  headText: { flex: 1, gap: 2 },
  checkRing: {
    width: CHECK,
    height: CHECK,
    borderRadius: CHECK / 2,
    borderWidth: 1.5,
    borderColor: colors.hairlineStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkCanvas: { position: 'absolute', top: -1.5, left: -1.5, width: CHECK, height: CHECK },
  list: { gap: space[1] + 2, paddingLeft: GLYPH + space[3] },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  bullet: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: { flex: 1 },
});
