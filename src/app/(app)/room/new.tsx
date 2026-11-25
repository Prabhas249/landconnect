import { NewRoomScreen } from '@/features/chat/room-new';
import { useSheetDepth } from '@/ui/sheet-depth';

export default function NewRoomRoute() {
  // Presented as a sheet: the app behind recedes while it is open (Android; iOS does it natively).
  useSheetDepth();
  return <NewRoomScreen />;
}
