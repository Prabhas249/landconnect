import { useLocalParticipant } from '@livekit/react-native';
import { Mic, MicOff, PhoneOff, SwitchCamera, Video, VideoOff, Volume2 } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import { space } from '@/theme/tokens';

import { flipCamera, toggleCamera, toggleMic, toggleSpeaker, useCallStore } from '../call-store';
import { RoundButton, roundInk } from './parts';

const ICON = 22;
const STROKE = 2.1;
const CAPTION = 18 + space[2];

export type ControlRowProps = {
  /** Mic is live (not muted). */
  mic: boolean;
  /** Camera is on, or `null` to hide the camera buttons (audio call before connect). */
  camera: boolean | null;
  /** Show the flip button even while the camera is off (disabled then) — video calls. */
  alwaysFlip?: boolean;
  speaker: boolean;
  endLabel: string;
  onEnd: () => void;
  /** Drawn over a camera feed: dark frosted circles, white captions. */
  onVideo?: boolean;
  disabled?: boolean;
};

/**
 * Mute · Speaker · Camera · Flip · End, each a round icon button with its name underneath.
 * Engaged toggles (muted, speaker on, camera on) fill — forest on light surfaces, white over
 * video — so the state is readable at a glance. End is always the calm red.
 */
export function ControlRow({ mic, camera, alwaysFlip, speaker, endLabel, onEnd, onVideo = false, disabled }: ControlRowProps) {
  const micTone = mic ? 'glass' : 'on';
  const camTone = camera ? 'on' : 'glass';
  const spkTone = speaker ? 'on' : 'glass';
  const ink = (tone: 'glass' | 'on') => roundInk(tone, onVideo);
  const showFlip = camera !== null && (camera || alwaysFlip);
  // Five buttons must still fit a 360 dp screen inside the gutters.
  const crowded = camera !== null && !!showFlip;
  const size = crowded ? 52 : 60;
  const common = { onVideo, size, caption: true, onDark: onVideo, disabled } as const;

  return (
    <View pointerEvents="box-none" style={[styles.row, crowded ? styles.crowded : null]}>
      <RoundButton
        {...common}
        label={mic ? 'Mute' : 'Muted'}
        tone={micTone}
        onPress={toggleMic}
        icon={mic ? <Mic size={ICON} color={ink(micTone)} strokeWidth={STROKE} /> : <MicOff size={ICON} color={ink(micTone)} strokeWidth={STROKE} />}
      />
      <RoundButton
        {...common}
        label="Speaker"
        tone={spkTone}
        onPress={toggleSpeaker}
        icon={<Volume2 size={ICON} color={ink(spkTone)} strokeWidth={STROKE} />}
      />
      {camera !== null ? (
        <RoundButton
          {...common}
          label="Camera"
          tone={camTone}
          onPress={toggleCamera}
          icon={camera ? <Video size={ICON} color={ink(camTone)} strokeWidth={STROKE} /> : <VideoOff size={ICON} color={ink(camTone)} strokeWidth={STROKE} />}
        />
      ) : null}
      {showFlip ? (
        <RoundButton
          {...common}
          label="Flip"
          disabled={disabled || !camera}
          onPress={flipCamera}
          icon={<SwitchCamera size={ICON} color={ink('glass')} strokeWidth={STROKE} />}
        />
      ) : null}
      <RoundButton
        {...common}
        label={endLabel}
        tone="danger"
        onPress={onEnd}
        icon={<PhoneOff size={ICON} color={roundInk('danger', onVideo)} strokeWidth={STROKE} />}
      />
    </View>
  );
}

/**
 * Before media is live (ringing, connecting): the row reflects the stored choices, which the
 * store applies on connect. Works outside `RoomContext`.
 */
export function PreCallControlBar({
  isVideo,
  endLabel,
  onEnd,
  onVideo,
  disabled,
}: {
  isVideo: boolean;
  endLabel: string;
  onEnd: () => void;
  onVideo?: boolean;
  disabled?: boolean;
}) {
  const wantMic = useCallStore((s) => s.wantMic);
  const wantCamera = useCallStore((s) => s.wantCamera);
  const speaker = useCallStore((s) => s.speaker);
  return (
    <ControlRow
      mic={wantMic}
      camera={isVideo ? wantCamera : null}
      alwaysFlip={isVideo}
      speaker={speaker}
      endLabel={endLabel}
      onEnd={onEnd}
      onVideo={onVideo}
      disabled={disabled}
    />
  );
}

/**
 * Live (must render inside `RoomContext`). Once media is live, mic and camera read their state
 * back from LiveKit (`useLocalParticipant`), so the buttons always show what the tracks really
 * do; while still connecting they show the stored choices. Audio calls offer the camera too:
 * turning it on upgrades the call to video for both sides.
 */
export function ControlBar({ isRoom, isVideo, onEnd, onVideo }: { isRoom: boolean; isVideo: boolean; onEnd: () => void; onVideo?: boolean }) {
  const { isMicrophoneEnabled, isCameraEnabled } = useLocalParticipant();
  const live = useCallStore((s) => s.mediaLive);
  const wantMic = useCallStore((s) => s.wantMic);
  const wantCamera = useCallStore((s) => s.wantCamera);
  const speaker = useCallStore((s) => s.speaker);
  return (
    <ControlRow
      mic={live ? isMicrophoneEnabled : wantMic}
      camera={live ? isCameraEnabled : wantCamera}
      alwaysFlip={isVideo}
      speaker={speaker}
      endLabel={isRoom ? 'Leave' : 'End'}
      onEnd={onEnd}
      onVideo={onVideo}
    />
  );
}

/** Height the row occupies above the safe area (buttons + captions) — the PiP and grids keep clear of it. */
export const CONTROL_BAR_HEIGHT = 60 + CAPTION;

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'center', gap: space[4] },
  crowded: { gap: space[3] },
});
