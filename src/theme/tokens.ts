/**
 * LandConnect design tokens.
 *
 * Palette is derived from LandConnect's own brand (forest / green / mint / amber).
 * Every screen pulls spacing, radii, shadows and type from here — no ad-hoc values.
 */

export const palette = {
  forest: '#10201C',
  forest2: '#1B332D',
  green: '#0F6E56',
  greenPressed: '#0B5743',
  mint: '#5DCAA5',
  mintSoft: '#CFEDE0',
  mintWash: '#E8F1ED',
  amber: '#EF9F27',
  amberWash: '#FDF1DC',
  red: '#D8473A',
  redWash: '#FBE6E3',
  blue: '#2F6FED',
  /** Land-type hues that must stay distinguishable from the greens at dot size. */
  clay: '#B5623C',
  slate: '#5B6B7A',
  white: '#FFFFFF',
} as const;

export const colors = {
  /** Single canvas colour for every screen. */
  canvas: '#F0F4F1',
  canvasDeep: '#E4ECE7',
  surface: palette.white,
  surfaceMuted: '#F5F8F6',
  surfaceSunken: '#E9EFEB',

  ink: palette.forest,
  inkSecondary: '#5B6B66',
  inkTertiary: '#94A29D',
  inkOnDark: '#F3F7F5',
  inkOnDarkSecondary: 'rgba(243,247,245,0.64)',

  accent: palette.green,
  accentPressed: palette.greenPressed,
  accentSoft: palette.mintWash,
  accentBright: palette.mint,

  highlight: palette.amber,
  highlightSoft: palette.amberWash,

  danger: palette.red,
  dangerSoft: palette.redWash,

  hairline: 'rgba(16,32,28,0.06)',
  hairlineStrong: 'rgba(16,32,28,0.10)',
  scrim: 'rgba(16,32,28,0.42)',

  /** Chat bubbles. */
  bubbleOut: '#DDF3E8',
  bubbleIn: palette.white,

  /** Call surfaces (dark). */
  night: '#0B1614',
  nightRaised: '#16261F',
} as const;

/** 4pt grid. */
export const space = {
  0: 0,
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  7: 28,
  8: 32,
  10: 40,
  12: 48,
  16: 64,
} as const;

/** Screen gutter. */
export const gutter = space[5];

export const radius = {
  xs: 8,
  sm: 12,
  md: 16,
  lg: 22,
  xl: 28,
  xxl: 36,
  pill: 999,
} as const;

/**
 * Two-layer shadows tinted with the forest ink, never pure black.
 * CSS `boxShadow` string syntax (RN new architecture).
 */
export const shadow = {
  none: undefined,
  hair: '0 1px 2px rgba(16,32,28,0.05)',
  card: '0 1px 2px rgba(16,32,28,0.04), 0 12px 32px rgba(16,32,28,0.07)',
  raised: '0 2px 4px rgba(16,32,28,0.05), 0 20px 40px rgba(16,32,28,0.11)',
  float: '0 2px 6px rgba(16,32,28,0.06), 0 24px 48px rgba(16,32,28,0.16)',
  accent: '0 2px 4px rgba(15,110,86,0.18), 0 12px 24px rgba(15,110,86,0.24)',
} as const;

export const font = {
  regular: 'Geist_400Regular',
  medium: 'Geist_500Medium',
  semibold: 'Geist_600SemiBold',
  bold: 'Geist_700Bold',
  mono: 'GeistMono_500Medium',
  monoBold: 'GeistMono_700Bold',
} as const;

