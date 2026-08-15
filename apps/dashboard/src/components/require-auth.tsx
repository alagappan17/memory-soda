import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/providers/auth-provider';

/**
 * Gates the authenticated dashboard shell. While the session is being restored
 * it renders nothing; if there is no session it redirects to /login, preserving
 * the attempted path so login can send the user back.
 */
export default function RequireAuth({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <span className="text-sm text-muted-foreground">Loading…</span>
      </div>
    );
  }

  if (!user) {
    return (
      <Navigate to="/login" replace state={{ from: location.pathname }} />
    );
  }

  return <>{children}</>;
}
