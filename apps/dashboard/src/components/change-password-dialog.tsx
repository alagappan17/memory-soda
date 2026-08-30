import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useAuth } from '@/providers/auth-provider';
import { PasswordInput } from '@/components/password-input';

export function ChangePasswordDialog({
  open,
  onOpenChange,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: (message: string, type: 'success' | 'error') => void;
}) {
  const { changePassword, usingDefaultPassword } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tooShort = next.length > 0 && next.length < 6;
  const sameAsCurrent = next.length > 0 && next === current;
  const mismatch = confirm.length > 0 && next !== confirm;
  const canSubmit =
    current &&
    next.length >= 6 &&
    !sameAsCurrent &&
    next === confirm &&
    !saving;

  function reset() {
    setCurrent('');
    setNext('');
    setConfirm('');
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    setError(null);
    try {
      await changePassword(current, next);
      reset();
      onOpenChange(false);
      onDone('Password changed', 'success');
    } catch (err) {
      const msg =
        err instanceof Error && 'response' in err
          ? ((err as { response?: { data?: { error?: string } } }).response
              ?.data?.error ?? err.message)
          : 'Could not change password';
      setError(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Change password</DialogTitle>
          <DialogDescription>
            {usingDefaultPassword
              ? 'This account still uses the default password that ships with Memory Soda. Pick your own.'
              : 'Choose a new password for your dashboard login.'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium leading-none">
              Current password
            </label>
            <PasswordInput
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              autoComplete="current-password"
              required
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium leading-none">
              New password
            </label>
            <PasswordInput
              placeholder="At least 6 characters"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              autoComplete="new-password"
              required
            />
            {tooShort && (
              <p className="text-xs text-destructive">
                At least 6 characters ({next.length}/6).
              </p>
            )}
            {sameAsCurrent && (
              <p className="text-xs text-destructive">
                New password must differ from the current one.
              </p>
            )}
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium leading-none">
              Confirm new password
            </label>
            <PasswordInput
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              required
            />
            {mismatch && (
              <p className="text-xs text-destructive">
                Passwords do not match.
              </p>
            )}
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter className="mt-6 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                reset();
                onOpenChange(false);
              }}
              className="px-3.5 py-2 rounded-md border border-border text-sm font-medium hover:bg-muted transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className="px-3.5 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-40 transition-opacity cursor-pointer"
            >
              {saving ? 'Saving…' : 'Change password'}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
