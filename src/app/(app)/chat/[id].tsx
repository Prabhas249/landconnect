import { useLocalSearchParams, useNavigation } from 'expo-router';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { KeyboardController } from 'react-native-keyboard-controller';

import { ThreadScreen } from '@/features/chat/thread/thread-screen';

type StackEvents = {
  addListener: (type: 'transitionStart', cb: (e: { data?: { closing?: boolean } }) => void) => () => void;
};

/**
 * Android has no interactive pop, so a keyboard left open would collapse after the slide has
 * started and the composer would jump mid-transition. Start the dismiss with the pop instead, so
 * the keyboard and the screen leave together. iOS keeps the native interactive behaviour.
 */
function useKeyboardLeavesWithScreen() {
  const navigation = useNavigation<StackEvents>();
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    return navigation.addListener('transitionStart', (e) => {
      if (e.data?.closing) KeyboardController.dismiss();
    });
  }, [navigation]);
}

export default function ChatThreadRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  useKeyboardLeavesWithScreen();
  // Keyed so switching threads in place never leaks one chat's optimistic state into another.
  return <ThreadScreen key={id} id={id} />;
}
