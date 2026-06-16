import axios from 'axios';
import type { ProjectSettings, ProjectSettingsPatch } from '@memory-soda/types';

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

export async function updateProjectSettings(
  projectId: string,
  patch: ProjectSettingsPatch,
): Promise<{ settings: ProjectSettings }> {
  const res = await api.patch(
    `/dashboard/projects/${projectId}/settings`,
    patch,
  );
  return res.data;
}

export default api;
