import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import * as Haptics from 'expo-haptics';
import { Platform, Vibration } from 'react-native';

/**
 * Ringtone (incoming) and ringback (outgoing) — synthesised by
 * `scripts/generate-call-tones.mjs`. Exactly one tone can play at a time and
 * every call into the audio stack is guarded: a sound failure must never break
 * a call, so errors are swallowed here on purpose.
 */

const SOURCES = {
  ringtone: require('../../../assets/sounds/ringtone.wav'),
  ringback: require('../../../assets/sounds/ringback.wav'),
} as const;

export type Tone = keyof typeof SOURCES;

type Playing = {
  tone: Tone;
  player: AudioPlayer | null;
  haptics: ReturnType<typeof setInterval> | null;
  stopped: boolean;
};

let current: Playing | null = null;

/** Android rings with a real vibration pattern; iOS gets a repeating double knock. */
const RING_VIBRATION = [0, 520, 380, 520, 1400];
const KNOCK_EVERY_MS = 1800;

function startRingHaptics(entry: Playing) {
  try {
    if (Platform.OS === 'android') {
      Vibration.vibrate(RING_VIBRATION, true);
      return;
    }
    const knock = () => {
      if (entry.stopped) return;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
      setTimeout(() => {
        if (!entry.stopped) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
      }, 160);
    };
    knock();
    entry.haptics = setInterval(knock, KNOCK_EVERY_MS);
  } catch {
    // Haptics are a nicety.
  }
}

export function playTone(tone: Tone) {
  if (current && !current.stopped && current.tone === tone) return;
  stopTones();

  const entry: Playing = { tone, player: null, haptics: null, stopped: false };
  current = entry;

  // The ringtone respects the ringer switch / silent mode like a phone call would
  // (the vibration still plays); the ringback is part of a call you placed, so it always plays.
  setAudioModeAsync({
    playsInSilentMode: tone === 'ringback',
    interruptionMode: 'doNotMix',
    allowsRecording: false,
    shouldPlayInBackground: false,
    shouldRouteThroughEarpiece: false,
  })
    .catch(() => {})
    .finally(() => {
      if (entry.stopped) return;
      try {
        const player = createAudioPlayer(SOURCES[tone]);
        player.loop = true;
        player.volume = tone === 'ringtone' ? 1 : 0.55;
        player.play();
        entry.player = player;
      } catch {
        // No sound, call continues.
      }
    });

  if (tone === 'ringtone') startRingHaptics(entry);
}

export function stopTones() {
  const entry = current;
  current = null;
  if (!entry || entry.stopped) return;
  entry.stopped = true;
  if (entry.haptics) clearInterval(entry.haptics);
  if (entry.tone === 'ringtone' && Platform.OS === 'android') {
    try {
      Vibration.cancel();
    } catch {}
  }
  const player = entry.player;
  entry.player = null;
  if (player) {
    try {
      player.pause();
    } catch {}
    try {
      player.remove();
    } catch {}
  }
}
