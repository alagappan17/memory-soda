import {
  BrowserRouter,
  Routes,
  Route,
  Outlet,
  useLocation,
} from 'react-router-dom';
import QueryProvider from './providers/query-provider';
import { ProjectProvider } from './providers/project-provider';
import { AuthProvider } from './providers/auth-provider';
import RequireAuth from './components/require-auth';
import {
  SidebarProvider,
  SidebarInset,
  SidebarTrigger,
} from './components/ui/sidebar';
import { TooltipProvider } from './components/ui/tooltip';
import AppSidebar from './components/app-sidebar';
import HomePage from './pages/home';
import ApiKeysPage from './pages/api-keys';
import StatusPage from './pages/status';
import ProjectsPage from './pages/projects';
import DatasetsPage from './pages/datasets';
import PlaygroundPage from './pages/playground';
import ProjectSettingsPage from './pages/project-settings';
import LoginPage from './pages/login';
import UsersPage from './pages/users';
import UsagePage from './pages/usage';

function DashboardHeader() {
  const location = useLocation();

  const pathMap: Record<string, string> = {
    '/': 'Home',
    '/projects': 'Projects',
    '/datasets': 'Datasets',
    '/playground': 'Playground',
    '/api-keys': 'API Keys',
    '/usage': 'Usage',
    '/users': 'Users',
    '/status': 'Status',
  };

  const currentLabel =
    location.pathname.startsWith('/projects/') &&
    location.pathname.endsWith('/settings')
      ? 'Project Settings'
      : pathMap[location.pathname] || 'Home';

  return (
    <header className="flex h-14 shrink-0 items-center gap-2.5 border-b bg-background px-4">
      <SidebarTrigger className="-ml-1" />
      <span className="font-medium text-sm text-foreground">
        {currentLabel}
      </span>
    </header>
  );
}

// The authenticated dashboard chrome. Projects only load once the user is
// authenticated, so ProjectProvider lives inside the auth gate.
function ProtectedLayout() {
  return (
    <RequireAuth>
      <ProjectProvider>
        <SidebarProvider>
          <AppSidebar />
          <SidebarInset className="flex flex-col h-screen overflow-hidden bg-background">
            <DashboardHeader />
            <div className="flex-1 min-h-0 flex flex-col">
              <Outlet />
            </div>
          </SidebarInset>
        </SidebarProvider>
      </ProjectProvider>
    </RequireAuth>
  );
}

const scroll = (el: React.ReactNode) => (
  <div className="flex-1 overflow-y-auto [scrollbar-gutter:stable]">{el}</div>
);

export default function App() {
  return (
    <QueryProvider>
      <AuthProvider>
        <BrowserRouter>
          <TooltipProvider>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route element={<ProtectedLayout />}>
                <Route path="/" element={scroll(<HomePage />)} />
                <Route path="/projects" element={scroll(<ProjectsPage />)} />
                <Route
                  path="/projects/:id/settings"
                  element={scroll(<ProjectSettingsPage />)}
                />
                <Route path="/datasets" element={<DatasetsPage />} />
                <Route path="/api-keys" element={scroll(<ApiKeysPage />)} />
                <Route path="/users" element={scroll(<UsersPage />)} />
                <Route path="/playground" element={<PlaygroundPage />} />
                <Route path="/status" element={scroll(<StatusPage />)} />
                <Route path="/usage" element={scroll(<UsagePage />)} />
              </Route>
            </Routes>
          </TooltipProvider>
        </BrowserRouter>
      </AuthProvider>
    </QueryProvider>
  );
}
