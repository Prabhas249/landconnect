import { Bookmark } from 'lucide-react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';

import { colors, spring } from '@/theme/tokens';
import { IconButton } from '@/ui/icon-button';

export type SaveButtonProps = {
  saved: boolean;
  onToggle: () => void;
  size?: number;
  variant?: 'surface' | 'sunken' | 'plain';
};

/** Bookmark toggle that dips and springs back — saving is a small celebration, so a bounce is allowed. */
export function SaveButton({ saved, onToggle, size = 44, variant = 'surface' }: SaveButtonProps) {
  const pop = useSharedValue(1);
  const iconStyle = useAnimatedStyle(() => ({ transform: [{ scale: pop.get() }] }));

  return (
    <IconButton
      label={saved ? 'Remove from saved' : 'Save listing'}
      size={size}
      variant={variant}
      haptic={saved ? 'selection' : 'medium'}
      accessibilityState={{ selected: saved }}
      onPress={() => {
        pop.set(withSequence(withTiming(0.72, { duration: 90 }), withSpring(1, spring.bouncy)));
        onToggle();
      }}>
      <Animated.View style={iconStyle}>
        <Bookmark
          size={size >= 44 ? 20 : 18}
          strokeWidth={2.1}
          color={saved ? colors.accent : colors.ink}
          fill={saved ? colors.accent : 'transparent'}
        />
      </Animated.View>
    </IconButton>
  );
}
