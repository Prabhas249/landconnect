import type { LucideIcon } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import { colors, radius, shadow, space } from '@/theme/tokens';
import { Button } from '@/ui/button';
import { Enter } from '@/ui/enter';
import { Text } from '@/ui/text';

import { seeded, smoothClosedPath, type Pt } from './geometry';

const SIZE = 168;

/** Contour rings around a centred badge — the shared illustration for empty and error states. */
function Illustration({ icon: Icon, tone, seed }: { icon: LucideIcon; tone: 'calm' | 'alert'; seed: string }) {
  const stroke = tone === 'alert' ? colors.highlight : colors.accent;
  const rand = seeded(seed);
  const phase = [rand() * 6.28, rand() * 6.28];
  const rings = Array.from({ length: 5 }, (_, k) => {
    const r = 40 + k * 9;
    const pts: Pt[] = Array.from({ length: 28 }, (__, i) => {
      const t = (i / 28) * Math.PI * 2;
      const w = 1 + (0.06 * Math.sin(2 * t + phase[0]) + 0.04 * Math.sin(3 * t + phase[1])) * (1 + k * 0.4);
      return { x: SIZE / 2 + Math.cos(t) * r * w, y: SIZE / 2 + Math.sin(t) * r * w };
    });
    return smoothClosedPath(pts);
  });

  return (
    <View style={styles.art}>
      <Svg width={SIZE} height={SIZE} style={StyleSheet.absoluteFill}>
        {rings.map((d, k) => (
          <Path key={k} d={d} fill="none" stroke={stroke} strokeOpacity={0.26 - k * 0.045} strokeWidth={k === 2 ? 1.5 : 1} />
        ))}
        <Circle cx={SIZE / 2 + 52} cy={SIZE / 2 - 40} r={3} fill={stroke} opacity={0.5} />
        <Circle cx={SIZE / 2 - 60} cy={SIZE / 2 + 30} r={2} fill={stroke} opacity={0.35} />
      </Svg>
      <View style={[styles.badge, { backgroundColor: tone === 'alert' ? colors.highlightSoft : colors.surface }]}>
        <Icon size={26} color={tone === 'alert' ? colors.highlight : colors.accent} strokeWidth={2} />
      </View>
    </View>
  );
}

export type StateViewProps = {
  icon: LucideIcon;
  title: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
  tone?: 'calm' | 'alert';
  actionIcon?: ReactNode;
};

/** Designed empty / error state: illustration, calm copy, one clear action. */
export function StateView({ icon, title, body, actionLabel, onAction, tone = 'calm', actionIcon }: StateViewProps) {
  return (
    <View style={styles.wrap}>
      <Enter index={0}>
        <Illustration icon={icon} tone={tone} seed={title} />
      </Enter>
      <Enter index={1} style={styles.copy}>
        <Text variant="heading" center>
          {title}
        </Text>
        <Text variant="body" tone="secondary" center>
          {body}
        </Text>
      </Enter>
      {actionLabel && onAction ? (
        <Enter index={2}>
          <Button label={actionLabel} variant="soft" size="md" block={false} leading={actionIcon} onPress={onAction} />
        </Enter>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', paddingHorizontal: space[8], paddingVertical: space[8], gap: space[4] },
  art: { width: SIZE, height: SIZE, alignItems: 'center', justifyContent: 'center' },
  badge: {
    width: 64,
    height: 64,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: shadow.card,
  },
  copy: { gap: space[2], alignItems: 'center' },
});
