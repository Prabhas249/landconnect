import { Text as RNText, type TextProps as RNTextProps } from 'react-native';

import { colors, type } from '@/theme/tokens';

export type TextVariant = keyof typeof type;
export type TextTone = 'ink' | 'secondary' | 'tertiary' | 'accent' | 'danger' | 'highlight' | 'onDark' | 'onDarkSecondary';

const toneColor: Record<TextTone, string> = {
  ink: colors.ink,
  secondary: colors.inkSecondary,
  tertiary: colors.inkTertiary,
  accent: colors.accent,
  danger: colors.danger,
  highlight: '#B66F0A',
  onDark: colors.inkOnDark,
  onDarkSecondary: colors.inkOnDarkSecondary,
};

export type TextProps = RNTextProps & {
  variant?: TextVariant;
  tone?: TextTone;
  center?: boolean;
};

/** The only text component screens should use. */
export function Text({ variant = 'body', tone = 'ink', center, style, ...rest }: TextProps) {
  return (
    <RNText
      allowFontScaling={false}
      style={[type[variant], { color: toneColor[tone] }, center ? { textAlign: 'center' } : null, style]}
      {...rest}
    />
  );
}

/** Mono uppercase micro-label. */
export function Label({ tone = 'tertiary', ...rest }: Omit<TextProps, 'variant'>) {
  return <Text variant="label" tone={tone} {...rest} />;
}
