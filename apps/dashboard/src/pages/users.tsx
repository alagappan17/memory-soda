import { useState, useEffect } from 'react';
import { KeyRound } from 'lucide-react';
import { PasswordInput } from '@/components/password-input';
import { ChangePasswordDialog } from '@/components/change-password-dialog';
import type { User } from '@memory-soda/types';
import { listUsers, createUser, deleteUser } from '@/lib/api';
import { useAuth } from '@/providers/auth-provider';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export default function UsersPage() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [creating, setCreating] = useState(false);

  const [pendingDelete, setPendingDelete] = useState<User | null>(null);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function fetchUsers() {
    try {
      setUsers(await listUsers());
    } catch {
      setError('Failed to load users');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchUsers();
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newUsername.trim() || newPassword.length < 6) return;
    setCreating(true);
    setError(null);
    try {
      const user = await createUser(newUsername.trim(), newPassword);
      setUsers((prev) => [...prev, user]);
      setNewUsername('');
      setNewPassword('');
      setShowCreate(false);
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response
        ?.status;
      setError(
        status === 409 ? 'Username already taken' : 'Failed to create user',
      );
    } finally {
      setCreating(false);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setError(null);
    setDeleting(true);
    try {
      await deleteUser(pendingDelete.id);
      setUsers((prev) => prev.filter((u) => u.id !== pendingDelete.id));
      setPendingDelete(null);
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response
        ?.status;
      setError(
        status === 400
          ? 'Cannot delete the last remaining user'
          : 'Failed to delete user',
      );
      setPendingDelete(null);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <div className="max-w-3xl mx-auto px-6 py-10">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-xl font-semibold">Users</h1>
            <p className="text-sm text-muted-foreground mt-1">
              People who can sign in to this dashboard.
            </p>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="text-sm px-4 py-2 rounded-md bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
          >
            Add user
          </button>
        </div>

        {error && (
          <div className="mb-4 px-4 py-3 rounded-md bg-destructive/10 text-destructive text-sm">
            {error}
          </div>
        )}
        {notice && (
          <div className="mb-4 px-4 py-3 rounded-md bg-muted text-sm">
            {notice}
          </div>
        )}

        {showCreate && (
          <div className="mb-6 p-4 rounded-md border border-border bg-card">
            <h2 className="text-sm font-medium mb-3">New user</h2>
            <form onSubmit={handleCreate} className="flex flex-col gap-3">
              <input
                type="text"
                placeholder="Username"
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                autoComplete="off"
                className="text-sm rounded-md border border-input bg-background px-3 py-2 outline-none focus:ring-1 focus:ring-ring"
                autoFocus
              />
              <PasswordInput
                placeholder="Password (min 6 characters)"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
              />
              <div className="flex items-center gap-3">
                <button
                  type="submit"
                  disabled={
                    creating || !newUsername.trim() || newPassword.length < 6
                  }
                  className="text-sm px-4 py-2 rounded-md bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-opacity"
                >
                  {creating ? 'Creating…' : 'Create'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowCreate(false);
                    setNewUsername('');
                    setNewPassword('');
                  }}
                  className="text-sm px-3 py-2 rounded-md border border-border hover:bg-muted transition-colors"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        <div className="rounded-md border border-border overflow-hidden">
          {loading ? (
            <div className="px-4 py-6 text-sm text-muted-foreground text-center">
              Loading…
            </div>
          ) : users.length === 0 ? (
            <div className="px-4 py-6 text-sm text-muted-foreground text-center">
              No users yet.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                    Username
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                    Created
                  </th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr
                    key={u.id}
                    className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors"
                  >
                    <td className="px-4 py-3 font-medium">
                      {u.username}
                      {currentUser?.userId === u.id && (
                        <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                          You
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {new Date(u.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {currentUser?.userId === u.id ? (
                        <button
                          onClick={() => setShowChangePassword(true)}
                          aria-label="Change your password"
                          title="Change password"
                          className="inline-flex items-center justify-center rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
                        >
                          <KeyRound className="h-4 w-4" />
                        </button>
                      ) : (
                        <button
                          onClick={() => setPendingDelete(u)}
                          className="text-xs text-destructive hover:underline"
                        >
                          Delete
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open && !deleting) setPendingDelete(null);
        }}
      >
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Delete user</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete{' '}
              <span className="font-medium text-foreground">
                {pendingDelete?.username}
              </span>
              ? This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <ChangePasswordDialog
            open={showChangePassword}
            onOpenChange={setShowChangePassword}
            onDone={(message, type) => {
              setNotice(null);
              setError(null);
              if (type === 'success') setNotice(message);
              else setError(message);
            }}
          />
          <DialogFooter className="mt-6 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setPendingDelete(null)}
              disabled={deleting}
              className="px-3.5 py-2 rounded-md border border-border text-sm font-medium hover:bg-muted transition-colors disabled:opacity-40 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirmDelete}
              disabled={deleting}
              className="px-3.5 py-2 rounded-md bg-destructive text-destructive-foreground text-sm font-medium hover:opacity-90 disabled:opacity-40 transition-opacity cursor-pointer"
            >
              {deleting ? 'Deleting…' : 'Delete'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
