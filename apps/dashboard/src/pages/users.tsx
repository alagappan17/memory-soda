import { useState, useEffect } from 'react';
import { KeyRound } from 'lucide-react';
import type { User } from '@memory-soda/types';
import { listUsers, createUser, deleteUser } from '@/lib/api';
import { useAuth } from '@/providers/auth-provider';
import { ChangePasswordDialog } from '@/components/change-password-dialog';
import { PasswordInput } from '@/components/password-input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

// Mounted with the dialog content, so every open starts blank.
function CreateUserForm({
  onCreated,
  onClose,
}: {
  onCreated: (user: User) => void;
  onClose: () => void;
}) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canSubmit = !saving && username.trim() && password.length >= 6;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    setError(null);
    try {
      onCreated(await createUser(username.trim(), password));
      onClose();
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response
        ?.status;
      setError(
        status === 409 ? 'Username already taken' : 'Failed to create user',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>New user</DialogTitle>
        <DialogDescription>
          A dashboard login. Every user can do everything.
        </DialogDescription>
      </DialogHeader>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="new-username">Username</Label>
          <Input
            id="new-username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="off"
            autoFocus
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="new-password">Password</Label>
          <PasswordInput
            id="new-password"
            placeholder="At least 6 characters"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
          />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter className="mt-6">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={!canSubmit}>
            {saving ? 'Creating…' : 'Create'}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}

export default function UsersPage() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<User | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);

  useEffect(() => {
    listUsers()
      .then(setUsers)
      .catch(() => setError('Failed to load users'))
      .finally(() => setLoading(false));
  }, []);

  async function confirmDelete() {
    if (!pendingDelete) return;
    setError(null);
    setDeleting(true);
    try {
      await deleteUser(pendingDelete.id);
      setUsers((prev) => prev.filter((u) => u.id !== pendingDelete.id));
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response
        ?.status;
      setError(
        status === 400
          ? 'Cannot delete the last remaining user'
          : 'Failed to delete user',
      );
    } finally {
      setDeleting(false);
      setPendingDelete(null);
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
          <Button onClick={() => setShowCreate(true)}>Add user</Button>
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

        <div className="rounded-md border border-border overflow-hidden">
          {loading ? (
            <div className="px-4 py-6 text-sm text-muted-foreground text-center">
              Loading…
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Username</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((u) => {
                  const isSelf = currentUser?.userId === u.id;
                  return (
                    <TableRow key={u.id}>
                      <TableCell className="font-medium">
                        {u.username}
                        {isSelf && (
                          <Badge variant="secondary" className="ml-2">
                            You
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {new Date(u.createdAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="text-right">
                        {isSelf ? (
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => setShowChangePassword(true)}
                            aria-label="Change your password"
                            title="Change password"
                          >
                            <KeyRound />
                          </Button>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            onClick={() => setPendingDelete(u)}
                          >
                            Delete
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>
      </div>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="sm:max-w-[425px]">
          <CreateUserForm
            onCreated={(user) => setUsers((prev) => [...prev, user])}
            onClose={() => setShowCreate(false)}
          />
        </DialogContent>
      </Dialog>

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
          <DialogFooter className="mt-6">
            <Button
              variant="outline"
              onClick={() => setPendingDelete(null)}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={confirmDelete}
              disabled={deleting}
            >
              {deleting ? 'Deleting…' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
