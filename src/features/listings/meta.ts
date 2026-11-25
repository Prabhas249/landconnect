import type { ComponentProps } from 'react';

import { LAND_TYPES, type LandType, type ListingStatus } from '@/lib/types';
import { colors, palette } from '@/theme/tokens';
import type { Chip } from '@/ui/chip';

type ChipTone = NonNullable<ComponentProps<typeof Chip>['tone']>;

/** Each land type borrows one brand colour so terrain art and dots read consistently across screens. */
export const LAND_TINT: Record<LandType, { base: string; wash: string }> = {
  agricultural: { base: palette.green, wash: palette.mintWash },
  farmhouse: { base: palette.clay, wash: palette.mintSoft },
  residential: { base: palette.blue, wash: colors.surfaceMuted },
  commercial: { base: palette.amber, wash: palette.amberWash },
  industrial: { base: palette.slate, wash: colors.canvasDeep },
};

export function landTypeLabel(value: LandType) {
  return LAND_TYPES.find((t) => t.value === value)?.label ?? value;
}

export const STATUS_META: Record<ListingStatus, { label: string; tone: ChipTone; color: string }> = {
  active: { label: 'Active', tone: 'accent', color: colors.accent },
  under_offer: { label: 'Under offer', tone: 'highlight', color: colors.highlight },
  sold: { label: 'Sold', tone: 'dark', color: colors.ink },
  draft: { label: 'Draft', tone: 'neutral', color: colors.inkTertiary },
};

/** `#RRGGBB` → `rgba()` so tints stay derived from tokens rather than inventing new colours. */
export function withAlpha(hex: string, alpha: number) {
  const n = parseInt(hex.slice(1, 7), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}
