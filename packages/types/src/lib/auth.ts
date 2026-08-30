export interface ApiKeyPayload {
  keyId: string;
  projectId: string;
  name?: string;
}

export interface ApiKey {
  id: string;
  name: string;
  keyPreview: string;
  projectId: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface Project {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
}

/** A dashboard login user. Never carries the password hash. */
export interface User {
  id: string;
  username: string;
  createdAt: string;
  updatedAt: string;
}

/** Identity attached to `req.user` by the session middleware. */
export interface SessionUser {
  userId: string;
  username: string;
}

/** The out-of-the-box admin password. Every deployment starts with it until someone changes it. */
export const DEFAULT_ADMIN_PASSWORD = 'open-sesame';

/** Response shape for a successful login. */
export interface LoginResponse {
  token: string;
  user: User;
  /** True while the account still uses DEFAULT_ADMIN_PASSWORD; the dashboard nags until it is changed. */
  usingDefaultPassword: boolean;
}

export interface ChangePasswordBody {
  currentPassword: string;
  newPassword: string;
}
