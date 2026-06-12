import { apiRequest } from './client';

export const VISITOR_PURPOSES = [
  'Meeting',
  'Interview',
  'Delivery',
  'Event',
  'Tour',
  'Service',
  'General',
  'Other',
];

export async function registerVisitor(payload) {
  return apiRequest('/visitors/register', {
    method: 'POST',
    body: payload,
  });
}

export function splitFullName(fullName) {
  const trimmed = (fullName || '').trim();
  if (!trimmed) return { firstName: '', lastName: '' };
  const parts = trimmed.split(/\s+/);
  return {
    firstName: parts[0] || '',
    lastName: parts.slice(1).join(' ') || parts[0],
  };
}
