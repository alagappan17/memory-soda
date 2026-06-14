import axios from 'axios';
import type { ProjectSettings } from '@memory-soda/types';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? 'http://localhost:3004',
  headers: {
    'Content-Type': 'application/json',
  },
});

export async function getProjectSettings(
  projectId: string,
): Promise<{ settings: ProjectSettings }> {
  const res = await api.get(`/dashboard/projects/${projectId}/settings`);
  return res.data;
}

// using any for DeepPartial or we can just use Partial<ProjectSettings>
export async function updateProjectSettings(
  projectId: string,
  patch: any,
): Promise<{ settings: ProjectSettings }> {
  const res = await api.patch(
    `/dashboard/projects/${projectId}/settings`,
    patch,
  );
  return res.data;
}

export default api;
