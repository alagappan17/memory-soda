import { Link } from 'react-router-dom';

export default function HomePage() {
  return (
    <div className="max-w-xl mx-auto px-6 py-20 text-center space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">memory-soda</h1>
      <p className="text-muted-foreground text-sm leading-relaxed">
        A semantic memory layer for AI agents. Store, retrieve, and evolve user knowledge
        using a graph-backed, LLM-powered pipeline.
      </p>
      <div className="flex items-center justify-center gap-4 pt-2">
        <Link
          to="/playground"
          className="px-5 py-2.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity"
        >
          Open Playground
        </Link>
        <Link
          to="/api-keys"
          className="px-5 py-2.5 rounded-md border border-border text-sm font-medium hover:bg-muted transition-colors"
        >
          Manage API Keys
        </Link>
      </div>
    </div>
  );
}
