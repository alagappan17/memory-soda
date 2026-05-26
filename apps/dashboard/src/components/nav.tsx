import Link from 'next/link';

export default function Nav() {
  return (
    <nav className="border-b border-border bg-card px-6 py-3 flex items-center gap-6">
      <Link href="/" className="font-semibold text-foreground tracking-tight">
        memory-soda
      </Link>
      <div className="flex items-center gap-4 text-sm">
        <Link
          href="/playground"
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          Playground
        </Link>
        <Link
          href="/api-keys"
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          API Keys
        </Link>
        <Link
          href="/status"
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          Status
        </Link>
      </div>
    </nav>
  );
}
