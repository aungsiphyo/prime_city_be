import { apiRequest } from './client';

export async function fetchResidentsForNotifications() {
  const res = await apiRequest('/notifications/residents', { auth: true });
  return res.data || [];
}

export async function sendAdminNotification(payload) {
  return apiRequest('/notifications/send', {
    method: 'POST',
    auth: true,
    body: payload,
  });
}
