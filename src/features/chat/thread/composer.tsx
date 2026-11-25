import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import { Camera, Plus, SendHorizontal } from 'lucide-react-native';
import { useState } from 'react';
import { Alert, StyleSheet, TextInput, View } from 'react-native';
import { KeyboardStickyView } from 'react-native-keyboard-controller';
import Animated, { interpolate, useAnimatedStyle, useDerivedValue, withSpring } from 'react-native-reanimated';

import { colors, font, gutter, radius, shadow, space, spring, type } from '@/theme/tokens';
import { IconButton } from '@/ui/icon-button';

const CONTROL = 44;
const LINE = type.body.lineHeight;
/** Centre a single line inside the 44pt well; more lines grow the well up to five. */
const INPUT_PAD_Y = (CONTROL - LINE) / 2;
const MAX_INPUT_HEIGHT = LINE * 5 + INPUT_PAD_Y * 2;

export type ComposerProps = {
  bottomInset: number;
  disabled?: boolean;
  onSend: (text: string) => void;
  onPickImage: (localUri: string) => void;
  onTyping: () => void;
};

export function Composer({ bottomInset, disabled, onSend, onPickImage, onTyping }: ComposerProps) {
  const [text, setText] = useState('');
  const hasText = text.trim().length > 0;

  // 0 = camera shortcut, 1 = send. Both live in the same slot and cross-scale, so nothing reflows.
  const mode = useDerivedValue(() => withSpring(hasText ? 1 : 0, spring.snappy));
  const sendStyle = useAnimatedStyle(() => ({
    opacity: mode.get(),
    transform: [{ scale: interpolate(mode.get(), [0, 1], [0.4, 1]) }, { rotate: `${interpolate(mode.get(), [0, 1], [-45, 0])}deg` }],
  }));
  const cameraStyle = useAnimatedStyle(() => ({
    opacity: 1 - mode.get(),
    transform: [{ scale: interpolate(mode.get(), [0, 1], [1, 0.4]) }],
  }));

  const submit = () => {
    const body = text.trim();
    if (!body) return;
    setText('');
    onSend(body);
  };

  const pickFromLibrary = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
    if (!res.canceled && res.assets[0]) onPickImage(res.assets[0].uri);
  };

  const takePhoto = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Camera access is off', 'Allow camera access in Settings to send a photo from here.');
      return;
    }
    const res = await ImagePicker.launchCameraAsync({ quality: 0.8 });
    if (!res.canceled && res.assets[0]) onPickImage(res.assets[0].uri);
  };

  return (
    // While the keyboard is open the safe-area padding is redundant, so it is absorbed by the offset.
    <KeyboardStickyView offset={{ closed: 0, opened: bottomInset }}>
      <LinearGradient
        pointerEvents="none"
        colors={['rgba(240,244,241,0)', colors.canvas]}
        style={styles.fade}
      />
      <View style={[styles.bar, { paddingBottom: bottomInset + space[2] }]}>
        <IconButton label="Attach a photo" disabled={disabled} onPress={pickFromLibrary}>
          <Plus size={22} color={colors.ink} strokeWidth={2.2} />
        </IconButton>

        <View style={styles.well}>
          <TextInput
            value={text}
            onChangeText={(t) => {
              setText(t);
              if (t.trim()) onTyping();
            }}
            editable={!disabled}
            placeholder="Message"
            placeholderTextColor={colors.inkTertiary}
            selectionColor={colors.accent}
            cursorColor={colors.accent}
            allowFontScaling={false}
            multiline
            maxLength={4000}
            textAlignVertical="center"
            accessibilityLabel="Message"
            style={styles.input}
          />
        </View>

        <View style={styles.slot}>
          <Animated.View style={[StyleSheet.absoluteFill, cameraStyle]} pointerEvents={hasText ? 'none' : 'auto'}>
            <IconButton label="Take a photo" variant="plain" disabled={disabled} onPress={takePhoto}>
              <Camera size={22} color={colors.inkSecondary} strokeWidth={2.1} />
            </IconButton>
          </Animated.View>
          <Animated.View style={[StyleSheet.absoluteFill, sendStyle]} pointerEvents={hasText ? 'auto' : 'none'}>
            <IconButton label="Send" variant="accent" disabled={disabled} haptic="medium" onPress={submit}>
              <SendHorizontal size={20} color={colors.inkOnDark} strokeWidth={2.2} />
            </IconButton>
          </Animated.View>
        </View>
      </View>
    </KeyboardStickyView>
  );
}

const styles = StyleSheet.create({
  fade: { position: 'absolute', left: 0, right: 0, top: -space[6], height: space[6] },
  bar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: space[2],
    paddingHorizontal: gutter - space[1],
    paddingTop: space[2],
    backgroundColor: colors.canvas,
  },
  well: {
    flex: 1,
    minHeight: CONTROL,
    borderRadius: radius.lg,
    borderCurve: 'continuous',
    backgroundColor: colors.surface,
    boxShadow: shadow.hair,
    justifyContent: 'center',
  },
  input: {
    fontFamily: font.regular,
    fontSize: type.body.fontSize,
    lineHeight: LINE,
    letterSpacing: type.body.letterSpacing,
    color: colors.ink,
    maxHeight: MAX_INPUT_HEIGHT,
    paddingTop: INPUT_PAD_Y,
    paddingBottom: INPUT_PAD_Y,
    paddingHorizontal: space[4],
  },
  slot: { width: CONTROL, height: CONTROL },
});

