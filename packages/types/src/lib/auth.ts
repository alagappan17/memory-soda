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
