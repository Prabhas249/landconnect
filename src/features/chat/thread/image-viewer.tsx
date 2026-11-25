import { Image } from 'expo-image';
import { X } from 'lucide-react-native';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, gutter, space } from '@/theme/tokens';
import { IconButton } from '@/ui/icon-button';

/** Full-screen photo on the night surface. Tap anywhere or the close button to dismiss. */
export function ImageViewer({ uri, onClose }: { uri: string | null; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={!!uri} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close photo">
          {uri ? <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="contain" transition={200} /> : null}
        </Pressable>
        <View style={[styles.close, { top: insets.top + space[2] }]}>
          <IconButton label="Close" variant="glass" onPress={onClose}>
            <X size={20} color={colors.inkOnDark} strokeWidth={2.2} />
          </IconButton>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.night },
  close: { position: 'absolute', right: gutter },
});
