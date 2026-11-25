import { Linking, Platform } from 'react-native';

export type Destination = { lat: number; lng: number; label?: string };

/**
 * Hands turn-by-turn navigation to the phone's maps app. We deliberately do not
 * build routing in-app: the installed maps app already knows live traffic.
 *
 * Callers must pass the *public* point: for listings with a hidden location that
 * is the fuzzed point, never the true coordinates.
 */
export async function openDirections({ lat, lng, label }: Destination): Promise<boolean> {
  const point = `${lat.toFixed(6)},${lng.toFixed(6)}`;
  const universal = `https://www.google.com/maps/dir/?api=1&destination=${point}&travelmode=driving`;
  const native =
    Platform.OS === 'ios'
      ? `maps://?daddr=${point}&dirflg=d`
      : `google.navigation:q=${point}&mode=d`;

  for (const url of [native, universal]) {
    try {
      await Linking.openURL(url);
      return true;
    } catch {
      // Fall through to the next candidate (no maps app → browser).
    }
  }
  // Last resort: a plain geo pin, which any maps app can open.
  try {
    await Linking.openURL(`geo:${point}?q=${point}${label ? `(${encodeURIComponent(label)})` : ''}`);
    return true;
  } catch {
    return false;
  }
}
