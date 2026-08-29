import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation } from 'react-router-dom';
import {
  Home,
  Folder,
  KeyRound,
  Activity,
  FlaskConical,
  Database,
  Settings,
  Users,
  LogOut,
  ChevronsUpDown,
  Plus,
  Check,
  AlertCircle,
} from 'lucide-react';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from '@/components/ui/sidebar';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useProject } from '@/providers/project-provider';
import { useAuth } from '@/providers/auth-provider';

// Overview link, shown ungrouped at the top.
const overviewNav = [{ to: '/', label: 'Home', icon: Home }];

// App-wide destinations (not tied to the selected project).
const applicationNav = [
  { to: '/projects', label: 'Projects', icon: Folder },
  { to: '/users', label: 'Users', icon: Users },
  { to: '/status', label: 'Status', icon: Activity },
];

// Scoped to the currently selected project.
const projectNav = [
  { to: '/datasets', label: 'Datasets', icon: Database },
  { to: '/playground', label: 'Playground', icon: FlaskConical },
  { to: '/api-keys', label: 'API Keys', icon: KeyRound },
];

function NavItem({
  to,
  label,
  icon: Icon,
}: {
  to: string;
  label: string;
  icon: React.ElementType;
}) {
  const location = useLocation();
  const isActive = location.pathname === to;

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={isActive}
        tooltip={label}
        render={<Link to={to} />}
      >
        <Icon />
        <span>{label}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

export default function AppSidebar() {
  const {
    projects,
    selectedProject,
    setSelectedProject,
    createProject,
    loading,
  } = useProject();
  const { user, logout } = useAuth();
  const projectInitial = selectedProject
    ? selectedProject.name.slice(0, 1).toUpperCase()
    : 'P';
  const userInitial = user?.username?.slice(0, 1).toUpperCase() ?? 'U';
  const [showNewProject, setShowNewProject] = useState(false);
  const [newName, setNewName] = useState('');
  const [description, setDescription] = useState('');
  const [creating, setCreating] = useState(false);
  const [toast, setToast] = useState<{
    visible: boolean;
    message: string;
    type: 'success' | 'error';
  }>({ visible: false, message: '', type: 'success' });

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
      await createProject(targetName);
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

  function handleSwitchProject(p: (typeof projects)[number]) {
    setSelectedProject(p);
    showToast(`Switched to ${p.name}`, 'success');
  }

  return (
    <Sidebar collapsible="icon">
      {/* Logo */}
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              className="hover:bg-transparent active:bg-transparent justify-start px-2 gap-2.5 cursor-default select-none group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
            >
              <img
                src="/memory-soda-black-vert-logo.svg"
                alt="Memory Soda"
                className="h-8 w-8 shrink-0 transition-all duration-200 group-data-[collapsible=icon]:h-6 group-data-[collapsible=icon]:w-6"
              />
              <span className="font-geist font-semibold text-[24px] tracking-[-0.03em] group-data-[collapsible=icon]:hidden whitespace-nowrap text-foreground">
                Memory Soda
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      {/* Navigation */}
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {overviewNav.map((item) => (
                <NavItem key={item.to} {...item} />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Application</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {applicationNav.map((item) => (
                <NavItem key={item.to} {...item} />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Project</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {projectNav.map((item) => (
                <NavItem key={item.to} {...item} />
              ))}
              {selectedProject && (
                <NavItem
                  to={`/projects/${selectedProject.id}/settings`}
                  label="Project Settings"
                  icon={Settings}
                />
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      {/* Account + project switcher */}
      <SidebarFooter className="pb-4">
        <SidebarMenu>
          <SidebarMenuItem className="flex items-center gap-2 group-data-[collapsible=icon]:flex-col">
            {/* Profile circle, click to reveal the sign-out option. */}
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label="Account"
                className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground font-semibold text-xs select-none outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {userInitial}
              </DropdownMenuTrigger>
              <DropdownMenuContent
                side="top"
                align="start"
                className="w-auto min-w-44"
              >
                {/* GroupLabel throws unless it is inside a Group. */}
                <DropdownMenuGroup>
                  <DropdownMenuLabel>
                    <span className="block">Signed in as</span>
                    <span className="block truncate text-sm font-medium text-foreground">
                      {user?.username ?? '-'}
                    </span>
                  </DropdownMenuLabel>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={logout}>
                  <LogOut />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <Select
              value={selectedProject?.id}
              onValueChange={(val) => {
                const proj = projects.find((p) => p.id === val);
                if (proj) handleSwitchProject(proj);
              }}
            >
              <SelectTrigger
                showChevron={false}
                className="flex w-full flex-1 min-w-0 items-center gap-2 rounded-xl px-3 py-2 text-left text-sm bg-white border border-border hover:bg-muted/50 dark:bg-zinc-950 dark:border-zinc-800 outline-none group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0 group-data-[collapsible=icon]:size-8! group-data-[collapsible=icon]:bg-transparent group-data-[collapsible=icon]:border-0 group-data-[collapsible=icon]:shadow-none"
              >
                {/* Expanded state */}
                <div className="flex flex-col gap-0.5 leading-none min-w-0 flex-1 text-left group-data-[collapsible=icon]:hidden">
                  <span className="font-semibold truncate text-sm text-foreground">
                    {loading
                      ? '…'
                      : (selectedProject?.name ?? 'Select project')}
                  </span>
                </div>
                <ChevronsUpDown className="shrink-0 h-4 w-4 text-muted-foreground group-data-[collapsible=icon]:hidden" />

                {/* Collapsed state (Avatar) */}
                <div className="hidden group-data-[collapsible=icon]:flex items-center justify-center size-8 rounded-full bg-primary text-primary-foreground font-semibold text-xs select-none">
                  {loading ? '…' : projectInitial}
                </div>
              </SelectTrigger>
              <SelectContent className="w-[--radix-select-trigger-width] min-w-56 rounded-xl">
                {projects.map((p) => (
                  <SelectItem
                    key={p.id}
                    value={p.id}
                    className="cursor-pointer"
                  >
                    {p.name}
                  </SelectItem>
                ))}
                <div className="-mx-1 my-1 h-px bg-border/50" /> {/* Divider */}
                <div
                  onClick={() => {
                    setShowNewProject(true);
                  }}
                  className="relative flex w-full cursor-pointer select-none items-center rounded-xl py-1.5 px-2 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground gap-2"
                >
                  <Plus className="h-4 w-4 shrink-0" />
                  <span>New project</span>
                </div>
              </SelectContent>
            </Select>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

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

      {/* Floating Sonner-Style Toast Notification */}
      {toast.visible &&
        createPortal(
          <div className="fixed top-6 right-6 z-[9999] flex items-center gap-3.5 px-4 py-3 rounded-xl border border-border bg-card text-card-foreground animate-in fade-in-0 slide-in-from-top-5 duration-300 min-w-[300px] select-none font-sans">
            {toast.type === 'success' ? (
              <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-foreground text-background">
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

      <SidebarRail />
    </Sidebar>
  );
}
