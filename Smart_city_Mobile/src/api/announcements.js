import { apiRequest } from './client';

export async function fetchAnnouncements(params = {}) {
  const query = new URLSearchParams();
  if (params.page) query.set('page', String(params.page));
  if (params.limit) query.set('limit', String(params.limit));
  if (params.type) query.set('type', params.type);
  if (params.q) query.set('q', params.q);

  const qs = query.toString();
  const path = qs ? `/announcements?${qs}` : '/announcements';
  const res = await apiRequest(path);
  return res.data || [];
}
