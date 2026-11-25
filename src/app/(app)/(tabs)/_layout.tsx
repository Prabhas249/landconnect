import { useQuery } from '@tanstack/react-query';
import { Tabs } from 'expo-router/js-tabs';
import { Bookmark, Compass, Layers, Map, MessageCircle, UserRound } from 'lucide-react-native';
import { Easing, type Animated } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import { fetchConversations } from '@/data/chat';
import { qk } from '@/data/keys';
import { ListingsWarmup } from '@/features/listings/media/warmup';
import { canManageListings, useSession } from '@/stores/session';
import { colors, curve } from '@/theme/tokens';
import { SheetDepthView } from '@/ui/sheet-depth';
import { FloatingTabBar, type TabItem } from '@/ui/tab-bar';

/**
 * Tab change: a ~200 ms cross-fade with a short directional drift (the incoming tab slides in
 * 14 pt from the side of the tab you tapped, the outgoing one drifts the other way). Native-driver
 * opacity/transform only, so it stays on the UI thread; ease-out so the new tab is mostly there by
 * the first frames. Covers a lazy tab's first mount so nothing flashes.
 */
const SHIFT = 14;
const forFadeShift = ({ current }: { current: { progress: Animated.Value } }) => ({
  sceneStyle: {
    opacity: current.progress.interpolate({ inputRange: [-1, -0.5, 0, 0.5, 1], outputRange: [0, 0.4, 1, 0.4, 0] }),
    transform: [{ translateX: current.progress.interpolate({ inputRange: [-1, 0, 1], outputRange: [-SHIFT, 0, SHIFT] }) }],
  },
});

const tabTransition = {
  animation: 'fade',
  sceneStyleInterpolator: forFadeShift,
  transitionSpec: { animation: 'timing', config: { duration: 200, easing: Easing.bezier(...curve.out) } },
} as const;

const noTransition = { animation: 'none' } as const;

export default function TabsLayout() {
  const reduced = useReducedMotion();
  const role = useSession((s) => s.profile?.role);
  const manages = canManageListings(role);

  const { data: conversations } = useQuery({ queryKey: qk.conversations, queryFn: fetchConversations });
  const unread = conversations?.reduce((n, c) => n + (c.unread > 0 ? 1 : 0), 0) ?? 0;

  // The fourth tab is role-based: sellers and brokers manage land, buyers keep a shortlist.
  const items: TabItem[] = [
    { name: 'index', label: 'Explore', icon: Compass },
    { name: 'map', label: 'Map', icon: Map },
    { name: 'chats', label: 'Chats', icon: MessageCircle, badge: unread },
    manages ? { name: 'land', label: 'My land', icon: Layers } : { name: 'land', label: 'Saved', icon: Bookmark },
    { name: 'profile', label: 'Profile', icon: UserRound },
  ];

  return (
    // Recedes (scale + dim) behind sheets such as List land on Android; inert otherwise.
    <SheetDepthView>
      <ListingsWarmup />
      <Tabs
        // Only the Map tab is parked in React Activity when hidden (it is the heavy one). Activity
        // runs unmount on a hidden tab's Reanimated views while their native nodes stay in the tree,
        // and Reanimated then re-checks every such node on every mount app-wide: with all tabs
        // parked, that alone cost Explore ~5 ms per scroll frame. Other tabs simply stay mounted.
        screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.canvas }, ...(reduced ? noTransition : tabTransition) }}
        tabBar={({ state, navigateToTab }) => (
          <FloatingTabBar
            items={items}
            activeIndex={state.index}
            scrim={state.routes[state.index]?.name !== 'map'}
            onSelect={(i) => {
              if (state.index !== i) navigateToTab(state.routes[i].key);
            }}
          />
        )}>
        <Tabs.Screen name="index" />
        {/* The map draws to a native surface that cannot be faded on Android: it cuts in, and the
            fade of the tab it covers or reveals carries the transition. */}
        <Tabs.Screen name="map" activityEnabled options={{ animation: 'none' }} />
        <Tabs.Screen name="chats" />
        <Tabs.Screen name="land" />
        <Tabs.Screen name="profile" />
      </Tabs>
    </SheetDepthView>
  );
}
