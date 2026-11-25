import { useLocalSearchParams } from 'expo-router';

import { UserProfileScreen } from '@/features/chat/user-profile';

export default function UserRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <UserProfileScreen key={id} id={id} />;
}