/** Four reading sizes + display + mono micro-label. */
export const type = {
  display: { fontFamily: font.semibold, fontSize: 34, lineHeight: 40, letterSpacing: -1.2 },
  title: { fontFamily: font.semibold, fontSize: 24, lineHeight: 30, letterSpacing: -0.7 },
  heading: { fontFamily: font.semibold, fontSize: 18, lineHeight: 24, letterSpacing: -0.35 },
  body: { fontFamily: font.regular, fontSize: 15, lineHeight: 22, letterSpacing: -0.1 },
  bodyStrong: { fontFamily: font.medium, fontSize: 15, lineHeight: 22, letterSpacing: -0.1 },
  caption: { fontFamily: font.regular, fontSize: 13, lineHeight: 18, letterSpacing: 0 },
  captionStrong: { fontFamily: font.medium, fontSize: 13, lineHeight: 18, letterSpacing: 0 },
  /** Uppercase tracked micro-label. */
  label: {
    fontFamily: font.semibold,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 0.7,
    textTransform: 'uppercase' as const,
  },
  /** Figures: prices, areas, times. Always tabular. */
  figure: {
    fontFamily: font.semibold,
    fontSize: 26,
    lineHeight: 32,
    letterSpacing: -0.6,
    fontVariant: ['tabular-nums' as const],
  },
  figureSmall: {
    fontFamily: font.semibold,
    fontSize: 17,
    lineHeight: 22,
    letterSpacing: -0.3,
    fontVariant: ['tabular-nums' as const],
  },
} as const;

/**
 * Motion: one spring language for the whole app, tuned like UIKit / SwiftUI springs.
 *
 * Each preset is the SwiftUI `response` / `dampingFraction` pair converted to Reanimated physics
 * (mass 1, stiffness = (2π / response)², damping = 4π · dampingFraction / response), so they settle
 * in the time named and keep the hand-off velocity when interrupted. Physics form (not `duration`)
 * on purpose: it also works with layout-animation builders (`.damping().stiffness()`) and with
 * `{ ...spring.x, velocity }` after a gesture.
 *
 * Pick by intent, not by feel:
 * - `ui`      presses, toggles, segmented thumbs, tab pill. response 0.30 s, critically damped.
 * - `layout`  entrances, size and position changes, ring arcs. response 0.39 s, clamped: never
 *             overshoots, visually done in ~400 ms. Same curve as the old local `SETTLE` constants.
 * - `sheet`   sheets, drawers, large surfaces. response 0.50 s, critically damped.
 * - `bounce`  celebrations only (saved, verified, success). response 0.40 s, ~4 % overshoot.
 *
 * Do not use `layout` after a fling: clamping stops a fast spring dead at the target. Use `ui` or
 * `sheet` with the gesture velocity instead.
 */
export const spring = {
  ui: { damping: 42, stiffness: 439, mass: 1 },
  layout: { damping: 32, stiffness: 260, mass: 1, overshootClamping: true },
  sheet: { damping: 25, stiffness: 158, mass: 1 },
  bounce: { damping: 22.6, stiffness: 247, mass: 1 },

  // Older names, kept so existing screens join the same language. Prefer the intent names above.
  /** = `ui`. */
  snappy: { damping: 42, stiffness: 439, mass: 1 },
  /** = `layout` without the clamp, so it is still safe with gesture velocity. */
  gentle: { damping: 32, stiffness: 260, mass: 1 },
  /** = `sheet`. */
  soft: { damping: 25, stiffness: 158, mass: 1 },
  /** = `bounce`. */
  bouncy: { damping: 22.6, stiffness: 247, mass: 1 },
} as const;

/**
 * Timing for things that should not spring: opacity fades, colour washes, press-in.
 * `press` is the near-instant press-down; release springs back with `spring.ui`.
 */
export const duration = { press: 90, fast: 140, base: 220, slow: 380 } as const;

/**
 * Cubic-bezier control points for timed motion (pass to `Easing.bezier(...curve.out)`).
 * `out` is the iOS ease-out used for fades and press-in; `inOut` for cross-fades.
 */
export const curve = {
  out: [0.25, 1, 0.5, 1] as const,
  inOut: [0.42, 0, 0.58, 1] as const,
} as const;

/** Entrance stagger step (ms), capped by `maxStagger` items so long lists never crawl in. */
export const stagger = 45;
export const maxStagger = 6;
/** How far an entering element rises (pt). Small: content should settle, not fly. */
export const enterRise = 8;

export const hitSlop = { top: 10, bottom: 10, left: 10, right: 10 } as const;

export const TAB_BAR_HEIGHT = 68;
