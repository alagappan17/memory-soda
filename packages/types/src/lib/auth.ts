export interface ApiKeyPayload {
  keyId: string;
  name?: string;
}

export interface ApiKey {
  id: string;
  name: string;
  keyPreview: string;
  projectId: string | null;
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
