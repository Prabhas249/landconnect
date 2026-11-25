import * as Haptics from 'expo-haptics';
import { Pressable, StyleSheet, View, type GestureResponderEvent } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

import { colors, radius, space } from '@/theme/tokens';

/** Short, quiet segments: they say where you are without competing with the title. */
const SEG_W = 22;
const SEG_H = 3;
const SEG_GAP = space[1];
const STEP = SEG_W + SEG_GAP;
/** The whole row is a 44pt-tall touch target; the segments sit in its middle. */
const TOUCH = 44;

export type StoryProgressProps = {
  total: number;
  /** Whole steps behind, plus the playback of the current one (e.g. 1.4). */
  value: SharedValue<number>;
  onSelect: (index: number) => void;
  label: (index: number) => string;
};

/**
 * The welcome story's step indicator: three short pill segments, left-aligned above the title.
 * Done steps are solid, the current one fills as it plays, upcoming ones are faint. One pressable
 * row picks the segment from where it was touched, so each target is generous while the marks
 * stay small.
 */
export function StoryProgress({ total, value, onSelect, label }: StoryProgressProps) {
  const pick = (e: GestureResponderEvent) => {
    const i = Math.min(total - 1, Math.max(0, Math.floor((e.nativeEvent.locationX + SEG_GAP / 2) / STEP)));
    Haptics.selectionAsync();
    onSelect(i);
  };
  return (
    <Pressable
      onPress={pick}
      style={styles.row}
      accessibilityLabel={Array.from({ length: total }, (_, i) => label(i)).join(', ')}
      hitSlop={{ left: space[2], right: space[2] }}>
      {Array.from({ length: total }, (_, i) => (
        <Segment key={i} index={i} value={value} />
      ))}
    </Pressable>
  );
}

function Segment({ index, value }: { index: number; value: SharedValue<number> }) {
  const fill = useAnimatedStyle(() => ({ transform: [{ scaleX: Math.min(1, Math.max(0, value.get() - index)) }] }));
  return (
    <View style={styles.track}>
      <Animated.View style={[styles.fill, fill]} />
    </View>
  );
}

const styles = StyleSheet.create({
  // Hugs the segments (plus room for a thumb aimed at the last one) so blank space never jumps.
  row: {
    alignSelf: 'flex-start',
    height: TOUCH,
    paddingRight: TOUCH / 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SEG_GAP,
  },
  track: { width: SEG_W, height: SEG_H, borderRadius: radius.pill, overflow: 'hidden', backgroundColor: colors.surfaceSunken },
  fill: { ...StyleSheet.absoluteFill, backgroundColor: colors.accent, transformOrigin: 'left' },
});
