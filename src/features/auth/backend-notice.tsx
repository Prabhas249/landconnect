import { PlugZap } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import { isBackendConfigured } from '@/lib/supabase';
import { colors, radius, space } from '@/theme/tokens';
import { Text } from '@/ui/text';

export const BACKEND_MISSING_MESSAGE = 'Backend not connected. Add Supabase keys to .env.';

/** Amber notice shown on the auth screens when Supabase keys are missing, so nothing fails silently. */
export function BackendNotice() {
  if (isBackendConfigured) return null;
  return (
    <View style={styles.card} accessibilityRole="alert">
      <View style={styles.icon}>
        <PlugZap size={16} color={colors.highlight} strokeWidth={2.2} />
      </View>
      <Text variant="captionStrong" tone="highlight" style={styles.text}>
        {BACKEND_MISSING_MESSAGE}
      </Text>
    </View>
  );
}

const PAD = space[3];

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    padding: PAD,
    borderRadius: radius.lg,
    borderCurve: 'continuous',
    backgroundColor: colors.highlightSoft,
  },
  icon: {
    width: 32,
    height: 32,
    borderRadius: radius.lg - PAD,
    borderCurve: 'continuous',
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { flex: 1 },
});
