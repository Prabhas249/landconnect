import { VideoTrack, type TrackReference } from '@livekit/react-native';
import { VideoOff } from 'lucide-react-native';
import { useState, type ReactNode } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { GestureDetector, useExclusiveGestures, usePanGesture, useTapGesture } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { publicName } from '@/lib/format';
import type { Profile } from '@/lib/types';
import { colors, radius, shadow, space, spring } from '@/theme/tokens';
import { Avatar } from '@/ui/avatar';
import { Label } from '@/ui/text';

import { VIDEO_SURFACE } from './incoming-view';
import { SpeakingRings, VideoScrims } from './parts';

const PIP_W = 108;
const PIP_H = 152;
const STAGE_AVATAR = 112;

/** The peer without a camera: their avatar, with the speaking halo when a voice level is given. */
function PeerStandIn({ peer, level, small = false, caption = false }: { peer: Profile | null; level?: SharedValue<number>; small?: boolean; caption?: boolean }) {
  const size = small ? 56 : STAGE_AVATAR;
  const avatar = <Avatar name={publicName(peer)} seed={peer?.id} uri={peer?.avatar_url} size={size} />;
  return (
    <View style={styles.standIn}>
      {level && !small ? (
        <SpeakingRings size={size} level={level}>
          {avatar}
        </SpeakingRings>
      ) : (
        avatar
      )}
      {caption ? (
        <View style={styles.cameraOffLabel}>
          <VideoOff size={13} color={colors.inkOnDarkSecondary} strokeWidth={2.2} />
          <Label tone="onDarkSecondary">Camera off</Label>
        </View>
      ) : null}
    </View>
  );
}

/**
 * Picture-in-picture tile: drag anywhere, release to snap to the nearest corner on a critically
 * damped spring (velocity-projected, so a flick throws it across without overshoot). Tap swaps.
 */
function DraggablePip({ children, top, bottom, onTap }: { children: ReactNode; top: number; bottom: number; onTap: () => void }) {
  const { width, height } = useWindowDimensions();
  const minX = space[4];
  const maxX = width - PIP_W - space[4];
  const minY = top;
  const maxY = Math.max(top, height - PIP_H - bottom);

  const x = useSharedValue(maxX);
  const y = useSharedValue(minY);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);

  const pan = usePanGesture({
    onBegin: () => {
      'worklet';
      startX.set(x.get());
      startY.set(y.get());
    },
    onUpdate: (e) => {
      'worklet';
      x.set(Math.min(maxX + space[4], Math.max(minX - space[4], startX.get() + e.translationX)));
      y.set(Math.min(maxY + space[4], Math.max(minY - space[4], startY.get() + e.translationY)));
    },
    onDeactivate: (e) => {
      'worklet';
      const px = x.get() + e.velocityX * 0.12;
      const py = y.get() + e.velocityY * 0.12;
      const tx = px < (minX + maxX) / 2 ? minX : maxX;
      const ty = py < (minY + maxY) / 2 ? minY : maxY;
      x.set(withSpring(tx, { ...spring.gentle, velocity: e.velocityX }));
      y.set(withSpring(ty, { ...spring.gentle, velocity: e.velocityY }));
    },
  });

  const tap = useTapGesture({
    onActivate: () => {
      'worklet';
      scheduleOnRN(onTap);
    },
  });

  const gesture = useExclusiveGestures(pan, tap);
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: x.get() }, { translateY: y.get() }] }));

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View accessibilityRole="button" accessibilityLabel="Swap video views" style={[styles.pip, style]}>
        {children}
      </Animated.View>
    </GestureDetector>
  );
}

export type VideoStageProps = {
  remote: TrackReference | undefined;
  local: TrackReference | undefined;
  peer: Profile | null;
  /** Remote voice level (0..1) for the halo around the peer's avatar when their camera is off. */
  level: SharedValue<number>;
  /** Front camera → mirror the local feed, like a mirror. */
  mirrorLocal: boolean;
  /** Space reserved at the top (header) and bottom (controls) for the PiP to snap inside. */
  top: number;
  bottom: number;
  /** The peer is in the call: without a feed they are shown as their avatar ("Camera off"). */
  peerJoined?: boolean;
};

type Slot = { kind: 'track'; ref: TrackReference } | { kind: 'peer' };

/**
 * 1:1 video: the peer full-bleed (cover), you as a draggable PiP; tap the PiP to swap. A peer with
 * their camera off is their avatar (with the speaking halo) in the same slot. Until the peer joins,
 * your own camera fills the screen. Over the feeds only dark scrims are drawn.
 */
export function VideoStage({ remote, local, peer, level, mirrorLocal, top, bottom, peerJoined = false }: VideoStageProps) {
  const [swapped, setSwapped] = useState(false);
  const them: Slot | null = remote ? { kind: 'track', ref: remote } : peerJoined ? { kind: 'peer' } : null;
  const me: Slot | null = local ? { kind: 'track', ref: local } : null;
  const canSwap = !!them && !!me;
  const main = canSwap && swapped ? me : (them ?? me);
  const pip = canSwap ? (swapped ? them : me) : null;

  const render = (slot: Slot | null, inPip: boolean) => {
    if (!slot || slot.kind === 'peer') {
      return <PeerStandIn peer={peer} level={level} small={inPip} caption={!inPip && peerJoined} />;
    }
    const isLocal = slot.ref === local;
    return (
      // Keys include the role so swapping remounts the native views with fresh z-order.
      <VideoTrack
        key={`${inPip ? 'pip' : 'main'}-${slot.ref.publication.trackSid}`}
        trackRef={slot.ref}
        style={styles.full}
        objectFit="cover"
        mirror={isLocal && mirrorLocal}
        zOrder={inPip ? 1 : 0}
      />
    );
  };

  return (
    <View style={[StyleSheet.absoluteFill, styles.surface]}>
      {render(main, false)}
      <VideoScrims top={top + space[12]} bottom={bottom + space[16]} />
      {pip ? (
        <DraggablePip top={top} bottom={bottom} onTap={() => setSwapped((v) => !v)}>
          {render(pip, true)}
        </DraggablePip>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  surface: { backgroundColor: VIDEO_SURFACE },
  full: { flex: 1 },
  standIn: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', gap: space[6], backgroundColor: VIDEO_SURFACE },
  cameraOffLabel: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  pip: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: PIP_W,
    height: PIP_H,
    borderRadius: radius.lg,
    borderCurve: 'continuous',
    overflow: 'hidden',
    backgroundColor: VIDEO_SURFACE,
    boxShadow: shadow.float,
  },
});
