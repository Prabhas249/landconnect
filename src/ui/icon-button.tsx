import type { ReactNode } from 'react';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { colors, radius, shadow } from '@/theme/tokens';

import { PressableScale, type PressableScaleProps } from './pressable-scale';

export type IconButtonProps = Omit<PressableScaleProps, 'style' | 'children'> & {
  children: ReactNode;
  size?: number;
  variant?: 'surface' | 'sunken' | 'dark' | 'accent' | 'danger' | 'glass' | 'plain';
  label: string;
  style?: StyleProp<ViewStyle>;
};

const bg = {
  surface: colors.surface,
  sunken: colors.surfaceSunken,
  dark: colors.ink,
  accent: colors.accent,
  danger: colors.danger,
  glass: 'rgba(255,255,255,0.14)',
  plain: 'transparent',
} as const;

/** Round icon button — the soft floating circles used in headers and call controls. */
export function IconButton({ children, size = 44, variant = 'surface', label, style, ...rest }: IconButtonProps) {
  return (
    <PressableScale
      to={0.92}
      accessibilityLabel={label}
      style={[
        styles.base,
        {
          width: size,
          height: size,
          backgroundColor: bg[variant],
          boxShadow: variant === 'surface' ? shadow.card : variant === 'accent' ? shadow.accent : undefined,
        },
        style,
      ]}
      {...rest}>
      {children}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  base: { borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
});
