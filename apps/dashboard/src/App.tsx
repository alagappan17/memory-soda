import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import QueryProvider from './providers/query-provider';
import { ProjectProvider } from './providers/project-provider';
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

function DashboardHeader() {
  const location = useLocation();

  const pathMap: Record<string, string> = {
    '/': 'Home',
    '/projects': 'Projects',
    '/datasets': 'Datasets',
    '/playground': 'Playground',
    '/api-keys': 'API Keys',
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

export default function App() {
  return (
    <QueryProvider>
      <ProjectProvider>
        <BrowserRouter>
          <TooltipProvider>
            <SidebarProvider>
              <AppSidebar />
              <SidebarInset className="flex flex-col h-screen overflow-hidden bg-background">
                <DashboardHeader />
                <div className="flex-1 min-h-0 flex flex-col">
                  <Routes>
                    <Route
                      path="/"
                      element={
                        <div className="flex-1 overflow-y-auto">
                          <HomePage />
                        </div>
                      }
                    />
                    <Route
                      path="/projects"
                      element={
                        <div className="flex-1 overflow-y-auto">
                          <ProjectsPage />
                        </div>
                      }
                    />
                    <Route
                      path="/projects/:id/settings"
                      element={
                        <div className="flex-1 overflow-y-auto">
                          <ProjectSettingsPage />
                        </div>
                      }
                    />
                    <Route path="/datasets" element={<DatasetsPage />} />
                    <Route
                      path="/api-keys"
                      element={
                        <div className="flex-1 overflow-y-auto">
                          <ApiKeysPage />
                        </div>
                      }
                    />
                    <Route path="/playground" element={<PlaygroundPage />} />
                    <Route
                      path="/status"
                      element={
                        <div className="flex-1 overflow-y-auto">
                          <StatusPage />
                        </div>
                      }
                    />
                  </Routes>
                </div>
              </SidebarInset>
            </SidebarProvider>
          </TooltipProvider>
        </BrowserRouter>
      </ProjectProvider>
    </QueryProvider>
  );
}
