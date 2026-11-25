import { GeistMono_600SemiBold } from '@expo-google-fonts/geist-mono/600SemiBold';
import { Canvas, Text as SkText, useFont, type SkFont } from '@shopify/react-native-skia';
import { Image } from 'expo-image';
import { CircleCheck, LockKeyhole, PhoneOff } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useDerivedValue, type SharedValue } from 'react-native-reanimated';

import { colors, font, gutter, palette, radius, shadow, space, type } from '@/theme/tokens';
import { Label, Text } from '@/ui/text';

import { CALL_CARD } from './scene';
import { BEAT, beat, clamp01, critical, easeOut, parallax, persistAfterTalk, type Beat } from './timeline';

/**
 * The two people in the deal. On the call they are anonymous IDs, exactly as the product shows
 * them; their real names appear at the end of the call, once both sides have consented.
 */
const PEOPLE = [
  {
    role: 'Buyer',
    handle: 'B-2041',
    name: 'Arjun Rao',
    photo: require('../../../assets/images/onboarding/person-buyer.jpg'),
    /** Where the eyes sit in the square photo, as a fraction of its height (the mask covers them). */
    eyes: 0.42,
  },
  {
    role: 'Owner',
    handle: 'L-0188',
    name: 'Lakshmi Gowda',
    photo: require('../../../assets/images/onboarding/person-seller.jpg'),
    eyes: 0.52,
  },
] as const;

/** The call's length as shown, compressed into the beat: 00:00 → 02:40. */
const CALL_SECONDS = 160;
const TIMER_SIZE = 15;
const TIMER_W = 48;
const TIMER_H = 20;
const PORTRAIT = CALL_CARD.portrait;
const BLOCK_W = 150;
const NAME_H = 22;
const BAR_COUNT = 9;
const BAR_W = 3;
const BAR_GAP = 4;
const BAR_H = 22;
const BADGE = 18;
const CHIP_H = 22;
/** How far the card drifts past the land mid-transition, for a little depth. */
const PARALLAX = 10;

/** 0 on step 1, rising as the reader arrives at step 2, held through step 3. */
function onStage(p: number) {
  'worklet';
  return clamp01((p - 0.4) * 2.5);
}

/** The card itself (and everything that is only about the call) dissolves as the reader leaves step 2. */
function cardStage(p: number) {
  'worklet';
  return onStage(p) * (1 - clamp01((p - 1) * 1.8));
}

export type CallCardProps = {
  width: number;
  /** Top of the card in hero coordinates (see `callCardTop`). */
  top: number;
  progress: SharedValue<number>;
  talk: SharedValue<number>;
  /** Ambient loop, 0..1, for the voice levels. */
  clock: SharedValue<number>;
  /** Reduced motion: no speaking pulse (the clock is still). */
  reduced?: boolean;
};

/**
 * Step 2's in-call card, and the identity chips it leaves behind on step 3. The two participants
 * never leave: at the end of the call they come into focus with their real names, then the card
 * dissolves around them and they step back while the plot is measured.
 */
