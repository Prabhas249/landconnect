import { ChevronLeft, Send } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { colors, palette, radius, space } from '@/theme/tokens';
import { PressableScale } from '@/ui/pressable-scale';
import { Label, Text } from '@/ui/text';

import { QUICK_REPLIES } from '../call-store';
import { LIGHT_SURFACE, NightPill, videoBlack } from './parts';

/**
 * Decline-with-message: the ringing actions give way to a short list of replies. Picking one
 * declines the call and posts the reply into the conversation.
 */
export function QuickReplies({ onPick, onCancel, onVideo = false }: { onPick: (text: string) => void; onCancel: () => void; onVideo?: boolean }) {
  const ink = onVideo ? palette.white : colors.ink;
  return (
    <Animated.View entering={FadeIn.duration(220)} style={styles.wrap}>
      <Label tone={onVideo ? 'onDarkSecondary' : 'tertiary'}>Decline and send</Label>
      <View style={[styles.card, onVideo ? styles.videoCard : LIGHT_SURFACE]}>
        {QUICK_REPLIES.map((text, i) => (
          <PressableScale
            key={text}
            haptic="medium"
            accessibilityLabel={`Decline and send: ${text}`}
            onPress={() => onPick(text)}
            style={[styles.row, i > 0 ? (onVideo ? styles.videoDivider : styles.divider) : null]}>
            <Text variant="bodyStrong" tone={onVideo ? 'onDark' : 'ink'} style={styles.text} numberOfLines={1}>
              {text}
            </Text>
            <Send size={16} color={onVideo ? palette.mint : colors.accent} strokeWidth={2.2} />
          </PressableScale>
        ))}
      </View>
      <NightPill label="Back" onVideo={onVideo} onPress={onCancel} leading={<ChevronLeft size={16} color={ink} strokeWidth={2.2} />} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignSelf: 'stretch', alignItems: 'center', gap: space[3] },
  card: { alignSelf: 'stretch', borderRadius: radius.lg, borderCurve: 'continuous', overflow: 'hidden' },
  videoCard: { backgroundColor: videoBlack(0.45) },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[3], minHeight: 54, paddingHorizontal: space[4] },
  text: { flex: 1 },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.hairlineStrong },
  videoDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.16)' },
});
