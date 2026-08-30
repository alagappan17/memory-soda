import axios from 'axios';
import type {
  ProjectSettings,
  ProjectSettingsPatch,
  LoginResponse,
  SessionUser,
  User,
} from '@memory-soda/types';

export const API_URL: string =
  import.meta.env.VITE_API_URL ?? 'http://localhost:3004';

export const AUTH_TOKEN_KEY = 'authToken';

const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Attach the session token (if any) to every request.
api.interceptors.request.use((config) => {
  const token = localStorage.getItem(AUTH_TOKEN_KEY);
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// On an expired/invalid session, clear the token and bounce to /login.
//
// `/auth/login` and `/auth/me` are exempt. Login owns its own error display, and
// `/auth/me` is the hydration call in AuthProvider, redirecting here would force
// a full document reload, discarding the `from` path RequireAuth records and
// racing the provider's own catch block. Let the route guard do it instead.
api.interceptors.response.use(
  (res) => res,
  (error) => {
    if (error?.response?.status !== 401) return Promise.reject(error);

    const path: string = (error?.config?.url ?? '').split('?')[0];

    // A rejected login is not an expired session, the form shows the error.
    if (path.endsWith('/auth/login')) return Promise.reject(error);

    localStorage.removeItem(AUTH_TOKEN_KEY);

    // Hydration failure: let RequireAuth navigate, so the attempted path is
    // preserved and AuthProvider's own catch still runs.
    if (path.endsWith('/auth/me')) return Promise.reject(error);

    if (window.location.pathname !== '/login') {
      window.location.assign('/login');
    }
    return Promise.reject(error);
  },
);

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

// ----- Auth -----

export async function login(
  username: string,
  password: string,
): Promise<LoginResponse> {
  const res = await api.post('/auth/login', { username, password });
  return res.data;
}

export async function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  await api.post('/auth/password', { currentPassword, newPassword });
}

export async function logout(): Promise<void> {
  await api.post('/auth/logout');
}

export async function getMe(): Promise<{ user: SessionUser }> {
  const res = await api.get('/auth/me');
  return res.data;
}

export async function listUsers(): Promise<User[]> {
  const res = await api.get('/dashboard/users');
  return res.data.users;
}

export async function createUser(
  username: string,
  password: string,
): Promise<User> {
  const res = await api.post('/dashboard/users', { username, password });
  return res.data.user;
}

export async function deleteUser(id: string): Promise<void> {
  await api.delete(`/dashboard/users/${id}`);
}

export default api;
