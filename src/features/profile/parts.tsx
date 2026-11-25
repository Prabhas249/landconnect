import type { ReactNode } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import type { CallPermission, Profile, UserRole } from '@/lib/types';
import { colors, palette, space } from '@/theme/tokens';
import { Text } from '@/ui/text';

/**
 * The light card language shared with Explore's Market pulse: white, radius 28 (from `Card`),
 * a 1pt forest hairline at 5% and one soft forest shadow (0 12 32 at 8%). Pass as `Card` style.
 */
export const LIGHT_CARD = {
  borderWidth: 1,
  borderColor: 'rgba(16,32,28,0.05)',
  boxShadow: '0 1px 2px rgba(16,32,28,0.04), 0 12px 32px rgba(16,32,28,0.08)',
} as const;

/** Icon-chip tints, the same three as the Market pulse chips. */
export const TINT = {
  green: palette.green,
  blue: '#3B6FD8',
  amber: palette.amber,
  red: palette.red,
  slate: palette.slate,
} as const;

/** Section heading above a grouped card: sentence case, 18pt ink, with an optional quiet hint. */
export function GroupHead({ title, hint, trailing }: { title: string; hint?: string; trailing?: ReactNode }) {
  return (
    <View style={styles.group}>
      <View style={styles.headCopy}>
        <Text variant="heading" accessibilityRole="header">
          {title}
        </Text>
        {hint ? (
          <Text variant="caption" tone="tertiary">
            {hint}
          </Text>
        ) : null}
      </View>
      {trailing}
    </View>
  );
}

/** A titled group: heading, then its card, held close together. */
export function Group({ title, hint, trailing, children }: { title: string; hint?: string; trailing?: ReactNode; children: ReactNode }) {
  return (
    <View style={styles.groupStack}>
      <GroupHead title={title} hint={hint} trailing={trailing} />
      {children}
    </View>
  );
}

export function maskEmail(email: string) {
  const [name, domain] = email.split('@');
  if (!domain) return '••••••••';
  return `${name.slice(0, 2)}${'•'.repeat(Math.max(3, name.length - 2))}@${domain}`;
}

export function maskPhone(phone: string) {
  const digits = phone.replace(/\D/g, '');
  return `+91 •••• ••• ${digits.slice(-3)}`;
}

/** "Discreet · 3 of 5": the one-line posture used where the full meter does not fit. */
export function postureSummary(p: Profile) {
  const checks = postureChecks(p);
  const safe = checks.filter((c) => c.safe).length;
  const total = checks.length;
  const headline = postureHeadline(safe, total);
  return { safe, total, headline, line: `${headline} · ${safe} of ${total}` };
}

/** Surfaces an error string returned by `updateProfile`. */
export function reportError(message: string | null) {
  if (message) Alert.alert('Could not save', message);
}

/**
 * Ring colours per role. Brokers act for both sides of a deal, so their ring carries both tones.
 * Mint and amber are the brand's two accent tones, so each role reads at a glance on the pass frame.
 */
export const ROLE_RING: Record<UserRole, readonly string[]> = {
  buyer: [colors.accentBright],
  seller: [colors.highlight],
  broker: [colors.accentBright, colors.highlight],
};

/** "Buyer · B-2041" -> "B-2041". */
export function serialOf(handle: string) {
  const parts = handle.split('·');
  return (parts[parts.length - 1] ?? handle).trim();
}

const sinceFmt = new Intl.DateTimeFormat('en-IN', { month: 'short', year: 'numeric' });

export function memberSince(iso: string) {
  return sinceFmt.format(new Date(iso));
}

function hexToRgb(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255] as const;
}

/** Token colour at an alpha, for gradients that fade a token into nothing. */
export function withAlpha(hex: string, alpha: number) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

export const CALL_LABEL: Record<CallPermission, string> = {
  everyone: 'Everyone',
  contacts: 'Chatted with',
  nobody: 'Nobody',
};

export type PostureCheck = {
  key: 'name' | 'seen' | 'receipts' | 'calls' | 'contact';
  title: string;
  value: string;
  /** True when the setting favours discretion. */
  safe: boolean;
  /** Not a setting: enforced by the database and always on. */
  locked?: boolean;
};

/** Each privacy choice scored for discretion. Contact details are always withheld, so they always count. */
export function postureChecks(p: Profile): PostureCheck[] {
  return [
    { key: 'name', title: 'Real name', value: p.show_real_name ? 'Shown' : 'Hidden', safe: !p.show_real_name },
    { key: 'seen', title: 'Last seen', value: p.show_last_seen ? 'Visible' : 'Hidden', safe: !p.show_last_seen },
    { key: 'receipts', title: 'Read receipts', value: p.read_receipts ? 'On' : 'Off', safe: !p.read_receipts },
    { key: 'calls', title: 'Who can call', value: CALL_LABEL[p.allow_calls], safe: p.allow_calls !== 'everyone' },
    { key: 'contact', title: 'Phone and email', value: 'Never shared', safe: true, locked: true },
  ];
}

export function postureHeadline(safe: number, total: number) {
  if (safe >= total) return 'Fully discreet';
  if (safe >= total - 2) return 'Discreet';
  return 'Mostly open';
}

const styles = StyleSheet.create({
  headCopy: { flex: 1, gap: 2 },
  // Set just inside the card edge, like a section title over its card rather than a form label.
  group: { flexDirection: 'row', alignItems: 'flex-end', gap: space[3], paddingHorizontal: space[2] },
  groupStack: { gap: space[3] },
});
