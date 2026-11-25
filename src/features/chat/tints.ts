import { colors, palette } from '@/theme/tokens';

/** Icon-in-circle pairs: the glyph colour and the wash behind it. */
export type CallTint = { ink: string; wash: string };

export const callTint = {
  voice: { ink: palette.green, wash: palette.mintWash },
  video: { ink: '#3B6FD8', wash: '#E6EDFB' },
  unanswered: { ink: '#B66F0A', wash: palette.amberWash },
  missed: { ink: colors.danger, wash: colors.dangerSoft },
} as const satisfies Record<string, CallTint>;
