import { apiRequest } from './client';
import { API_BASE_URL } from '../config/api';

const API_ORIGIN = API_BASE_URL.replace(/\/api\/?$/, '');

function resolveImageUrl(url) {
  const value = String(url || '').trim();
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) return value;
  return `${API_ORIGIN}${value.startsWith('/') ? value : `/${value}`}`;
}

export async function fetchAdvertisements(params = {}) {
  const query = new URLSearchParams();
  query.set('status', params.status || 'Active');
  if (params.limit) query.set('limit', String(params.limit));

  const res = await apiRequest(`/advertisements?${query.toString()}`);
  const data = Array.isArray(res) ? res : res.data || [];

  return data.map((item) => ({
    id: item._id,
    companyName: item.company_name,
    title: item.title,
    content: item.content,
    imageUrl: resolveImageUrl(item.image_url),
    linkUrl: item.link_url,
    duration: item.duration,
  }));
}
