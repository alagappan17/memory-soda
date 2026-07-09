import { useState } from 'react';

/** Clipboard copy with transient ✓ feedback. */
export function CopyButton({
  text,
  title = 'Copy',
  label,
  copiedLabel,
  className = 'text-xs text-muted-foreground hover:text-foreground px-1.5 py-1 rounded transition-colors',
}: {
  text: string;
  title?: string;
  /** Idle content; defaults to the ⎘ glyph. */
  label?: React.ReactNode;
  /** Content while showing feedback; defaults to ✓. */
  copiedLabel?: React.ReactNode;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        void navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className={className}
      title={title}
    >
      {copied ? (copiedLabel ?? '✓') : (label ?? '⎘')}
    </button>
  );
}
