import { useIsSpeaking, useRemoteParticipants, useTrackVolume, useTracks, type TrackReference } from '@livekit/react-native';
import { StatusBar } from 'expo-status-bar';
import { Track, type Participant } from 'livekit-client';
import { MicOff } from 'lucide-react-native';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut, useSharedValue, withSpring, type SharedValue } from 'react-native-reanimated';

import { publicName } from '@/lib/format';
import type { Profile } from '@/lib/types';
import { gutter, palette, space, spring } from '@/theme/tokens';
import { Avatar } from '@/ui/avatar';
import { Text } from '@/ui/text';

import { hangUp, useCallStore } from '../call-store';
import { ControlBar } from './controls';
import { HERO_AVATAR, peerSubtitle } from './incoming-view';
import { LiveHeader, useLiveInsets } from './live-header';
import { CHIP_INK, CallBackdrop, CallTimer, IdChip, NightChip, SpeakingRings } from './parts';
import { stepLabel } from './states';
import { VideoStage } from './video-stage';

/** Drives the speaking halo from the remote voice level, falling back to LiveKit's isSpeaking. */
function VoiceLevel({ participant, micRef, level }: { participant: Participant; micRef: TrackReference | undefined; level: SharedValue<number> }) {
  const volume = useTrackVolume(micRef);
  const speaking = useIsSpeaking(participant);
  useEffect(() => {
    const target = Math.min(1, Math.max(volume * 3, speaking ? 0.35 : 0));
    level.set(withSpring(target, spring.snappy));
  }, [volume, speaking, level]);
  return null;
}

/** "Muted" under the peer, only while their microphone is off. */
function PeerMuted({ muted, onVideo }: { muted: boolean; onVideo: boolean }) {
  if (!muted) return null;
  return (
    <Animated.View entering={FadeIn.duration(220)} exiting={FadeOut.duration(180)}>
      <NightChip
        onVideo={onVideo}
        label="Muted"
        leading={<MicOff size={13} color={onVideo ? palette.white : CHIP_INK} strokeWidth={2.3} />}
      />
    </Animated.View>
  );
}

function AudioStage({ peer, level, status, since, muted }: { peer: Profile | null; level: SharedValue<number>; status: string | null; since: string | null; muted: boolean }) {
  return (
    <View style={styles.audioStage}>
      <CallBackdrop />
      <SpeakingRings size={HERO_AVATAR} level={level}>
        <View style={styles.avatarRing}>
          <Avatar name={publicName(peer)} seed={peer?.id} uri={peer?.avatar_url} size={HERO_AVATAR - 8} />
        </View>
      </SpeakingRings>
      <View style={styles.identity}>
        <Text variant="display" center numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
          {publicName(peer)}
        </Text>
        <View style={styles.metaRow}>
          {peer ? <IdChip handle={peer.handle} role={peer.role} /> : null}
          <Text variant="body" tone="secondary" numberOfLines={1}>
            {peerSubtitle(peer)}
          </Text>
        </View>
        <View style={styles.timerSlot}>
          {status ? (
            <Text variant="body" tone="secondary" center>
              {status}
            </Text>
          ) : (
            <CallTimer since={since} large />
          )}
        </View>
        <View style={styles.badgeSlot}>
          <PeerMuted muted={muted} onVideo={false} />
        </View>
      </View>
    </View>
  );
}

/**
 * Live 1:1 call. Audio calls are the calm light stage (avatar with a speaking halo); the dark video
 * stage takes over as soon as either side shares a camera — that is how an audio call upgrades to
 * video, on both phones — and hands back when both cameras are off again.
 */
export function DirectCall({ onMinimize }: { onMinimize: () => void }) {
  const call = useCallStore((s) => s.call);
  const peer = useCallStore((s) => s.peer);
  const phase = useCallStore((s) => s.phase);
  const step = useCallStore((s) => s.step);
  const peerJoined = useCallStore((s) => s.peerJoined);
  const facing = useCallStore((s) => s.facing);
  const live = useLiveInsets();
  const level = useSharedValue(0);
  const isVideoCall = call?.kind === 'video';

  const cameras = useTracks([Track.Source.Camera], { onlySubscribed: true });
  const mics = useTracks([Track.Source.Microphone], { onlySubscribed: false });
  const remote = useRemoteParticipants()[0];

  const remoteCam = cameras.find((r) => !r.participant.isLocal && !r.publication.isMuted && !!r.publication.track);
  const localCam = cameras.find((r) => r.participant.isLocal && !r.publication.isMuted && !!r.publication.track);
  const remoteMic = mics.find((r): r is TrackReference => !r.participant.isLocal && !!r.publication);
  const showVideo = isVideoCall || !!remoteCam || !!localCam;
  // Joined without a published (or with a muted) microphone reads as muted.
  const remoteMuted = !!remote && (!remoteMic || remoteMic.publication.isMuted);

  const connected = phase === 'connected';
  const status = !connected ? stepLabel(step) : !peerJoined ? `Waiting for ${publicName(peer)}…` : null;
  const since = call?.answered_at ?? null;

  return (
    <View style={styles.fill}>
      <StatusBar style={showVideo ? 'light' : 'dark'} />
      {remote ? <VoiceLevel participant={remote} micRef={remoteMic} level={level} /> : null}
      {showVideo ? (
        <VideoStage
          remote={remoteCam}
          local={localCam}
          peer={peer}
          level={level}
          mirrorLocal={facing === 'user'}
          top={live.top + space[8]}
          bottom={live.bottom}
          peerJoined={peerJoined && connected}
        />
      ) : (
        <AudioStage peer={peer} level={level} status={status} since={since} muted={remoteMuted && peerJoined} />
      )}

      <LiveHeader onVideo={showVideo} onMinimize={onMinimize}>
        {showVideo ? (
          <View style={styles.videoIdentity}>
            <Text variant="heading" tone="onDark" numberOfLines={1}>
              {publicName(peer)}
            </Text>
            {status ? (
              <Text variant="caption" tone="onDark">
                {status}
              </Text>
            ) : (
              <CallTimer since={since} tone="onDark" />
            )}
            <PeerMuted muted={remoteMuted && peerJoined} onVideo />
          </View>
        ) : null}
      </LiveHeader>

      <View pointerEvents="box-none" style={[styles.controls, { paddingBottom: live.controls }]}>
        <ControlBar isRoom={false} isVideo={isVideoCall} onEnd={hangUp} onVideo={showVideo} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  audioStage: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space[8], paddingHorizontal: gutter },
  avatarRing: {
    width: HERO_AVATAR,
    height: HERO_AVATAR,
    borderRadius: HERO_AVATAR / 2,
    padding: 4,
    backgroundColor: palette.white,
    boxShadow: '0 1px 2px rgba(16,32,28,0.04), 0 16px 36px rgba(16,32,28,0.12)',
  },
  identity: { alignItems: 'center', gap: space[2] },
  videoIdentity: { alignItems: 'center', gap: space[1] },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  timerSlot: { minHeight: 32, marginTop: space[2], justifyContent: 'center' },
  badgeSlot: { minHeight: 30, justifyContent: 'center' },
  controls: { position: 'absolute', left: 0, right: 0, bottom: 0 },
});
