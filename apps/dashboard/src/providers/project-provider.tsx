'use client';

import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import type { Project } from '@memory-soda/types';

const api = axios.create({ baseURL: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3004' });

interface ProjectContextValue {
  projects: Project[];
  selectedProject: Project | null;
  setSelectedProject: (p: Project) => void;
  createProject: (name: string) => Promise<Project>;
  deleteProject: (id: string) => Promise<void>;
  loading: boolean;
}

const ProjectContext = createContext<ProjectContextValue | null>(null);

export function ProjectProvider({ children }: { children: React.ReactNode }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProjectState] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchProjects = useCallback(async () => {
    try {
      const res = await api.get('/projects');
      const list: Project[] = res.data.projects;
      setProjects(list);

      const savedId = typeof window !== 'undefined'
        ? localStorage.getItem('selectedProjectId')
        : null;

      setSelectedProjectState((prev) => {
        if (prev && list.find((p) => p.id === prev.id)) return prev;
        const restored = savedId ? list.find((p) => p.id === savedId) : null;
        return restored ?? list[0] ?? null;
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchProjects(); }, [fetchProjects]);

  function setSelectedProject(p: Project) {
    setSelectedProjectState(p);
    if (typeof window !== 'undefined') {
      localStorage.setItem('selectedProjectId', p.id);
    }
  }

  async function createProject(name: string): Promise<Project> {
    const res = await api.post('/projects', { name });
    const project: Project = res.data.project;
    setProjects((prev) => [...prev, project]);
    setSelectedProject(project);
    return project;
  }

  async function deleteProject(id: string): Promise<void> {
    await api.delete(`/projects/${id}`);
    setProjects((prev) => {
      const next = prev.filter((p) => p.id !== id);
      setSelectedProjectState((sel) => {
        if (sel?.id === id) return next[0] ?? null;
        return sel;
      });
      return next;
    });
  }

  return (
    <ProjectContext.Provider value={{
      projects,
      selectedProject,
      setSelectedProject,
      createProject,
      deleteProject,
      loading,
    }}>
      {children}
    </ProjectContext.Provider>
  );
}

export function useProject(): ProjectContextValue {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error('useProject must be used within ProjectProvider');
  return ctx;
}
