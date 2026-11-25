import { AndroidAudioTypePresets, AudioSession } from '@livekit/react-native';
import { permissions as rtcPermissions } from '@livekit/react-native-webrtc';
import { getRecordingPermissionsAsync, requestRecordingPermissionsAsync } from 'expo-audio';
import {
  ConnectionQuality,
  DisconnectReason,
  Room,
  RoomEvent,
  Track,
  VideoPresets,
  createLocalVideoTrack,
  type LocalVideoTrack,
  type Participant,
  type RemoteParticipant,
} from 'livekit-client';
import { PermissionsAndroid, Platform } from 'react-native';

import { fetchLiveKitToken } from '@/data/calls';

/**
 * Media plane of a call: runtime permissions, the native audio session and one
 * LiveKit `Room` per call. Signalling (the `calls` row) lives in `signal.ts`; the
 * store in `call-store.ts` decides *when* media starts and stops, this file only
 * knows *how*. Every method is safe to call after `dispose()`.
 */

export type Facing = 'user' | 'environment';

/** LiveKit's connection quality, collapsed to what the call UI shows. */
export type LinkQuality = 'good' | 'weak' | 'lost' | 'unknown';

function linkQuality(q: ConnectionQuality): LinkQuality {
  if (q === ConnectionQuality.Excellent || q === ConnectionQuality.Good) return 'good';
  if (q === ConnectionQuality.Poor) return 'weak';
  if (q === ConnectionQuality.Lost) return 'lost';
  return 'unknown';
}

const CAPTURE = VideoPresets.h720.resolution;

// ── permissions

export type Grants = { mic: boolean; camera: boolean };

let permissionChain: Promise<void> = Promise.resolve();

/**
 * Android needs explicit runtime grants before WebRTC can open the devices.
 * iOS prompts on first use; we ask for the microphone up front (via expo-audio)
 * so a denial is caught before connecting, and let the camera prompt appear when
 * LiveKit opens it.
 */
export function requestCallPermissions(camera: boolean): Promise<Grants> {
  // Android rejects overlapping permission dialogs, and the ringing pre-check can overlap the
  // connect step when the callee answers fast — so requests queue. A granted repeat returns at once.
  const run = permissionChain.then(() => askPermissions(camera));
  permissionChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function askPermissions(camera: boolean): Promise<Grants> {
  if (Platform.OS === 'android') {
    const { RECORD_AUDIO, CAMERA } = PermissionsAndroid.PERMISSIONS;
    try {
      const result = await PermissionsAndroid.requestMultiple(camera ? [RECORD_AUDIO, CAMERA] : [RECORD_AUDIO]);
      const granted = PermissionsAndroid.RESULTS.GRANTED;
      return { mic: result[RECORD_AUDIO] === granted, camera: camera && result[CAMERA] === granted };
    } catch {
      return { mic: false, camera: false };
    }
  }
  let mic = true;
  try {
    mic = (await requestRecordingPermissionsAsync()).granted;
  } catch {
    // Fall through: getUserMedia will prompt and report a failure if needed.
  }
  return { mic, camera };
}

/** Re-checks the microphone grant without showing a dialog (used when returning from Settings). */
export async function hasMicPermission(): Promise<boolean> {
  try {
    if (Platform.OS === 'android') return await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
    return (await getRecordingPermissionsAsync()).granted;
  } catch {
    return false;
  }
}

/** Is the camera already granted? Never shows a dialog (used to preview a ringing video call). */
export async function hasCameraPermission(): Promise<boolean> {
  try {
    if (Platform.OS === 'android') return await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.CAMERA);
    return (await rtcPermissions.query({ name: 'camera' })) === rtcPermissions.RESULT.GRANTED;
  } catch {
    return false;
  }
}

export async function requestCameraPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  try {
    const status = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA);
    return status === PermissionsAndroid.RESULTS.GRANTED;
  } catch {
    return false;
  }
}

// ── audio session (process-wide singleton → reference counted and serialised)

/*
 * The native audio session is global. If call A's teardown (`stop`) ran after
 * call B's start, B would go silent. All starts/stops therefore run through one
 * promise chain, and the session only really stops when the last user releases it.
 */
let audioChain: Promise<void> = Promise.resolve();
let audioUsers = 0;

function serialAudio(task: () => Promise<void>): Promise<void> {
  const run = audioChain.then(task).catch(() => {});
  audioChain = run;
  return run;
}

function acquireAudio(speakerFirst: boolean) {
  return serialAudio(async () => {
    audioUsers += 1;
    if (audioUsers > 1) return;
    try {
      await AudioSession.configureAudio({
        android: {
          // Bluetooth and wired headsets always win; otherwise video calls start on the speaker, audio calls on the earpiece.
          preferredOutputList: speakerFirst
            ? ['bluetooth', 'headset', 'speaker', 'earpiece']
            : ['bluetooth', 'headset', 'earpiece', 'speaker'],
          audioTypeOptions: AndroidAudioTypePresets.communication,
        },
        ios: { defaultOutput: speakerFirst ? 'speaker' : 'earpiece' },
      });
    } catch {}
    try {
      await AudioSession.startAudioSession();
    } catch {}
  });
}

