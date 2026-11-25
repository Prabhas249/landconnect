import { Image } from 'expo-image';
import { BadgeCheck } from 'lucide-react-native';
import { useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import type { Profile } from '@/lib/types';
import { colors, font } from '@/theme/tokens';

import { Text } from './text';

/** Deterministic soft tints so a participant keeps one colour everywhere. */
const TINTS = [
  { bg: '#DDF3E8', fg: '#0F6E56' },
  { bg: '#FDF1DC', fg: '#A8660B' },
  { bg: '#E3ECFB', fg: '#2B57B8' },
  { bg: '#F5E4F1', fg: '#96397F' },
  { bg: '#E6F0D8', fg: '#52761C' },
  { bg: '#FBE6E3', fg: '#B23A2E' },
] as const;

/** The avatar sizes screens should pick from, so faces line up across the app. */
export const AVATAR_SIZE = { xs: 24, sm: 32, md: 40, lg: 52, xl: 72, xxl: 96 } as const;

function hash(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Anonymous handles look like "Buyer · B-2041". */
const HANDLE = /·\s*([A-Z])-(\d{2,})\s*$/;

export function isHandle(name: string) {
  return HANDLE.test(name);
}

export function initialsOf(name: string) {
  const parts = name
    .trim()
    .split(/\s+/)
    // Drop separators such as the "·" in a handle; Hermes has no Unicode property escapes.
    .filter((p) => /[A-Za-z0-9\u00C0-\uFFFF]/.test(p) && p !== '·');
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** "Buyer · B-2041" -> "B41": the handle's serial, set like a stamp instead of initials. */
function handleGlyph(name: string, size: number) {
  const m = HANDLE.exec(name);
  if (!m) return initialsOf(name);
  return size < 36 ? m[1] : `${m[1]}${m[2].slice(-2)}`;
}

type AvatarPerson = Pick<Profile, 'id' | 'display_name' | 'handle' | 'show_real_name' | 'avatar_url'>;

/** The photo other people may see. Anonymous members never show one: a face would undo the handle. */
export function publicAvatar(p: Pick<Profile, 'show_real_name' | 'avatar_url'> | null | undefined) {
  return p?.show_real_name ? p.avatar_url : null;
}

export type AvatarRing = 'surface' | 'canvas' | 'accent' | 'highlight' | 'night';

const RING_COLOR: Record<AvatarRing, string> = {
  surface: colors.surface,
  canvas: colors.canvas,
  accent: colors.accentBright,
  highlight: colors.highlight,
  night: colors.night,
};

export type AvatarProps = {
  /** Name to derive initials from. Optional when `profile` is given. */
  name?: string;
  /** Stable id used to pick the tint. Falls back to `name`. */
  seed?: string;
  uri?: string | null;
  /**
   * Privacy-aware shortcut: derives the public name, seed and photo from a profile,
   * so an anonymous member shows their handle glyph and never their photo.
   */
  profile?: AvatarPerson | null;
  /** Force the anonymous look (handle glyph, no photo). */
  anonymous?: boolean;
  size?: number;
  /** Green presence dot. */
  online?: boolean;
  /** `true` is the white ring for avatars that overlap imagery or each other. */
  ring?: boolean | AvatarRing;
  /** Small verified seal at the top-right. */
  verified?: boolean;
  /** Custom bottom-right badge slot (e.g. a blocked mark). Moves the presence dot to the top-right. */
  badge?: ReactNode;
  /** Colour of the surface behind the avatar, used to cut the dot and seal out of it. */
  onColor?: string;
};

/**
 * Round avatar. Initials sit underneath and the photo cross-fades in over them, so there is
 * never an empty circle while loading and a broken URL simply leaves the initials.
 * The ring is a separate outer disc rather than a border, which keeps the edge crisp on Android
 * where a bordered, clipped image can bleed over its own border.
 */
export function Avatar({
  name: nameProp,
  seed,
  uri: uriProp,
  profile,
  anonymous: anonProp,
  size = 44,
  online,
  ring,
  verified,
  badge,
  onColor = colors.surface,
}: AvatarProps) {
  const name = profile ? (profile.show_real_name ? profile.display_name : profile.handle) : (nameProp ?? '');
  // A handle as the name means the member is anonymous, whoever the caller is: never show a photo then.
  const anonymous = anonProp || (profile ? !profile.show_real_name : false) || isHandle(name);
  const uri: string | null = anonymous ? null : ((profile ? profile.avatar_url : uriProp) ?? null);

  const [failed, setFailed] = useState<string | null>(null);
  const photo = uri && failed !== uri ? uri : null;

  const tint = TINTS[hash(seed ?? profile?.id ?? name) % TINTS.length];
  const ringKind: AvatarRing | null = ring === true ? 'surface' : ring || null;
  const ringW = ringKind ? Math.max(2, Math.round(size / 28)) : 0;
  const inner = size - ringW * 2;
  const dot = Math.max(10, Math.round(size * 0.26));
  const seal = Math.max(14, Math.round(size * 0.32));
  const glyph = anonymous ? handleGlyph(name, size) : initialsOf(name);
  const glyphSize = Math.round(inner * (anonymous ? (glyph.length > 2 ? 0.28 : 0.34) : 0.36));

  return (
    <View style={{ width: size, height: size }}>
      <View
        style={[
          styles.disc,
          { width: size, height: size, borderRadius: size / 2, padding: ringW },
          ringKind ? { backgroundColor: RING_COLOR[ringKind] } : null,
        ]}>
        <View style={[styles.circle, { width: inner, height: inner, borderRadius: inner / 2, backgroundColor: tint.bg }]}>
          <Text
            style={{
              fontFamily: anonymous ? font.mono : font.semibold,
              fontSize: glyphSize,
              lineHeight: Math.round(glyphSize * 1.25),
              letterSpacing: anonymous ? 0.2 : -0.2,
              color: tint.fg,
              includeFontPadding: false,
              textAlign: 'center',
            }}>
            {glyph}
          </Text>
          {photo ? (
            <Image
              source={{ uri: photo }}
              style={[StyleSheet.absoluteFill, { borderRadius: inner / 2 }]}
              contentFit="cover"
              transition={{ duration: 260, effect: 'cross-dissolve', timing: 'ease-out' }}
              cachePolicy="memory-disk"
              recyclingKey={photo}
              onError={() => setFailed(photo)}
              accessibilityIgnoresInvertColors
            />
          ) : null}
        </View>
      </View>
      {online ? (
        <View
          style={[
            styles.dot,
            { width: dot, height: dot, borderRadius: dot / 2, borderColor: onColor },
            // The seal owns the top-right corner, so a dot displaced by a badge goes top-left.
            badge ? (verified ? { left: 0, top: 0 } : { right: 0, top: 0 }) : { right: 0, bottom: 0 },
          ]}
        />
      ) : null}
      {badge ? <View style={styles.badge}>{badge}</View> : null}
      {verified ? (
        <View
          style={[
            styles.seal,
            { width: seal, height: seal, borderRadius: seal / 2, backgroundColor: onColor, right: -seal * 0.12, top: -seal * 0.12 },
          ]}>
          <BadgeCheck size={seal - 2} color={colors.surface} fill={colors.accent} strokeWidth={2.2} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  disc: { alignItems: 'center', justifyContent: 'center' },
  circle: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  dot: {
    position: 'absolute',
    backgroundColor: colors.accentBright,
    borderWidth: 2,
  },
  badge: { position: 'absolute', right: -2, bottom: -2 },
  seal: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
});
