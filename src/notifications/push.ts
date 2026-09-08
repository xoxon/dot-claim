import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';

export type PushRegistration = {
  token: string;
  platform: 'ios' | 'android';
};

export type PushTarget = {
  type: 'chat' | 'game_invite';
  friendId: string;
  inviteId?: string;
};

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

function getPushTarget(value: unknown): PushTarget | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as Record<string, unknown>;
  const type = data.type;
  const friendId = data.friendId;
  if ((type !== 'chat' && type !== 'game_invite') || typeof friendId !== 'string') return null;
  return {
    type,
    friendId,
    ...(type === 'game_invite' && typeof data.inviteId === 'string' ? { inviteId: data.inviteId } : {}),
  };
}

export async function registerForPushNotifications(): Promise<PushRegistration | null> {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return null;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Dot Claim',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 220, 130, 220],
      lightColor: '#58C7FF',
    });
  }

  const existing = await Notifications.getPermissionsAsync();
  const permission = existing.status === 'granted' ? existing : await Notifications.requestPermissionsAsync();
  if (permission.status !== 'granted') return null;

  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) throw new Error('Bildirim proje kimliği bulunamadı.');
  const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  return { token, platform: Platform.OS };
}

export async function getInitialPushTarget() {
  const response = await Notifications.getLastNotificationResponseAsync();
  const target = getPushTarget(response?.notification.request.content.data);
  if (response) await Notifications.clearLastNotificationResponseAsync();
  return target;
}

export function subscribeToPushResponses(onOpen: (target: PushTarget) => void) {
  return Notifications.addNotificationResponseReceivedListener((response) => {
    const target = getPushTarget(response.notification.request.content.data);
    if (target) onOpen(target);
  });
}
