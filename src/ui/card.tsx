import { StyleSheet, View, type ViewProps } from 'react-native';

import { colors, radius, shadow, space } from '@/theme/tokens';

export type CardProps = ViewProps & {
  /** Inner padding token. Children radii should be `radius.xl - padding`. */
  padding?: keyof typeof space;
  tone?: 'surface' | 'muted' | 'sunken' | 'accent' | 'dark' | 'highlight';
  elevated?: boolean;
  radiusToken?: keyof typeof radius;
};

const bg = {
  surface: colors.surface,
  muted: colors.surfaceMuted,
  sunken: colors.surfaceSunken,
  accent: colors.accentSoft,
  dark: colors.ink,
  highlight: colors.highlightSoft,
} as const;

/** White card on the canvas. No borders — depth comes from the two-layer tinted shadow. */
export function Card({
  padding = 5,
  tone = 'surface',
  elevated = tone === 'surface',
  radiusToken = 'xl',
  style,
  ...rest
}: CardProps) {
  return (
    <View
      style={[
        styles.base,
        {
          padding: space[padding],
          backgroundColor: bg[tone],
          borderRadius: radius[radiusToken],
          boxShadow: elevated ? shadow.card : undefined,
        },
        style,
      ]}
      {...rest}
    />
  );
}

/** Hairline divider for use inside cards. */
export function Divider({ inset = 0 }: { inset?: number }) {
  return <View style={[styles.divider, { marginLeft: inset }]} />;
}

const styles = StyleSheet.create({
  base: { borderCurve: 'continuous' },
  divider: { height: StyleSheet.hairlineWidth * 2, backgroundColor: colors.hairline },
});
