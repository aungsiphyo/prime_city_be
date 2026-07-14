import { Platform } from 'react-native';
import { apiRequest } from './client';

export async function fetchNotifications(params = {}) {
  const query = new URLSearchParams();
  if (params.limit) query.set('limit', String(params.limit));

  const qs = query.toString();
  const path = qs ? `/notifications?${qs}` : '/notifications';
  const res = await apiRequest(path, { auth: true });
  return res.data || [];
}

export async function markAllNotificationsRead() {
  return apiRequest('/notifications/mark-all-read', {
    method: 'PUT',
    auth: true,
  });
}

export async function registerDeviceToken(token) {
  return apiRequest('/notifications/device-token', {
    method: 'POST',
    auth: true,
    body: {
      token,
      platform: Platform.OS,
    },
  });
}

export async function unregisterDeviceToken(token) {
  return apiRequest('/notifications/device-token', {
    method: 'DELETE',
    auth: true,
    body: { token },
  });
}
