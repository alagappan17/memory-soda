'use client';

import Link from 'next/link';
import { useState, useRef, useEffect } from 'react';
import { useProject } from '@/providers/project-provider';

export default function Nav() {
  const {
    projects,
    selectedProject,
    setSelectedProject,
    createProject,
    loading,
  } = useProject();
  const [open, setOpen] = useState(false);
  const [showNewProject, setShowNewProject] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    try {
      await createProject(newName.trim());
      setNewName('');
      setShowNewProject(false);
      setOpen(false);
    } finally {
      setCreating(false);
    }
  }

  return (
    <nav className="border-b border-border bg-card px-6 py-3 flex items-center gap-6">
      <Link
        href="/"
        className="font-semibold text-foreground tracking-tight shrink-0 flex items-center gap-2"
      >
        <img
          src="/Memory%20Soda%20Black%20Horizontal.svg"
          alt="Memory Soda"
          className="h-6 w-auto"
        />
      </Link>

      {/* Project switcher */}
      <div className="relative" ref={dropdownRef}>
        <button
          onClick={() => {
            setOpen((o) => !o);
            setShowNewProject(false);
          }}
          className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md border border-border bg-background hover:bg-muted transition-colors"
        >
          <span className="max-w-[160px] truncate">
            {loading ? '…' : (selectedProject?.name ?? 'Select project')}
          </span>
          <svg
            className="w-3.5 h-3.5 text-muted-foreground shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </button>

        {open && (
          <div className="absolute left-0 top-full mt-1 z-50 w-56 rounded-md border border-border bg-card shadow-md">
            {projects.length > 0 && (
              <ul className="py-1">
                {projects.map((p) => (
                  <li key={p.id}>
                    <button
                      onClick={() => {
                        setSelectedProject(p);
                        setOpen(false);
                      }}
                      className={`w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors flex items-center gap-2 ${
                        selectedProject?.id === p.id
                          ? 'font-medium text-foreground'
                          : 'text-muted-foreground'
                      }`}
                    >
                      {selectedProject?.id === p.id && (
                        <svg
                          className="w-3.5 h-3.5 shrink-0"
                          fill="currentColor"
                          viewBox="0 0 20 20"
                        >
                          <path
                            fillRule="evenodd"
                            d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                            clipRule="evenodd"
                          />
                        </svg>
                      )}
                      <span className="truncate">{p.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="border-t border-border py-1">
              {showNewProject ? (
                <form
                  onSubmit={handleCreate}
                  className="px-3 py-2 flex flex-col gap-2"
                >
                  <input
                    autoFocus
                    type="text"
                    placeholder="Project name"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    className="text-sm rounded border border-input bg-background px-2 py-1 outline-none focus:ring-1 focus:ring-ring"
                  />
                  <div className="flex gap-2">
                    <button
                      type="submit"
                      disabled={creating || !newName.trim()}
                      className="flex-1 text-xs px-2 py-1 rounded bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-opacity"
                    >
                      {creating ? 'Creating…' : 'Create'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowNewProject(false);
                        setNewName('');
                      }}
                      className="text-xs px-2 py-1 rounded border border-border hover:bg-muted transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <button
                  onClick={() => setShowNewProject(true)}
                  className="w-full text-left px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                >
                  + New project
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center gap-4 text-sm">
        <Link
          href="/playground"
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          Playground
        </Link>
        <Link
          href="/api-keys"
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          API Keys
        </Link>
        <Link
          href="/status"
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          Status
        </Link>
      </div>
    </nav>
  );
}
