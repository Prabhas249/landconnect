import { Eye, EyeOff } from 'lucide-react-native';
import { useState } from 'react';

import { colors } from '@/theme/tokens';
import { Field, type FieldProps } from '@/ui/field';
import { PressableScale } from '@/ui/pressable-scale';

/** Password input with a show / hide toggle. */
export function PasswordField(props: Omit<FieldProps, 'secureTextEntry' | 'trailing'>) {
  const [visible, setVisible] = useState(false);
  const Icon = visible ? EyeOff : Eye;
  return (
    <Field
      autoCapitalize="none"
      autoCorrect={false}
      textContentType="password"
      autoComplete="password"
      {...props}
      secureTextEntry={!visible}
      trailing={
        <PressableScale
          haptic="selection"
          to={0.9}
          onPress={() => setVisible((v) => !v)}
          accessibilityLabel={visible ? 'Hide password' : 'Show password'}
          style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginRight: -10 }}>
          <Icon size={19} color={colors.inkSecondary} strokeWidth={2} />
        </PressableScale>
      }
    />
  );
}

export type PasswordStrength = { score: 0 | 1 | 2 | 3 | 4; hint: string };

/** A simple, honest heuristic: length first, then variety. */
export function passwordStrength(pw: string): PasswordStrength {
  if (pw.length === 0) return { score: 0, hint: 'Use 8 or more characters.' };
  if (pw.length < 8) return { score: 1, hint: `${8 - pw.length} more character${8 - pw.length === 1 ? '' : 's'} needed.` };
  let variety = 0;
  if (/[a-z]/.test(pw)) variety++;
  if (/[A-Z]/.test(pw)) variety++;
  if (/\d/.test(pw)) variety++;
  if (/[^A-Za-z0-9]/.test(pw)) variety++;
  if (pw.length >= 12 && variety >= 3) return { score: 4, hint: 'Strong password.' };
  if (variety >= 3 || pw.length >= 12) return { score: 3, hint: 'Good. Longer is stronger.' };
  return { score: 2, hint: 'Fair. Mix in numbers or symbols.' };
}
