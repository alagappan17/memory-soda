import { useMemo } from 'react';
import { CopyButton } from '../../components/copy-button';

export function JsonBlock({ label, value }: { label: string; value: unknown }) {
  // Payloads can be multi-KB (verbose recall); don't re-stringify per render.
  const text = useMemo(
    () => (typeof value === 'string' ? value : JSON.stringify(value, null, 2)),
    [value],
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-0.5">
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        <CopyButton
          text={text}
          label="copy"
          copiedLabel="✓ copied"
          className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
        />
      </div>
      <pre className="text-[10px] font-mono bg-muted/40 border border-border rounded p-2 whitespace-pre-wrap break-words max-h-64 overflow-y-auto leading-relaxed">
        {text}
      </pre>
    </div>
  );
}