export function CallCard({ width, top, progress, talk, clock, reduced = false }: CallCardProps) {
  const T = BEAT.connect;
  const left = gutter;
  const w = width - gutter * 2;
  const centres = [left + w * 0.22, left + w * 0.78];
  const portraitTop = top + CALL_CARD.portraitTop;
  const rowTop = portraitTop + PORTRAIT + space[2] + NAME_H + space[3];

  const bgStyle = useAnimatedStyle(() => {
    const p = progress.get();
    const t = easeOut(beat(talk.get(), T.card));
    const shown = Math.max(t, persistAfterTalk(p));
    return {
      opacity: shown * cardStage(p),
      transform: [{ translateY: (1 - shown) * space[6] }, { scale: 0.96 + 0.04 * shown }],
    };
  });
  const privateStyle = useAnimatedStyle(() => {
    const p = progress.get();
    return { opacity: Math.max(easeOut(beat(talk.get(), T.privateLine)), persistAfterTalk(p)) * cardStage(p) };
  });
  const callT = useDerivedValue(() => Math.max(beat(talk.get(), T.call), persistAfterTalk(progress.get())));
  const consentT = useDerivedValue(() => Math.max(easeOut(beat(talk.get(), T.consent)), persistAfterTalk(progress.get())));
  // The call row gives way to the consent line once names are revealed.
  const callRowStyle = useAnimatedStyle(() => ({
    opacity: clamp01(callT.get() * 8) * cardStage(progress.get()) * (1 - consentT.get()),
  }));
  const trackStyle = useAnimatedStyle(() => ({ transform: [{ scaleX: callT.get() }] }));
  const consentStyle = useAnimatedStyle(() => {
    const t = consentT.get() * onStage(progress.get());
    return { opacity: t, transform: [{ translateY: (1 - t) * space[2] }] };
  });
  const voice = useDerivedValue(() => clamp01(callT.get() * 8) * cardStage(progress.get()));
  // Who is speaking pulses softly while the line is open; it stops once the call ends.
  const speaking = useDerivedValue(() => (reduced ? 0 : voice.get() * (1 - consentT.get())));
  const hiddenStyle = useAnimatedStyle(() => {
    const p = progress.get();
    const t = Math.max(beat(talk.get(), T.numberHidden), persistAfterTalk(p));
    const c = critical(t);
    return {
      opacity: clamp01(t * 1.8) * cardStage(p),
      transform: [{ translateY: (1 - c) * space[1] }, { scale: 0.9 + 0.1 * c }],
    };
  });
  // The whole layer drifts a few points past the land while the camera moves; still at rest.
  const driftStyle = useAnimatedStyle(() => ({ transform: [{ translateX: -parallax(progress.get()) * PARALLAX }] }));

  return (
    <Animated.View style={[StyleSheet.absoluteFill, driftStyle]} pointerEvents="none">
      <Animated.View style={[styles.card, { left, top, width: w, height: CALL_CARD.h }, bgStyle]} />

      <Animated.View style={[styles.privateRow, { left, top: top + 14, width: w }, privateStyle]}>
        <LockKeyhole size={11} color={colors.accent} strokeWidth={2.4} />
        <Label tone="secondary">Private line</Label>
      </Animated.View>

      <Waveform x={left + w / 2} y={portraitTop + PORTRAIT / 2} clock={clock} level={voice} />

      {PEOPLE.map((person, i) => (
        <Participant
          key={person.handle}
          index={i}
          x={centres[i] - BLOCK_W / 2}
          y={portraitTop}
          progress={progress}
          talk={talk}
          appear={T.portraits[i]}
          label={T.handles[i]}
          clock={clock}
          speaking={speaking}
        />
      ))}

      <Animated.View style={[styles.callRow, { left: left + CALL_CARD.pad, top: rowTop, width: w - CALL_CARD.pad * 2 }, callRowStyle]}>
        <Timer value={callT} />
        <View style={styles.track}>
          <Animated.View style={[styles.trackFill, trackStyle]} />
        </View>
      </Animated.View>

      <Animated.View style={[styles.consentRow, { left, top: rowTop, width: w }, consentStyle]}>
        <CircleCheck size={13} color={colors.accent} strokeWidth={2.4} />
        <Label tone="accent">Shared with consent</Label>
      </Animated.View>

      {/* Straddles the card's top edge, clear of the private-line label. */}
      <Animated.View style={[styles.hiddenChip, { right: gutter + CALL_CARD.pad, top: top - CHIP_H / 2 }, hiddenStyle]}>
        <LockKeyhole size={10} color={colors.inkSecondary} strokeWidth={2.4} />
        <Text style={styles.hiddenText}>Number hidden</Text>
      </Animated.View>
    </Animated.View>
  );
}

/* ------------------------------------------------------------------ */

