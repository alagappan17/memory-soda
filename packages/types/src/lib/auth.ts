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

/** Response shape for a successful login. */
export interface LoginResponse {
  token: string;
  user: User;
}
