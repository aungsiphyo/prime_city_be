import { apiRequest } from './client';

export const REPORT_TYPES = ['Maintenance', 'Security', 'Other'];

export async function submitReport(payload) {
  const res = await apiRequest('/reports', {
    method: 'POST',
    auth: true,
    body: payload,
  });
  return res.data || res.report;
}
