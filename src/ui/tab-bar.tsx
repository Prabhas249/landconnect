import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import type { LucideIcon } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, font, gutter, radius, shadow, space, spring, TAB_BAR_HEIGHT } from '@/theme/tokens';

import { Text } from './text';

export type TabItem = { name: string; label: string; icon: LucideIcon; badge?: number };

export type FloatingTabBarProps = {
  items: TabItem[];
  activeIndex: number;
  onSelect: (index: number) => void;
  /** Fade page content into the canvas behind the bar. Off for full-bleed screens such as the map. */
  scrim?: boolean;
};

const PAD = 6;

/** Tab icon and label weight at rest and active; the colour cross-fades between them. */
const ICON_REST = 1.9;
const ICON_ACTIVE = 2.3;

/**
 * One tab. Its own 0..1 progress follows the pill's position, so the icon lifts and scales, and
 * the ink cross-fades from tertiary to full, in step with the pill arriving. Two stacked layers
 * (icon and label) carry the colour change, since the SVG stroke cannot be animated.
 */
function TabButton({
  item,
  index,
  active,
  position,
  onPress,
}: {
  item: TabItem;
  index: number;
  active: boolean;
  position: Animated.Value;
  onPress: () => void;
}) {
  const Icon = item.icon;
  // 1 when the pill sits on this tab, falling off within one slot of travel.
  const p = position.interpolate({ inputRange: [index - 1, index, index + 1], outputRange: [0, 1, 0], extrapolate: 'clamp' });
  const iconWrap = {
    transform: [
      { translateY: p.interpolate({ inputRange: [0, 1], outputRange: [0, -1] }) },
      { scale: p.interpolate({ inputRange: [0, 1], outputRange: [1, 1.1] }) },
    ],
  };
  const activeLayer = { opacity: p };
  const restLayer = { opacity: p.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) };

  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityLabel={item.label}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={styles.item}>
      <Animated.View style={iconWrap}>
        <Animated.View style={restLayer}>
          <Icon size={22} color={colors.inkTertiary} strokeWidth={ICON_REST} />
        </Animated.View>
        <Animated.View style={[StyleSheet.absoluteFill, activeLayer]}>
          <Icon size={22} color={colors.ink} strokeWidth={ICON_ACTIVE} />
        </Animated.View>
        {item.badge ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{item.badge > 9 ? '9+' : String(item.badge)}</Text>
          </View>
        ) : null}
      </Animated.View>
      <View>
        <Animated.Text allowFontScaling={false} style={[styles.label, styles.labelRest, restLayer]}>
          {item.label}
        </Animated.Text>
        <Animated.Text allowFontScaling={false} style={[styles.label, styles.labelActive, StyleSheet.absoluteFill, activeLayer]}>
          {item.label}
        </Animated.Text>
      </View>
    </Pressable>
  );
}

/**
 * Floating pill tab bar. The highlight pill springs between tabs and stretches along its path
 * (a short morph, like the iOS segmented thumb) before settling to the slot width. Everything is
 * driven by one UI-thread spring, so taps mid-flight retarget smoothly; reduced motion jumps.
 */
export function FloatingTabBar({ items, activeIndex, onSelect, scrim = true }: FloatingTabBarProps) {
  const insets = useSafeAreaInsets();
  const [width, setWidth] = useState(0);
  const slot = width > 0 ? (width - PAD * 2) / items.length : 0;

  // Index units scaled by the measured slot: the first layout places the pill without a slide.
  // RN's native driver, not Reanimated: on Android a Reanimated spring commits the whole shadow
  // tree every frame, which made each tab switch stutter while the new tab was mounting.
  const reduced = useReducedMotion();
  const position = useRef(new Animated.Value(activeIndex)).current;
  // A softer spring trailing the pill: their gap is zero at rest and grows mid-flight, so it drives
  // a continuous stretch that is always back to the slot width when the pill lands.
  const trail = useRef(new Animated.Value(activeIndex)).current;
  useEffect(() => {
    if (reduced) {
      position.setValue(activeIndex);
      trail.setValue(activeIndex);
      return;
    }
    const run = Animated.parallel([
      Animated.spring(position, { toValue: activeIndex, ...spring.ui, useNativeDriver: true }),
      Animated.spring(trail, { toValue: activeIndex, ...spring.sheet, useNativeDriver: true }),
    ]);
    run.start();
    return () => run.stop();
  }, [activeIndex, reduced, position, trail]);
  const pill = {
    transform: [
      { translateX: position.interpolate({ inputRange: [0, 1], outputRange: [0, slot], extrapolate: 'extend' }) },
      {
        scaleX: Animated.subtract(position, trail).interpolate({
          inputRange: [-0.8, 0, 0.8],
          outputRange: [1.28, 1, 1.28],
          extrapolate: 'clamp',
        }),
      },
    ],
  };

  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  const bottom = Math.max(insets.bottom, space[3]);

  return (
    <>
      {scrim ? (
        // Without this, list text scrolls visibly behind and around the floating bar.
        <LinearGradient
          pointerEvents="none"
          colors={[SCRIM_CLEAR, SCRIM_SOLID, SCRIM_SOLID]}
          locations={[0, 0.45, 1]}
          style={[styles.scrim, { height: bottom + TAB_BAR_HEIGHT + space[8] }]}
        />
      ) : null}
    <View pointerEvents="box-none" style={[styles.wrap, { bottom }]}>
      <View onLayout={onLayout} style={styles.bar}>
        {slot > 0 ? <Animated.View style={[styles.pill, { width: slot }, pill]} /> : null}
        {items.map((item, i) => (
          <TabButton
            key={item.name}
            item={item}
            index={i}
            active={i === activeIndex}
            position={position}
            onPress={() => {
              if (i !== activeIndex) Haptics.selectionAsync();
              onSelect(i);
            }}
          />
        ))}
      </View>
    </View>
    </>
  );
}

// Same hue as the canvas at zero alpha, so the fade never greys out mid-way.
const SCRIM_CLEAR = 'rgba(240,244,241,0)';
const SCRIM_SOLID = 'rgba(240,244,241,0.97)';

const styles = StyleSheet.create({
  scrim: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  wrap: { position: 'absolute', left: gutter, right: gutter },
  bar: {
    flexDirection: 'row',
    height: TAB_BAR_HEIGHT,
    padding: PAD,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    boxShadow: shadow.float,
  },
  pill: {
    position: 'absolute',
    top: PAD,
    bottom: PAD,
    left: PAD,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSunken,
  },
  item: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3 },
  label: { fontFamily: font.semibold, fontSize: 11, lineHeight: 14 },
  labelRest: { color: colors.inkTertiary },
  labelActive: { color: colors.ink, textAlign: 'center' },
  badge: {
    position: 'absolute',
    top: -5,
    right: -10,
    minWidth: 17,
    height: 17,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: colors.accent,
    borderWidth: 2,
    borderColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { fontFamily: font.semibold, fontSize: 9, lineHeight: 12, color: colors.inkOnDark },
});
