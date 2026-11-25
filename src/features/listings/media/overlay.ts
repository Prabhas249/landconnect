import { setStatusBarStyle } from 'expo-status-bar';
import { useEffect, useRef } from 'react';
import { BackHandler } from 'react-native';

/** Window-space rectangle a fullscreen viewer grows out of and shrinks back into. */
export type OriginRect = { x: number; y: number; width: number; height: number };

// Viewers can stack (photo viewer → 360° view), so the light status bar is reference-counted.
let lightHolders = 0;

/**
 * Shared behaviour of the in-screen fullscreen viewers: light status bar while open and the
 * Android back button closes the top-most viewer instead of leaving the listing.
 */
export function useOverlayChrome(onBack: () => void) {
  const back = useRef(onBack);
  useEffect(() => {
    back.current = onBack;
  });

  useEffect(() => {
    lightHolders += 1;
    setStatusBarStyle('light', true);
    // Registered last, so it runs first: the newest viewer handles back.
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      back.current();
      return true;
    });
    return () => {
      sub.remove();
      lightHolders = Math.max(0, lightHolders - 1);
      if (lightHolders === 0) setStatusBarStyle('dark', true);
    };
  }, []);
}
