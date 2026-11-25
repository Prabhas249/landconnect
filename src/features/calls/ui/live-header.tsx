import { ChevronDown, SignalLow, WifiOff } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { publicName } from '@/lib/format';
import { colors, gutter, palette, space } from '@/theme/tokens';
import { PressableScale } from '@/ui/pressable-scale';

import { useCallStore } from '../call-store';
import { CONTROL_BAR_HEIGHT } from './controls';
import { LIGHT_SURFACE, NightChip, PrivacyLine, SignalBars, VIDEO_GLASS, chipInk } from './parts';

/** Room the header takes below the status bar (top row + one status line). */
export const HEADER_SPACE = 104;
const SIDE = 40;

export function useLiveInsets() {
  const insets = useSafeAreaInsets();
  return {
    top: insets.top + HEADER_SPACE,
    bottom: Math.max(insets.bottom, space[4]) + CONTROL_BAR_HEIGHT + space[4],
    controls: Math.max(insets.bottom, space[4]) + space[2],
    header: insets.top + space[2],
  };
}

/**
 * Honest link state under the privacy chip: "Reconnecting…" while LiveKit re-establishes media,
 * then a weak link on either side. Nothing when all is well.
 */
function LinkNotice({ onVideo }: { onVideo: boolean }) {
  const reconnecting = useCallStore((s) => s.reconnecting);
  const quality = useCallStore((s) => s.quality);
  const peerQuality = useCallStore((s) => s.peerQuality);
  const peerName = useCallStore((s) => (s.peer ? publicName(s.peer) : null));

  let chip: ReactNode = null;
  let key = 'none';
  if (reconnecting) {
    key = 'reconnecting';
    chip = (
      <NightChip
        tone="highlight"
        onVideo={onVideo}
        label="Reconnecting…"
        leading={<WifiOff size={13} color={onVideo ? palette.white : colors.highlight} strokeWidth={2.3} />}
      />
    );
  } else if (quality === 'weak' || quality === 'lost') {
    key = 'weak';
    chip = <NightChip onVideo={onVideo} label="Your connection is weak" leading={<SignalLow size={13} color={chipInk(onVideo)} strokeWidth={2.3} />} />;
  } else if ((peerQuality === 'weak' || peerQuality === 'lost') && peerName) {
    key = 'peer-weak';
    chip = <NightChip onVideo={onVideo} label={`${peerName}’s connection is weak`} leading={<SignalLow size={13} color={chipInk(onVideo)} strokeWidth={2.3} />} />;
  }
  if (!chip) return null;
  return (
    <Animated.View key={key} entering={FadeIn.duration(220)} exiting={FadeOut.duration(180)}>
      {chip}
    </Animated.View>
  );
}

/**
 * Top of a live call: minimize on the left, the privacy chip in the middle, signal bars on the
 * right, and the link notice beneath. `children` (name, timer) follow on video layouts.
 */
export function LiveHeader({ onVideo, onMinimize, children }: { onVideo: boolean; onMinimize: () => void; children?: ReactNode }) {
  const live = useLiveInsets();
  const quality = useCallStore((s) => s.quality);
  return (
    <View pointerEvents="box-none" style={[styles.header, { paddingTop: live.header }]}>
      <View pointerEvents="box-none" style={styles.topRow}>
        <PressableScale
          to={0.92}
          accessibilityLabel="Minimize call"
          accessibilityHint="Keeps the call going while you use the app"
          onPress={onMinimize}
          style={[styles.side, styles.minimize, onVideo ? styles.videoMinimize : LIGHT_SURFACE]}>
          <ChevronDown size={22} color={onVideo ? palette.white : colors.ink} strokeWidth={2.2} />
        </PressableScale>
        <PrivacyLine onVideo={onVideo} />
        <View style={styles.side}>
          <SignalBars quality={quality} onVideo={onVideo} />
        </View>
      </View>
      <LinkNotice onVideo={onVideo} />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { position: 'absolute', left: 0, right: 0, top: 0, alignItems: 'center', gap: space[3], paddingHorizontal: gutter },
  topRow: { alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  side: { width: SIDE, height: SIDE, alignItems: 'center', justifyContent: 'center' },
  minimize: { borderRadius: SIDE / 2 },
  videoMinimize: { backgroundColor: VIDEO_GLASS },
});