function Participant({
  index,
  x,
  y,
  progress,
  talk,
  appear,
  label,
  clock,
  speaking,
}: {
  index: number;
  x: number;
  y: number;
  progress: SharedValue<number>;
  talk: SharedValue<number>;
  appear: Beat;
  label: Beat;
  clock: SharedValue<number>;
  speaking: SharedValue<number>;
}) {
  const person = PEOPLE[index];

  // A soft ring breathes out from the portrait; the two sides take turns, half a beat apart.
  const pulseStyle = useAnimatedStyle(() => {
    const phase = (clock.get() * 2 + index * 0.5) % 1;
    return {
      opacity: speaking.get() * (1 - phase) * 0.55,
      transform: [{ scale: 1 + 0.22 * phase }],
    };
  });

  // Revealed at the end of the call; stays revealed on step 3.
  const reveal = useDerivedValue(() => Math.max(easeOut(beat(talk.get(), BEAT.connect.reveal)), persistAfterTalk(progress.get())));
  const names = useDerivedValue(() => Math.max(easeOut(beat(talk.get(), BEAT.connect.names)), persistAfterTalk(progress.get())));

  const blockStyle = useAnimatedStyle(() => {
    const p = progress.get();
    const t = Math.max(easeOut(beat(talk.get(), appear)), persistAfterTalk(p));
    // On step 3 the (now named) pair steps back while the plot is measured and sealed.
    const back = clamp01((p - 1) * 1.6);
    return {
      opacity: t * onStage(p) * (1 - 0.45 * back),
      transform: [{ translateY: (1 - t) * space[3] }, { scale: (0.9 + 0.1 * t) * (1 - 0.12 * back) }],
    };
  });
  const handleStyle = useAnimatedStyle(() => {
    const t = Math.max(easeOut(beat(talk.get(), label)), persistAfterTalk(progress.get()));
    return { opacity: t * (1 - names.get()), transform: [{ translateY: -names.get() * space[1] }] };
  });
  const nameStyle = useAnimatedStyle(() => ({
    opacity: names.get(),
    transform: [{ translateY: (1 - names.get()) * space[1] }],
  }));
  const blurStyle = useAnimatedStyle(() => ({ opacity: 1 - reveal.get() }));
  const maskStyle = useAnimatedStyle(() => ({
    opacity: 1 - reveal.get(),
    transform: [{ translateX: reveal.get() * PORTRAIT * 0.6 }],
  }));

  return (
    <Animated.View style={[styles.block, { left: x, top: y }, blockStyle]}>
      <Animated.View style={[styles.pulse, pulseStyle]} />
      <View style={styles.portrait}>
        <Image source={person.photo} style={StyleSheet.absoluteFill} contentFit="cover" />
        {/* The same photo, out of focus, over the sharp one: revealing is just a fade. */}
        <Animated.View style={[StyleSheet.absoluteFill, blurStyle]}>
          <Image source={person.photo} style={StyleSheet.absoluteFill} contentFit="cover" blurRadius={10} />
        </Animated.View>
        <Animated.View style={[styles.mask, { top: PORTRAIT * person.eyes - PORTRAIT * 0.1 }, maskStyle]} />
      </View>
      <View style={styles.badge}>
        <PhoneOff size={10} color={colors.inkOnDark} strokeWidth={2.4} />
      </View>
      <View style={styles.nameBox}>
        <Animated.View style={[styles.handleRow, handleStyle]}>
          <Label tone="tertiary">{person.role}</Label>
          <Text style={styles.handle}>{person.handle}</Text>
        </Animated.View>
        <Animated.View style={[styles.nameRow, nameStyle]}>
          <Text variant="bodyStrong" numberOfLines={1}>
            {person.name}
          </Text>
        </Animated.View>
      </View>
    </Animated.View>
  );
}

/* ------------------------------------------------------------------ */

/** Voice levels between the two people: nine soft bars, alive only while the line is open. */
function Waveform({ x, y, clock, level }: { x: number; y: number; clock: SharedValue<number>; level: SharedValue<number> }) {
  const width = BAR_COUNT * BAR_W + (BAR_COUNT - 1) * BAR_GAP;
  return (
    <View style={[styles.wave, { left: x - width / 2, top: y - BAR_H / 2, width }]}>
      {Array.from({ length: BAR_COUNT }, (_, i) => (
        <Bar key={i} index={i} clock={clock} level={level} />
      ))}
    </View>
  );
}

function Bar({ index, clock, level }: { index: number; clock: SharedValue<number>; level: SharedValue<number> }) {
  // Taller in the middle, like a voice between two people.
  const frame = 0.45 + 0.55 * Math.sin((Math.PI * (index + 0.5)) / BAR_COUNT);
  const style = useAnimatedStyle(() => {
    const phase = clock.get() * Math.PI * 2;
    const v = 0.35 + 0.65 * Math.abs(Math.sin(phase * 2 + index * 0.8) * Math.cos(phase + index * 0.37));
    return { opacity: level.get(), transform: [{ scaleY: 0.15 + 0.85 * frame * v * level.get() }] };
  });
  return <Animated.View style={[styles.bar, style]} />;
}

