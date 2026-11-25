import { ShieldCheck } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import { useSession } from '@/stores/session';
import { gutter, palette, radius, space } from '@/theme/tokens';
import { Text } from '@/ui/text';

/** Sits above the first message, WhatsApp's encryption line in LandConnect's own words. */
export function PrivacyNotice() {
  const me = useSession((s) => s.profile);
  const identity = me && !me.show_real_name ? ` You appear as ${me.handle}.` : '';

  return (
    <View style={styles.row}>
      <View style={styles.card}>
        <ShieldCheck size={15} color="#B66F0A" strokeWidth={2.2} />
        <Text variant="caption" tone="secondary" center style={styles.text}>
          Messages and calls stay inside LandConnect. Phone numbers are never shared.{identity}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { alignItems: 'center', paddingHorizontal: gutter, paddingTop: space[3], paddingBottom: space[2] },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    maxWidth: '88%',
    paddingHorizontal: space[3],
    paddingVertical: space[2],
    borderRadius: radius.md,
    borderCurve: 'continuous',
    backgroundColor: palette.amberWash,
  },
  text: { flexShrink: 1 },
});
