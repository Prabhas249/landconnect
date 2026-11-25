import { useNavigation } from 'expo-router';
import { useEffect, useState } from 'react';

const OPEN_FALLBACK_MS = 550;

/**
 * True once the screen's push transition has finished (or after a short fallback), so heavy,
 * non-essential parts can mount after navigation instead of competing with it for frames.
 */
export function useAfterOpen(fallbackMs = OPEN_FALLBACK_MS) {
  const navigation = useNavigation<{
    addListener: (type: 'transitionEnd', cb: (e: { data?: { closing?: boolean } }) => void) => () => void;
  }>();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setOpen(true), fallbackMs);
    const off = navigation.addListener('transitionEnd', (e) => {
      if (!e.data?.closing) setOpen(true);
    });
    return () => {
      clearTimeout(timer);
      off();
    };
  }, [navigation, fallbackMs]);
  return open;
}
