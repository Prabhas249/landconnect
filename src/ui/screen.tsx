import { router } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, gutter, space, TAB_BAR_HEIGHT } from '@/theme/tokens';

import { IconButton } from './icon-button';
import { Text } from './text';

/** Full-bleed canvas. Screens own their scroll view; use `useScreenInsets` for padding. */
export function Screen({ children, style, dark }: { children: ReactNode; style?: StyleProp<ViewStyle>; dark?: boolean }) {
  return <View style={[styles.screen, { backgroundColor: dark ? colors.night : colors.canvas }, style]}>{children}</View>;
}

/** Safe-area aware paddings, including room for the floating tab bar. */
export function useScreenInsets({ tabBar = false }: { tabBar?: boolean } = {}) {
  const insets = useSafeAreaInsets();
  return {
    top: insets.top + space[2],
    bottom: Math.max(insets.bottom, space[4]) + (tabBar ? TAB_BAR_HEIGHT + space[5] : space[4]),
    raw: insets,
  };
}

export type HeaderProps = {
  title?: string;
  subtitle?: string;
  /** Show the round back button. */
  back?: boolean;
  onBack?: () => void;
  trailing?: ReactNode;
  /** Replace the centred title block. */
  center?: ReactNode;
  tone?: 'light' | 'dark';
  style?: StyleProp<ViewStyle>;
};

/** Stack header: floating round back button, centred title, optional trailing action. */
export function Header({ title, subtitle, back = true, onBack, trailing, center, tone = 'light', style }: HeaderProps) {
  const dark = tone === 'dark';
  return (
    <View style={[styles.header, style]}>
      <View style={styles.side}>
        {back ? (
          <IconButton
            label="Back"
            variant={dark ? 'glass' : 'surface'}
            onPress={onBack ?? (() => (router.canGoBack() ? router.back() : router.replace('/')))}>
            <ChevronLeft size={22} color={dark ? colors.inkOnDark : colors.ink} strokeWidth={2.2} />
          </IconButton>
        ) : null}
      </View>
      <View style={styles.center}>
        {center ?? (
          <>
            {title ? (
              <Text variant="heading" tone={dark ? 'onDark' : 'ink'} numberOfLines={1}>
                {title}
              </Text>
            ) : null}
            {subtitle ? (
              <Text variant="caption" tone={dark ? 'onDarkSecondary' : 'secondary'} numberOfLines={1}>
                {subtitle}
              </Text>
            ) : null}
          </>
        )}
      </View>
      <View style={[styles.side, styles.sideEnd]}>{trailing}</View>
    </View>
  );
}

/** Large left-aligned title for tab roots. */
export function LargeTitle({ eyebrow, title, trailing }: { eyebrow?: string; title: string; trailing?: ReactNode }) {
  return (
    <View style={styles.large}>
      <View style={styles.largeText}>
        {eyebrow ? <Text variant="label" tone="tertiary">{eyebrow}</Text> : null}
        <Text variant="title" numberOfLines={1}>
          {title}
        </Text>
      </View>
      {trailing ? <View style={styles.largeTrailing}>{trailing}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: gutter,
    minHeight: 52,
    gap: space[3],
  },
  side: { minWidth: 44, flexDirection: 'row', alignItems: 'center', gap: space[2] },
  sideEnd: { justifyContent: 'flex-end' },
  center: { flex: 1, alignItems: 'center', gap: 1 },
  large: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingHorizontal: gutter,
    gap: space[3],
  },
  largeText: { flex: 1, gap: space[1] },
  largeTrailing: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
});
