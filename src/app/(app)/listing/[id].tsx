import { Stack } from 'expo-router';

import ListingDetailScreen from '@/features/listings/listing-detail-screen';
import { colors } from '@/theme/tokens';

/**
 * Plain native push: the iOS slide with the feed's parallax behind it, and the same in reverse on
 * back or edge swipe. No transform on the screen root, so the page never scales or jumps; the
 * content's calm fade-up lives in the screen itself. The canvas colour is set on the native screen
 * so nothing white shows during the slide or the swipe-back.
 */
export default function ListingRoute() {
  return (
    <>
      <Stack.Screen
        options={{
          animation: 'ios_from_right',
          animationDuration: 280,
          gestureEnabled: true,
          contentStyle: { backgroundColor: colors.canvas },
        }}
      />
      <ListingDetailScreen />
    </>
  );
}
