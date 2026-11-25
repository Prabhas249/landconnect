import type { LucideIcon } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useDerivedValue, withTiming } from 'react-native-reanimated';

import type { UserRole } from '@/lib/types';
import { colors, duration, palette, radius, space } from '@/theme/tokens';

import { withAlpha } from './scene';

/** The light card language shared with Explore's Market pulse and the profile groups. */
export const AUTH_CARD = {
  borderWidth: 1,
  borderColor: 'rgba(16,32,28,0.05)',
  boxShadow: '0 1px 2px rgba(16,32,28,0.04), 0 12px 32px rgba(16,32,28,0.08)',
} as const;

/** Icon-chip hues, the same four as the app's stat and pulse chips. */
export const HUE = {
  green: palette.green,
  blue: '#3B6FD8',
  amber: palette.amber,
  mint: palette.mint,
} as const;

/** Each role in its icon-chip colour, matching the call screens' role hues. */
export const ROLE_TINT: Record<UserRole, string> = { buyer: HUE.mint, seller: HUE.amber, broker: HUE.blue };

export const wash = (hex: string) => withAlpha(hex, 0.14);

/** A tinted circle holding an icon: the app's stat-chip motif. */
export function IconChip({ icon: Icon, hue, size = 32 }: { icon: LucideIcon; hue: string; size?: number }) {
  return (
    <View style={[styles.chip, { width: size, height: size, borderRadius: size / 2, backgroundColor: wash(hue) }]}>
      <Icon size={Math.round(size * 0.5)} color={hue} strokeWidth={2.2} />
    </View>
  );
}

const FIELD_ICON = 18;

/** Field icon that warms from tertiary to accent while its field has focus: a cross-fade, not a recolour. */
export function FocusIcon({ icon: Icon, focused }: { icon: LucideIcon; focused: boolean }) {
  const on = useDerivedValue(() => withTiming(focused ? 1 : 0, { duration: duration.base }));
  const onStyle = useAnimatedStyle(() => ({ opacity: on.get() }));
  return (
    <View style={styles.fieldIcon}>
      <Icon size={FIELD_ICON} color={colors.inkTertiary} strokeWidth={2.1} />
      <Animated.View style={[StyleSheet.absoluteFill, onStyle]}>
        <Icon size={FIELD_ICON} color={colors.accent} strokeWidth={2.1} />
      </Animated.View>
    </View>
  );
}

/** One white card that groups a form's fields so they read as a single unit. */
export function FieldCard({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.fieldCard, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  chip: { alignItems: 'center', justifyContent: 'center' },
  fieldIcon: { width: FIELD_ICON, height: FIELD_ICON },
  fieldCard: {
    gap: space[4],
    padding: space[4],
    borderRadius: radius.xl,
    borderCurve: 'continuous',
    backgroundColor: colors.surface,
    ...AUTH_CARD,
  },
});
