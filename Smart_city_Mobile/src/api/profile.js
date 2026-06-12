import { apiRequest } from './client';

export async function fetchProfile() {
  const res = await apiRequest('/protected/profile', { auth: true });
  return res.user;
}
