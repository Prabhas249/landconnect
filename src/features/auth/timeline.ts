import { useEffect } from 'react';
import {
  cancelAnimation,
  Easing,
  useAnimatedReaction,
  useDerivedValue,
  useSharedValue,
  withDelay,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

/* ------------------------------------------------------------------ */
/* Beat sheet                                                           */
/* ------------------------------------------------------------------ */

/**
 * Every beat of the welcome story, in ms on its own panel's clock. A beat is [start, duration].
 * Each panel's clock starts at 0 when the pager lands on it and resets once the panel is fully
 * out of view, so every arrival (including a swipe back) plays the sequence from the top.
 * Three steps, matching the name: Find → Connect → Buy. Each runs ~3–3.5 s, then glides on.
 */
export const BEAT = {
  find: {
    /**
     * Verified parcels surface on the map one after another (screen order Kanakapura, chosen,
     * Hoskote), each followed by its round photo. Indexed by listing (0 = the chosen one).
     */
    disc: [
      [250, 420],
      [100, 420],
      [400, 420],
    ],
    thumb: [
      [340, 360],
      [190, 360],
      [490, 360],
    ],
    /** The buyer picks one; the others quieten. Its acreage is the step's only figure. */
    pick: [1150, 450],
    acreage: [1350, 380],
    /** A tick lands on the chosen photo, then its asking price counts up above it. */
    verified: [1250, 320],
    price: [1450, 600],
  },
  connect: {
    /** The owner shares the exact boundary: the area flows into it as the call card rises. */
    morph: [0, 650],
    wash: [300, 400],
    /** The call: the card rises, the two participants arrive 60 ms apart, then the line runs. */
    card: [350, 420],
    portraits: [
      [500, 360],
      [560, 360],
    ],
    handles: [
      [620, 320],
      [680, 320],
    ],
    privateLine: [700, 320],
    /** A small chip on the card's edge: neither side ever sees the other's phone number. */
    numberHidden: [820, 360],
    call: [850, 1350],
    /** End of the call: identities revealed — portraits come into focus, handles become names. */
    reveal: [2200, 500],
    names: [2300, 420],
    consent: [2400, 360],
  },
  buy: {
    /** First stake; each further corner follows `edgeStep` later. */
    stake: [100, 200],
    edgeStep: 380,
    /** Offset into each step at which that edge starts drawing, and how long it takes. */
    edgeDraw: [80, 320],
    area: [1500, 600],
    geotag: [1750, 500],
    /** The seal lands; the area slides beneath it and the edge labels step back. */
    seal: [2300, 450],
    settle: [2200, 450],
    check: [2500, 300],
    ring: [2340, 700],
    /** A light sweep across the seal, then the accepted offer settles in above it. */
    shimmer: [2620, 620],
    offer: [2680, 420],
  },
} as const;

export type Beat = readonly [number, number];

/** Time until each panel's final frame is complete. */
export const SEQUENCE = [2050, 2760, 3100] as const;
/** Time the finished frame is held before auto-advance moves on. The last panel holds for good. */
export const HOLD = [850, 640, 0] as const;
export const TOTAL = [SEQUENCE[0] + HOLD[0], SEQUENCE[1] + HOLD[1], SEQUENCE[2] + HOLD[2]] as const;
export const LAST_PANEL = 2;

/** A panel's clock starts once the pager is this close to it — the last few frames of the camera move. */
const ARRIVE = 0.06;
/** Beyond this distance a panel's layer is fully faded out, so it can be rewound unseen. */
export const RESET_DISTANCE = 0.64;
const ADVANCE_MS = 900;
/** After a touch lands on a panel that has already finished, wait this long before moving on. */
const RESUME_DELAY = 700;
/** How close to a whole panel the pager must be for auto-advance to fire. */
const SETTLED = 0.02;
/**
 * The story's one camera curve: a quick, decisive start that glides to rest. Copy, camera and
 * auto-advance all use it, so the whole story moves as one.
 */
export const GLIDE = Easing.bezier(0.2, 0, 0, 1);
export const GLIDE_MS = ADVANCE_MS;
const advanceEasing = GLIDE;

/* ------------------------------------------------------------------ */
/* Worklet helpers                                                      */
/* ------------------------------------------------------------------ */

export function clamp01(v: number) {
  'worklet';
  return Math.min(1, Math.max(0, v));
}

/** Linear 0..1 progress of a beat. */
export function beat(t: number, b: Beat) {
  'worklet';
  return clamp01((t - b[0]) / b[1]);
}

export function easeOut(x: number) {
  'worklet';
  const k = 1 - x;
  return 1 - k * k * k;
}

export function easeInOut(x: number) {
  'worklet';
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

/** Ease-out with a small overshoot — reserved for things that land: the pin, the seal, the stamp. */
export function settle(x: number) {
  'worklet';
  const s = 1.45;
  const k = x - 1;
  return 1 + (s + 1) * k * k * k + s * k * k;
}

/**
 * A critically damped spring sampled over a beat: as fast as possible to rest, never past it.
 * x(t) = 1 − (1 + ωt)·e^(−ωt), normalised so it lands exactly on 1 at the end of the beat.
 */
export function critical(x: number) {
  'worklet';
  const w = 7;
  const t = clamp01(x);
  const end = 1 - (1 + w) * Math.exp(-w);
  return (1 - (1 + w * t) * Math.exp(-w * t)) / end;
}

/**
 * 0 on a whole panel, peaking halfway between two: lets floating layers drift a few points past
 * the land while the camera moves, for a little depth, and sit exactly in place once it rests.
 */
export function parallax(p: number) {
  'worklet';
  const f = p - Math.floor(p);
  return Math.sin(Math.PI * f);
}

/**
 * Keeps a panel-1 element on screen once the story has moved past panel 1. Its own clock is
 * rewound while the reader is on later panels; this stops the shared plot and card vanishing.
 */
export function persistAfterDiscover(p: number) {
  'worklet';
  return clamp01((p - 0.1) * 3);
}

/** Keeps what step 2 established (the exact boundary, the revealed participants) once the reader moves on. */
export function persistAfterTalk(p: number) {
  'worklet';
  return clamp01((p - 1.1) * 3);
}

/* ------------------------------------------------------------------ */
/* Timeline hook                                                        */
/* ------------------------------------------------------------------ */

export type StoryTimeline = {
  /** One clock (ms) per panel. */
  clocks: [SharedValue<number>, SharedValue<number>, SharedValue<number>];
  /** Segmented progress value: whole panels behind, plus the playback of the current one. */
  fill: SharedValue<number>;
  /** Worklet: a finger is down. Clocks freeze where they are and auto-advance waits. */
  hold: () => void;
  /** Worklet: the finger lifted. Clocks carry on from where they froze and autoplay resumes. */
  release: () => void;
};

/**
 * Drives the welcome story's beats from the pager position, entirely on the UI thread.
 *
 * Each panel's clock runs 0 → TOTAL[k] once the pager lands on it. When it completes it marks the
 * panel `due`; the advance itself fires from `tryAdvance`, which is retried on every pager change
 * and on every release, so an advance that could not happen at the clock's last frame (a finger
 * down, a spring still settling) is deferred, never dropped. Touches pause autoplay; they never
 * switch it off. The last panel holds on its final frame with the CTA.
 */
export function useStoryTimeline({
  progress,
  reduced,
  ready,
}: {
  progress: SharedValue<number>;
  reduced: boolean;
  /** The canvas has been measured and mounted; nothing should play before it can be seen. */
  ready: boolean;
}): StoryTimeline {
  const c0 = useSharedValue(reduced ? TOTAL[0] : 0);
  const c1 = useSharedValue(reduced ? TOTAL[1] : 0);
  const c2 = useSharedValue(reduced ? TOTAL[2] : 0);
  /** Bit k set while panel k's clock has been started and not yet rewound. */
  const armed = useSharedValue(0);
  const live = useSharedValue(false);
  /** A finger is on the story. */
  const held = useSharedValue(false);
  /** Panel whose clock has finished and is waiting to move on, or -1. */
  const due = useSharedValue(-1);

  useEffect(() => {
    if (reduced) {
      // Final frames everywhere, no clocks, no auto-advance.
      [c0, c1, c2].forEach((v) => cancelAnimation(v));
      c0.set(TOTAL[0]);
      c1.set(TOTAL[1]);
      c2.set(TOTAL[2]);
      live.set(false);
      return;
    }
    live.set(ready);
  }, [reduced, ready, c0, c1, c2, live]);

  const clockOf = (k: number) => {
    'worklet';
    return k === 0 ? c0 : k === 1 ? c1 : c2;
  };

  const tryAdvance = (delay = 0) => {
    'worklet';
    const k = due.get();
    if (k < 0 || held.get() || !live.get()) return;
    // Only from a settled panel; a moving pager retries this on its next frame.
    if (Math.abs(progress.get() - k) > SETTLED) return;
    due.set(-1);
    if (k >= LAST_PANEL) return;
    const glide = withTiming(k + 1, { duration: ADVANCE_MS, easing: advanceEasing });
    progress.set(delay > 0 ? withDelay(delay, glide) : glide);
  };

  /** Runs panel k's clock from wherever it is to the end, then marks it due. */
  const run = (k: number) => {
    'worklet';
    const clock = clockOf(k);
    const remaining = Math.max(0, TOTAL[k] - clock.get());
    clock.set(
      withTiming(TOTAL[k], { duration: remaining, easing: Easing.linear }, (finished) => {
        if (!finished) return;
        due.set(k);
        tryAdvance();
      }),
    );
  };

  useAnimatedReaction(
    () => (live.get() ? progress.get() : -10),
    (p) => {
      if (p < -5) return;
      for (let k = 0; k <= LAST_PANEL; k++) {
        const bit = 1 << k;
        const clock = clockOf(k);
        const d = Math.abs(p - k);
        if (d > RESET_DISTANCE && (armed.get() & bit) !== 0) {
          cancelAnimation(clock);
          clock.set(0);
          armed.set(armed.get() & ~bit);
          if (due.get() === k) due.set(-1);
        }
        if (d < ARRIVE && (armed.get() & bit) === 0) {
          armed.set(armed.get() | bit);
          clock.set(0);
          run(k);
        }
      }
      tryAdvance();
    },
  );

  const hold = () => {
    'worklet';
    held.set(true);
    for (let k = 0; k <= LAST_PANEL; k++) cancelAnimation(clockOf(k));
  };

  const release = () => {
    'worklet';
    held.set(false);
    if (!live.get()) return;
    for (let k = 0; k <= LAST_PANEL; k++) {
      if ((armed.get() & (1 << k)) !== 0 && clockOf(k).get() < TOTAL[k]) run(k);
    }
    // A panel that finished while the finger was down moves on after a short beat, not instantly.
    tryAdvance(RESUME_DELAY);
  };

  const fill = useDerivedValue(() => {
    const p = progress.get();
    const i = Math.min(LAST_PANEL, Math.max(0, Math.round(p)));
    const clock = i === 0 ? c0.get() : i === 1 ? c1.get() : c2.get();
    return i + clamp01(clock / TOTAL[i]);
  });

  return { clocks: [c0, c1, c2], fill, hold, release };
}
