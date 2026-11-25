import { useLocalSearchParams } from 'expo-router';

import { RoomLobby } from '@/features/chat/room-lobby';

export default function RoomRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <RoomLobby key={id} id={id} />;
}