function releaseAudio() {
  return serialAudio(async () => {
    audioUsers = Math.max(0, audioUsers - 1);
    if (audioUsers > 0) return;
    try {
      await AudioSession.stopAudioSession();
    } catch {}
  });
}

// ── outgoing video preview

const PREVIEW = VideoPresets.h540.resolution;

/** A bare camera track for the ringing background (caller and callee). Not published anywhere. */
export async function openPreview(facing: Facing = 'user'): Promise<LocalVideoTrack | null> {
  try {
    return await createLocalVideoTrack({ facingMode: facing, resolution: PREVIEW });
  } catch {
    return null;
  }
}

/** Switches the ringing preview to the other lens. */
export async function flipPreview(track: LocalVideoTrack, facing: Facing): Promise<boolean> {
  try {
    await track.restartTrack({ facingMode: facing, resolution: PREVIEW });
    return true;
  } catch {
    return false;
  }
}

export function closePreview(track: LocalVideoTrack | null) {
  if (!track) return;
  try {
    track.stop();
  } catch {}
}

/** RTCView needs the react-native-webrtc stream URL; livekit-client types it as a DOM MediaStream. */
export function streamURL(track: LocalVideoTrack | null): string | undefined {
  const stream = track?.mediaStream as unknown as { toURL?: () => string } | undefined;
  try {
    return stream?.toURL?.();
  } catch {
    return undefined;
  }
}

// ── failures

export type MediaFailureKind = 'not-configured' | 'session-ended' | 'network' | 'unknown';

export class MediaFailure extends Error {
  readonly kind: MediaFailureKind;
  constructor(kind: MediaFailureKind, message: string) {
    super(message);
    this.kind = kind;
  }
}

function classifyTokenError(e: unknown): MediaFailure {
  const message = e instanceof Error ? e.message : String(e ?? '');
  if (/not configured/i.test(message)) return new MediaFailure('not-configured', 'Calling is not configured on the server yet.');
  if (/has ended/i.test(message)) return new MediaFailure('session-ended', 'This call has already ended.');
  if (/failed to send|network|fetch/i.test(message)) return new MediaFailure('network', 'No connection. Check your network and try again.');
  if (/non-2xx/i.test(message)) return new MediaFailure('unknown', 'The call server could not be reached.');
  return new MediaFailure('unknown', message || 'The call could not be connected.');
}

// ── one LiveKit session

export type MediaEvents = {
  /** Room connected (signal + first peer connection). */
  onConnected: () => void;
  onPeerJoined: (participant: RemoteParticipant) => void;
  onPeerLeft: (participant: RemoteParticipant) => void;
  /** The room dropped for a reason other than our own `dispose()`. */
  onLost: () => void;
  /** Non-fatal problem worth a calm banner (camera busy, mic unavailable…). */
  onNotice: (message: string) => void;
  onStep: (step: 'securing' | 'joining') => void;
  /** LiveKit is re-establishing the session (true) or has recovered (false). */
  onReconnecting: (reconnecting: boolean) => void;
  onQuality: (who: 'local' | 'remote', quality: LinkQuality) => void;
};

export class CallMedia {
  readonly room: Room;
  private disposed = false;
  private holdsAudio = false;
  private facing: Facing = 'user';

  constructor(private readonly events: MediaEvents) {
    this.room = new Room({
      adaptiveStream: true,
      dynacast: true,
      videoCaptureDefaults: { facingMode: 'user', resolution: CAPTURE },
    });
    this.room
      .on(RoomEvent.Connected, this.handleConnected)
      .on(RoomEvent.ParticipantConnected, this.handleJoined)
      .on(RoomEvent.ParticipantDisconnected, this.handleLeft)
      .on(RoomEvent.Disconnected, this.handleDisconnected)
      .on(RoomEvent.Reconnecting, this.handleReconnecting)
      .on(RoomEvent.SignalReconnecting, this.handleReconnecting)
      .on(RoomEvent.Reconnected, this.handleReconnected)
      .on(RoomEvent.ConnectionQualityChanged, this.handleQuality);
  }

  get isDisposed() {
    return this.disposed;
  }

  /** Lens the next camera start uses; set before connect when the user flips the ringing preview. */
  get facingMode(): Facing {
    return this.facing;
  }

  /** The camera track is already published (flips must restart it rather than just change the preference). */
  get hasCamera() {
    return !this.disposed && !!this.room.localParticipant.getTrackPublication(Track.Source.Camera)?.videoTrack;
  }

  setFacing(facing: Facing) {
    this.facing = facing;
  }

  get remoteCount() {
    return this.disposed ? 0 : this.room.remoteParticipants.size;
  }

