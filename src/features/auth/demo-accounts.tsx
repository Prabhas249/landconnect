import { ArrowRight } from 'lucide-react-native';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import Animated, {
  FadeIn,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { ROLE_COPY, type UserRole } from '@/lib/types';
import { colors, duration, radius, space } from '@/theme/tokens';
import { Enter } from '@/ui/enter';
import { PressableScale } from '@/ui/pressable-scale';
import { Text } from '@/ui/text';

import { AUTH_CARD, ROLE_TINT, wash } from './auth-surface';
import { RoleGlyph } from './role-glyph';

export const DEMO_PASSWORD = 'landconnect123';
export const DEMO_ROLES: UserRole[] = ['buyer', 'seller', 'broker'];
export const demoEmail = (role: UserRole) => `${role}@landconnect.demo`;

const HINT: Record<UserRole, string> = {
  buyer: 'Browse, save and call sellers',
  seller: 'List land and meet buyers',
  broker: 'Run a portfolio for owners',
};

const CARD_PAD = space[2];
const ROW_RADIUS = radius.xl - CARD_PAD;
const GLYPH_WELL = 52;
/** Rows land just after the card itself. */
const ROW_DELAY = 120;

export type DemoAccountsProps = {
  /** What is signing in right now: the form, a demo role, or nothing. */
  pending: 'form' | UserRole | null;
  onSelect: (role: UserRole) => void;
};

/** One-tap demo sign-in: a row per role with its glyph, what it can do, and an "Enter demo" pill. */
export function DemoAccounts({ pending, onSelect }: DemoAccountsProps) {
  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Text variant="heading" accessibilityRole="header">
          Try a demo account
        </Text>
        <Text variant="caption" tone="tertiary">
          One tap, no signup. We fill the form and sign you in.
        </Text>
      </View>
      {DEMO_ROLES.map((role, i) => (
        <Enter key={role} index={i} delay={ROW_DELAY}>
          {i > 0 ? <View style={styles.divider} /> : null}
          <DemoRow
            role={role}
            busy={pending === role}
            disabled={pending !== null && pending !== role}
            onPress={() => onSelect(role)}
          />
        </Enter>
      ))}
    </View>
  );
}

function DemoRow({
  role,
  busy,
  disabled,
  onPress,
}: {
  role: UserRole;
  busy: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const reduced = useReducedMotion();
  const press = useSharedValue(0);
  const washStyle = useAnimatedStyle(() => ({ opacity: press.get() }));
  const hue = ROLE_TINT[role];

  return (
    <PressableScale
      to={0.98}
      haptic="selection"
      onPress={onPress}
      disabled={disabled}
      accessibilityLabel={`Sign in as the demo ${ROLE_COPY[role].label.toLowerCase()}`}
      accessibilityState={{ busy }}
      onPressIn={() => press.set(withTiming(1, { duration: duration.press }))}
      onPressOut={() => press.set(withTiming(0, { duration: duration.base }))}
      style={styles.row}>
      <Animated.View pointerEvents="none" style={[styles.rowPressed, washStyle]} />
      <View style={[styles.glyph, { backgroundColor: wash(hue) }]}>
        {/* The glyph's own loop doubles as the loading state for this row. */}
        <RoleGlyph role={role} size={40} active={busy} />
      </View>
      <View style={styles.copy}>
        <Text variant="bodyStrong">{ROLE_COPY[role].label}</Text>
        <Animated.View key={busy ? 'busy' : 'idle'} entering={reduced ? undefined : FadeIn.duration(180)}>
          <Text variant="caption" tone={busy ? 'accent' : 'secondary'} numberOfLines={2}>
            {busy ? 'Signing in securely' : HINT[role]}
          </Text>
        </Animated.View>
      </View>
      <View style={styles.go}>
        {busy ? (
          <ActivityIndicator size="small" color={colors.accent} />
        ) : (
          <>
            <Text variant="captionStrong" tone="accent">
              Enter demo
            </Text>
            <ArrowRight size={14} color={colors.accent} strokeWidth={2.4} />
          </>
        )}
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: CARD_PAD,
    borderRadius: radius.xl,
    borderCurve: 'continuous',
    backgroundColor: colors.surface,
    ...AUTH_CARD,
  },
  head: { gap: 2, paddingHorizontal: space[3], paddingTop: space[3], paddingBottom: space[2] },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    minHeight: 76,
    paddingHorizontal: space[3],
    paddingVertical: space[3],
    borderRadius: ROW_RADIUS,
    borderCurve: 'continuous',
  },
  rowPressed: {
    ...StyleSheet.absoluteFill,
    borderRadius: ROW_RADIUS,
    borderCurve: 'continuous',
    backgroundColor: colors.surfaceMuted,
  },
  divider: {
    height: StyleSheet.hairlineWidth * 2,
    marginLeft: space[3] + GLYPH_WELL + space[3],
    marginRight: space[3],
    backgroundColor: colors.hairline,
  },
  glyph: {
    width: GLYPH_WELL,
    height: GLYPH_WELL,
    borderRadius: GLYPH_WELL / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: { flex: 1, gap: 1 },
  go: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[1],
    minWidth: 40,
    height: 32,
    paddingHorizontal: space[3],
    borderRadius: radius.pill,
    backgroundColor: colors.accentSoft,
  },
});
