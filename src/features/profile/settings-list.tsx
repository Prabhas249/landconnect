import { ChevronRight, type LucideIcon } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { colors, radius, space } from '@/theme/tokens';
import { Card } from '@/ui/card';
import { PressableScale } from '@/ui/pressable-scale';
import { Text, type TextTone } from '@/ui/text';

import { Group, LIGHT_CARD, withAlpha } from './parts';

export type SettingsItem = {
  key: string;
  icon: LucideIcon;
  title: string;
  /** One line under the title: the current value or a short summary. */
  value?: string;
  valueTone?: TextTone;
  /** Shows a bone where the value goes while it loads. */
  loading?: boolean;
  /** Without it the row is informational: no chevron, no press. */
  onPress?: () => void;
  /** Replaces the chevron, e.g. a small button. Pass `null` for a pressable row without one. */
  trailing?: ReactNode;
  /** Neutral icon tile for quiet actions. */
  muted?: boolean;
  /** Icon colour; its chip is the same hue at 12%. Defaults to brand green. */
  tint?: string;
  accessibilityLabel?: string;
};

/* Geometry: card padding 8 inside radius xl (28) gives rows an inner radius of 20.
   Row padding 12 + icon 36 + gap 12 puts the text, and the divider inset, 60 in. */
const CARD_PAD = space[2];
const ROW_PAD = space[3];
const ICON = 36;
const ROW_R = radius.xl - CARD_PAD;
const TEXT_INSET = ROW_PAD + ICON + space[3];

function RowBody({ item, chevron }: { item: SettingsItem; chevron: boolean }) {
  const Icon = item.icon;
  return (
    <>
      <View style={[styles.icon, item.muted ? styles.iconMuted : { backgroundColor: withAlpha(item.tint ?? colors.accent, 0.12) }]}>
        <Icon size={18} color={item.muted ? colors.inkSecondary : (item.tint ?? colors.accent)} strokeWidth={2.1} />
      </View>
      <View style={styles.copy}>
        <Text variant="bodyStrong" numberOfLines={1}>
          {item.title}
        </Text>
        {item.loading ? (
          <View style={styles.bone} />
        ) : item.value ? (
          <Text variant="caption" tone={item.valueTone ?? 'secondary'} numberOfLines={1}>
            {item.value}
          </Text>
        ) : null}
      </View>
      {item.trailing !== undefined ? item.trailing : chevron ? <ChevronRight size={17} color={colors.inkTertiary} strokeWidth={2.3} /> : null}
    </>
  );
}

export function SettingsRow({ item }: { item: SettingsItem }) {
  const label = item.accessibilityLabel ?? (item.value ? `${item.title}, ${item.value}` : item.title);
  if (!item.onPress) {
    return (
      <View style={styles.row} accessible accessibilityLabel={label}>
        <RowBody item={item} chevron={false} />
      </View>
    );
  }
  return (
    <PressableScale to={0.98} haptic="selection" onPress={item.onPress} accessibilityLabel={label} style={styles.row}>
      <RowBody item={item} chevron />
    </PressableScale>
  );
}

/** One card of rows with hairlines inset to the text, so icons read as a single column. */
export function SettingsCard({ items }: { items: SettingsItem[] }) {
  return (
    <Card padding={2} style={LIGHT_CARD}>
      {items.map((item, i) => (
        <View key={item.key}>
          {i > 0 ? <View style={styles.divider} /> : null}
          <SettingsRow item={item} />
        </View>
      ))}
    </Card>
  );
}

/** Titled settings group: a quiet heading over one card of rows. */
export function SettingsGroup({ title, items }: { title: string; items: SettingsItem[] }) {
  return (
    <Group title={title}>
      <SettingsCard items={items} />
    </Group>
  );
}

export function SettingsSkeleton({ rows }: { rows: number }) {
  return <View style={[styles.skeleton, { height: CARD_PAD * 2 + rows * ROW_MIN }]} />;
}

const ROW_MIN = 60;

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    minHeight: ROW_MIN,
    paddingVertical: 10,
    paddingHorizontal: ROW_PAD,
    borderRadius: ROW_R,
    borderCurve: 'continuous',
  },
  icon: {
    width: ICON,
    height: ICON,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconMuted: { backgroundColor: colors.surfaceSunken },
  copy: { flex: 1, gap: 1 },
  bone: { width: 112, height: 12, marginVertical: 3, borderRadius: radius.xs, backgroundColor: colors.surfaceSunken },
  divider: {
    height: StyleSheet.hairlineWidth * 2,
    marginLeft: TEXT_INSET,
    marginRight: ROW_PAD,
    backgroundColor: colors.hairline,
  },
  skeleton: { borderRadius: radius.xl, borderCurve: 'continuous', backgroundColor: colors.surfaceSunken },
});
