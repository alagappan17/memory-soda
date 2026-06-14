import { useState, useEffect } from 'react';
import { useProject } from '@/providers/project-provider';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Plus, Check, Pencil, AlertCircle } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';

export default function ProjectsPage() {
  const navigate = useNavigate();
  const { projects, selectedProject, createProject, updateProject, loading } =
    useProject();
  const [showNewProject, setShowNewProject] = useState(false);
  const [newName, setNewName] = useState('');
  const [description, setDescription] = useState('');
  const [creating, setCreating] = useState(false);

  const [showEditProject, setShowEditProject] = useState(false);
  const [editingProject, setEditingProject] = useState<any>(null);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [updating, setUpdating] = useState(false);

  const [descriptions, setDescriptions] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<{
    visible: boolean;
    message: string;
    type: 'success' | 'error';
  }>({
    visible: false,
    message: '',
    type: 'success',
  });

  // Load descriptions from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('project_descriptions');
    if (saved) {
      try {
        setDescriptions(JSON.parse(saved));
      } catch {
        // ignore
      }
    }
  }, [projects]);

  function showToast(message: string, type: 'success' | 'error') {
    setToast({ visible: true, message, type });
    setTimeout(() => {
      setToast((prev) => ({ ...prev, visible: false }));
    }, 3000);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim() || !description.trim()) return;
    setCreating(true);
    const targetName = newName.trim();
    try {
      const proj = await createProject(targetName, description.trim());

      // Save description
      const savedDescs = localStorage.getItem('project_descriptions');
      const descs = savedDescs ? JSON.parse(savedDescs) : {};
      descs[proj.id] = description.trim();
      localStorage.setItem('project_descriptions', JSON.stringify(descs));
      setDescriptions(descs);

      setNewName('');
      setDescription('');
      setShowNewProject(false);
      showToast(`Switched to ${targetName}`, 'success');
    } catch {
      showToast('Failed to create project.', 'error');
    } finally {
      setCreating(false);
    }
  }

  function handleStartEdit(p: any) {
    setEditingProject(p);
    setEditName(p.name);
    setEditDescription(p.description || descriptions[p.id] || '');
    setShowEditProject(true);
  }

  async function handleUpdate(e: React.FormEvent) {
    e.preventDefault();
    if (!editingProject || !editName.trim() || !editDescription.trim()) return;
    setUpdating(true);
    try {
      await updateProject(
        editingProject.id,
        editName.trim(),
        editDescription.trim(),
      );

      // Save description
      const savedDescs = localStorage.getItem('project_descriptions');
      const descs = savedDescs ? JSON.parse(savedDescs) : {};
      descs[editingProject.id] = editDescription.trim();
      localStorage.setItem('project_descriptions', JSON.stringify(descs));
      setDescriptions(descs);

      setShowEditProject(false);
      setEditingProject(null);
      showToast('Project updated successfully!', 'success');
    } catch {
      showToast('Failed to update project.', 'error');
    } finally {
      setUpdating(false);
    }
  }

  return (
    <div className="max-w-4xl mx-auto px-6 py-10">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-xl font-semibold">Projects</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage your workspaces, descriptions, and settings.
          </p>
        </div>
        <button
          onClick={() => setShowNewProject(true)}
          className="flex items-center gap-2 text-sm px-4 py-2 rounded-md bg-primary text-primary-foreground hover:opacity-90 transition-opacity cursor-pointer font-medium"
        >
          <Plus className="h-4 w-4" />
          <span>New project</span>
        </button>
      </div>

      <div className="rounded-md border border-border overflow-hidden bg-card shadow-sm">
        {loading ? (
          <div className="px-4 py-6 text-sm text-muted-foreground text-center">
            Loading...
          </div>
        ) : projects.length === 0 ? (
          <div className="px-4 py-8 text-sm text-muted-foreground text-center">
            No projects found. Create one to get started.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <tr className="border-b border-border bg-muted/40">
                <TableHead className="w-1/3">Name</TableHead>
                <TableHead className="w-1/2">Description</TableHead>
                <TableHead className="w-40">Created At</TableHead>
                <TableHead className="text-right w-20">Actions</TableHead>
              </tr>
            </TableHeader>
            <TableBody>
              {projects.map((p) => {
                const isActive = selectedProject?.id === p.id;
                const desc =
                  p.description ||
                  descriptions[p.id] ||
                  'No description provided.';
                return (
                  <TableRow
                    key={p.id}
                    className={`hover:bg-muted/20 transition-colors ${
                      isActive ? 'bg-muted/10 font-medium' : ''
                    }`}
                  >
                    <TableCell className="font-semibold text-foreground flex items-center gap-2">
                      <span>{p.name}</span>
                      {isActive && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-medium border border-emerald-500/10 select-none">
                          Active
                        </span>
                      )}
                    </TableCell>
                    <TableCell
                      className="text-muted-foreground truncate max-w-xs"
                      title={desc}
                    >
                      {desc}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs font-mono">
                      {new Date(p.createdAt).toLocaleDateString(undefined, {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                      })}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => handleStartEdit(p)}
                          className="inline-flex items-center justify-center h-8 w-8 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                          title="Edit project"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Dialog for New Project */}
      <Dialog open={showNewProject} onOpenChange={setShowNewProject}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>New Project</DialogTitle>
            <DialogDescription>
              Create a new project to manage your AI memories and API keys.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium leading-none">Name</label>
              <input
                type="text"
                placeholder="My Awesome Project"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="w-full text-sm rounded-md border border-input bg-background px-3 py-2 outline-none focus:ring-1 focus:ring-ring"
                required
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium leading-none">
                Description
              </label>
              <input
                type="text"
                placeholder="A short description about this project..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full text-sm rounded-md border border-input bg-background px-3 py-2 outline-none focus:ring-1 focus:ring-ring"
                required
              />
            </div>
            <DialogFooter className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowNewProject(false);
                  setNewName('');
                  setDescription('');
                }}
                className="px-3.5 py-2 rounded-md border border-border text-sm font-medium hover:bg-muted transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={creating || !newName.trim() || !description.trim()}
                className="px-3.5 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-40 transition-opacity cursor-pointer"
              >
                {creating ? 'Creating…' : 'Create Project'}
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Dialog for Edit Project */}
      <Dialog open={showEditProject} onOpenChange={setShowEditProject}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Edit Project</DialogTitle>
            <DialogDescription>
              Update your project details such as name and description.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleUpdate} className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium leading-none">Name</label>
              <input
                type="text"
                placeholder="My Awesome Project"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="w-full text-sm rounded-md border border-input bg-background px-3 py-2 outline-none focus:ring-1 focus:ring-ring"
                required
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium leading-none">
                Description
              </label>
              <input
                type="text"
                placeholder="A short description about this project..."
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                className="w-full text-sm rounded-md border border-input bg-background px-3 py-2 outline-none focus:ring-1 focus:ring-ring"
                required
              />
            </div>
            <DialogFooter className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowEditProject(false);
                  setEditingProject(null);
                  setEditName('');
                  setEditDescription('');
                }}
                className="px-3.5 py-2 rounded-md border border-border text-sm font-medium hover:bg-muted transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={
                  updating || !editName.trim() || !editDescription.trim()
                }
                className="px-3.5 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-40 transition-opacity cursor-pointer"
              >
                {updating ? 'Saving…' : 'Save Changes'}
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Floating Sonner-Style Toast Notification */}
      {toast.visible &&
        createPortal(
          <div className="fixed top-6 right-6 z-[9999] flex items-center gap-3.5 px-4 py-3 rounded-xl border border-border bg-card text-card-foreground shadow-lg animate-in fade-in-0 slide-in-from-top-5 duration-300 min-w-[300px] select-none font-sans">
            {toast.type === 'success' ? (
              <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                <Check className="h-3.5 w-3.5 stroke-[3]" />
              </div>
            ) : (
              <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
                <AlertCircle className="h-3.5 w-3.5 stroke-[2.5]" />
              </div>
            )}
            <span className="text-sm font-medium text-foreground">
              {toast.message}
            </span>
          </div>,
          document.body,
        )}
    </div>
  );
}