  private handleConnected = () => {
    if (!this.disposed) this.events.onConnected();
  };
  private handleJoined = (p: RemoteParticipant) => {
    if (!this.disposed) this.events.onPeerJoined(p);
  };
  private handleLeft = (p: RemoteParticipant) => {
    if (!this.disposed) this.events.onPeerLeft(p);
  };
  private handleDisconnected = (reason?: DisconnectReason) => {
    if (this.disposed || reason === DisconnectReason.CLIENT_INITIATED) return;
    this.events.onLost();
  };
  private handleReconnecting = () => {
    if (!this.disposed) this.events.onReconnecting(true);
  };
  private handleReconnected = () => {
    if (!this.disposed) this.events.onReconnecting(false);
  };
  private handleQuality = (quality: ConnectionQuality, participant: Participant) => {
    if (!this.disposed) this.events.onQuality(participant.isLocal ? 'local' : 'remote', linkQuality(quality));
  };

  /**
   * permissions are already granted → audio session → token → connect → publish.
   * Each await re-checks `disposed`, so hanging up mid-connect never leaves a
   * session, mic or camera running. Throws `MediaFailure` for fatal problems.
   */
  async start(callId: string, opts: { video: boolean; speaker: boolean; mic: boolean; facing: Facing }) {
    this.facing = opts.facing;
    await acquireAudio(opts.speaker);
    if (this.disposed) {
      await releaseAudio();
      return;
    }
    this.holdsAudio = true;

    this.events.onStep('securing');
    let credentials: { token: string; url: string };
    try {
      credentials = await fetchLiveKitToken(callId);
    } catch (e) {
      if (this.disposed) return;
      throw classifyTokenError(e);
    }
    if (this.disposed) return;

    this.events.onStep('joining');
    try {
      await this.room.connect(credentials.url, credentials.token, { autoSubscribe: true });
    } catch (e) {
      if (this.disposed) return;
      throw new MediaFailure('network', e instanceof Error && e.message ? 'The call could not reach the media server.' : 'Connection failed.');
    }
    if (this.disposed) {
      this.room.disconnect().catch(() => {});
      return;
    }

    if (opts.mic) {
      // Muted before connect → the mic is simply not published until the user unmutes.
      try {
        await this.room.localParticipant.setMicrophoneEnabled(true);
      } catch {
        if (!this.disposed) this.events.onNotice('Microphone unavailable. Check LandConnect’s permissions in Settings.');
      }
    }
    if (this.disposed || !opts.video) return;
    await this.setCamera(true);
  }

  async setMic(on: boolean) {
    if (this.disposed) return false;
    try {
      await this.room.localParticipant.setMicrophoneEnabled(on);
      return true;
    } catch {
      this.events.onNotice('Microphone unavailable. Check LandConnect’s permissions in Settings.');
      return false;
    }
  }

  /** Turns the camera on or off. Turning it on also covers upgrading an audio call to video. */
  async setCamera(on: boolean) {
    if (this.disposed) return false;
    try {
      if (on && !(await requestCameraPermission())) {
        this.events.onNotice('Camera access is off. Allow it in Settings to share video.');
        return false;
      }
      if (this.disposed) return false;
      await this.room.localParticipant.setCameraEnabled(on, on ? { facingMode: this.facing, resolution: CAPTURE } : undefined);
      return true;
    } catch {
      if (!this.disposed) this.events.onNotice('The camera could not be started.');
      return false;
    }
  }

  /**
   * Restarting the track with the other facing mode keeps LiveKit's own capture
   * constraints in sync, so a later camera off → on comes back on the same lens.
   */
  async flipCamera(): Promise<Facing | null> {
    if (this.disposed) return null;
    const track = this.room.localParticipant.getTrackPublication(Track.Source.Camera)?.videoTrack as
      | LocalVideoTrack
      | undefined;
    if (!track) return null;
    const next: Facing = this.facing === 'user' ? 'environment' : 'user';
    try {
      await track.restartTrack({ facingMode: next, resolution: CAPTURE });
      this.facing = next;
      return next;
    } catch {
      this.events.onNotice('Could not switch camera.');
      return null;
    }
  }

  /** Android: speaker ↔ earpiece. iOS: force speaker ↔ system route (earpiece / headset). */
  async setSpeaker(on: boolean) {
    if (this.disposed) return;
    try {
      const output = Platform.OS === 'ios' ? (on ? 'force_speaker' : 'default') : on ? 'speaker' : 'earpiece';
      await AudioSession.selectAudioOutput(output);
    } catch {}
  }

  /** Idempotent: stops capture, leaves the room, releases the audio session. */
  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.room
      .off(RoomEvent.Connected, this.handleConnected)
      .off(RoomEvent.ParticipantConnected, this.handleJoined)
      .off(RoomEvent.ParticipantDisconnected, this.handleLeft)
      .off(RoomEvent.Disconnected, this.handleDisconnected)
      .off(RoomEvent.Reconnecting, this.handleReconnecting)
      .off(RoomEvent.SignalReconnecting, this.handleReconnecting)
      .off(RoomEvent.Reconnected, this.handleReconnected)
      .off(RoomEvent.ConnectionQualityChanged, this.handleQuality);
    try {
      // stopTracks = true → microphone and camera capture end here.
      await this.room.disconnect(true);
    } catch {}
    try {
      // One Room per call: release its global listeners too.
      await this.room.dispose();
    } catch {}
    if (this.holdsAudio) {
      this.holdsAudio = false;
      await releaseAudio();
    }
  }
}