/* ------------------------------------------------------------------ */

/**
 * Call time as one string in Geist Mono: every character has the same advance, so the readout is
 * tight ("00:12") and never shifts while it counts. (Per-digit slots with a proportional face left
 * narrow digits like "1" sitting off-centre — "00:1 2".)
 */
function Timer({ value }: { value: SharedValue<number> }) {
  const f = useFont(GeistMono_600SemiBold, TIMER_SIZE);
  if (!f) return <View style={styles.timer} />;
  return <TimerText font={f} value={value} />;
}

function TimerText({ font: f, value }: { font: SkFont; value: SharedValue<number> }) {
  const b = f.measureText('0');
  const baseline = TIMER_H / 2 - (b.y + b.height / 2);
  const text = useDerivedValue(() => {
    const s = Math.floor(CALL_SECONDS * value.get());
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m < 10 ? '0' : ''}${m}:${r < 10 ? '0' : ''}${r}`;
  });
  return (
    <Canvas style={styles.timer}>
      <SkText x={0} y={baseline} text={text} font={f} color={colors.ink} />
    </Canvas>
  );
}

const styles = StyleSheet.create({
  card: {
    position: 'absolute',
    borderRadius: radius.xl,
    borderCurve: 'continuous',
    backgroundColor: colors.surface,
    boxShadow: shadow.float,
  },
  privateRow: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[1],
  },
  block: { position: 'absolute', width: BLOCK_W, alignItems: 'center', gap: space[2] },
  portrait: {
    width: PORTRAIT,
    height: PORTRAIT,
    borderRadius: PORTRAIT / 2,
    overflow: 'hidden',
    backgroundColor: colors.surfaceSunken,
  },
  mask: {
    position: 'absolute',
    left: PORTRAIT * 0.14,
    width: PORTRAIT * 0.72,
    height: PORTRAIT * 0.2,
    borderRadius: PORTRAIT * 0.1,
    backgroundColor: palette.forest,
  },
  badge: {
    position: 'absolute',
    top: PORTRAIT - BADGE + 2,
    left: BLOCK_W / 2 + PORTRAIT / 2 - BADGE + 2,
    width: BADGE,
    height: BADGE,
    borderRadius: BADGE / 2,
    borderWidth: 2,
    borderColor: colors.surface,
    backgroundColor: palette.forest,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pulse: {
    position: 'absolute',
    top: 0,
    left: BLOCK_W / 2 - PORTRAIT / 2,
    width: PORTRAIT,
    height: PORTRAIT,
    borderRadius: PORTRAIT / 2,
    borderWidth: 2,
    borderColor: colors.accentBright,
  },
  hiddenChip: {
    position: 'absolute',
    height: CHIP_H,
    paddingHorizontal: space[2],
    borderRadius: CHIP_H / 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1],
    backgroundColor: colors.surface,
    boxShadow: shadow.card,
  },
  hiddenText: { fontFamily: font.medium, fontSize: 11, lineHeight: 14, color: colors.inkSecondary },
  nameBox: { height: NAME_H, alignSelf: 'stretch' },
  handleRow: {
    ...StyleSheet.absoluteFill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[1],
  },
  // The only mono text on the card: the handle, exactly as the product shows it.
  handle: { fontFamily: font.mono, fontSize: type.label.fontSize, lineHeight: type.label.lineHeight, color: colors.ink },
  nameRow: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  wave: { position: 'absolute', height: BAR_H, flexDirection: 'row', alignItems: 'center', gap: BAR_GAP },
  bar: { width: BAR_W, height: BAR_H, borderRadius: BAR_W / 2, backgroundColor: colors.accentBright },
  callRow: { position: 'absolute', height: TIMER_H, flexDirection: 'row', alignItems: 'center', gap: space[3] },
  timer: { width: TIMER_W, height: TIMER_H },
  track: { flex: 1, height: 3, borderRadius: radius.pill, overflow: 'hidden', backgroundColor: colors.surfaceSunken },
  trackFill: { ...StyleSheet.absoluteFill, backgroundColor: colors.accent, transformOrigin: 'left' },
  consentRow: {
    position: 'absolute',
    height: TIMER_H,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[1],
  },
});
