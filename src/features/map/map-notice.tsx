import type { ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { FadeInDown, FadeOutDown } from 'react-native-reanimated';

import { Button } from '@/ui/button';
import { Text } from '@/ui/text';
import { colors, radius, shadow, space } from '@/theme/tokens';

export type MapNoticeProps = {
  title: string;
  body?: string;
  /** Spinner instead of an icon. */
  busy?: boolean;
  icon?: ReactNode;
  action?: { label: string; onPress: () => void };
  style?: StyleProp<ViewStyle>;
};

/** Calm floating message for map loading, empty and error states. The map stays usable behind it. */
export function MapNotice({ title, body, busy, icon, action, style }: MapNoticeProps) {
  return (
    <Animated.View
      entering={FadeInDown.springify().damping(24).stiffness(200)}
      exiting={FadeOutDown.duration(160)}
      style={[styles.card, style]}>
      <View style={styles.badge}>{busy ? <ActivityIndicator size="small" color={colors.accent} /> : icon}</View>
      <View style={styles.text}>
        <Text variant="captionStrong" numberOfLines={1}>
          {title}
        </Text>
        {body ? (
          <Text variant="caption" tone="secondary" numberOfLines={2}>
            {body}
          </Text>
        ) : null}
      </View>
      {action ? <Button label={action.label} variant="soft" size="sm" block={false} onPress={action.onPress} /> : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    padding: space[3],
    borderRadius: radius.xl,
    borderCurve: 'continuous',
    backgroundColor: colors.surface,
    boxShadow: shadow.float,
  },
  badge: {
    width: 40,
    height: 40,
    // Nested radius: radius.xl − padding.
    borderRadius: radius.md,
    borderCurve: 'continuous',
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { flex: 1, gap: 1 },
});
