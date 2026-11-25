import { BadgeCheck, LockKeyhole, PhoneCall, type LucideIcon } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import { colors, radius, space } from '@/theme/tokens';
import { Enter } from '@/ui/enter';
import { Text } from '@/ui/text';

import { HUE, IconChip } from './auth-surface';
import { LogoMark, Wordmark } from './logo-mark';

const PAD = space[5];

const TRUST: { icon: LucideIcon; hue: string; label: string }[] = [
  { icon: LockKeyhole, hue: HUE.green, label: 'Number never shared' },
  { icon: BadgeCheck, hue: HUE.blue, label: 'Verified roles' },
  { icon: PhoneCall, hue: HUE.amber, label: 'In-app calls' },
];

export type AuthHeaderProps = {
  title: string;
  subtitle: string;
  /** `display` for the sign-in hero; `title` when the heading is a longer question. */
  titleVariant?: 'display' | 'title';
};

/**
 * The auth hero: a soft mint panel with the brand lockup, the screen's title and three
 * trust chips, so both sign-in and sign-up open on the same moment.
 */
export function AuthHeader({ title, subtitle, titleVariant = 'display' }: AuthHeaderProps) {
  return (
    <View style={styles.panel}>
      {/* Same lockup and size as the welcome story's brand row, so the logo carries over. */}
      <Enter index={0} style={styles.lockup}>
        <LogoMark size={32} animate delay={60} />
        <Wordmark size={18} />
      </Enter>
      <Enter index={1} style={styles.copy}>
        <Text variant={titleVariant} accessibilityRole="header">
          {title}
        </Text>
        <Text variant="body" tone="secondary">
          {subtitle}
        </Text>
      </Enter>
      <Enter index={2} style={styles.trust}>
        {TRUST.map(({ icon, hue, label }) => (
          <View key={label} style={styles.trustItem}>
            <IconChip icon={icon} hue={hue} size={30} />
            <Text variant="caption" tone="secondary" center numberOfLines={2} style={styles.trustLabel}>
              {label}
            </Text>
          </View>
        ))}
      </Enter>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    gap: space[5],
    padding: PAD,
    borderRadius: radius.xl,
    borderCurve: 'continuous',
    backgroundColor: colors.accentSoft,
    borderWidth: 1,
    borderColor: 'rgba(15,110,86,0.08)',
  },
  lockup: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  copy: { gap: space[2] },
  trust: {
    flexDirection: 'row',
    gap: space[1],
    paddingVertical: space[3],
    paddingHorizontal: space[1],
    borderRadius: radius.xl - PAD + space[2],
    borderCurve: 'continuous',
    backgroundColor: colors.surface,
    boxShadow: '0 1px 2px rgba(16,32,28,0.04), 0 6px 16px rgba(16,32,28,0.05)',
  },
  trustItem: { flex: 1, alignItems: 'center', gap: space[2] },
  trustLabel: { fontSize: 12, lineHeight: 16 },
});
