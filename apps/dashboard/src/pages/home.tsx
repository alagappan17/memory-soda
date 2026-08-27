import { Link } from 'react-router-dom';
import {
  Folder,
  Users,
  Activity,
  Database,
  FlaskConical,
  KeyRound,
  Settings,
  ArrowRight,
} from 'lucide-react';
import { useAuth } from '@/providers/auth-provider';
import { useProject } from '@/providers/project-provider';

interface Item {
  to: string;
  label: string;
  description: string;
  icon: React.ElementType;
}

const applicationItems: Item[] = [
  {
    to: '/projects',
    label: 'Projects',
    description: 'Create and switch between projects.',
    icon: Folder,
  },
  {
    to: '/users',
    label: 'Users',
    description: 'Manage who can sign in to this dashboard.',
    icon: Users,
  },
  {
    to: '/status',
    label: 'Status',
    description: 'Check system and service health.',
    icon: Activity,
  },
];

const projectItems: Item[] = [
  {
    to: '/datasets',
    label: 'Datasets',
    description: 'Browse conversations, episodes, and facts.',
    icon: Database,
  },
  {
    to: '/playground',
    label: 'Playground',
    description: 'Exercise the memory API interactively.',
    icon: FlaskConical,
  },
  {
    to: '/api-keys',
    label: 'API Keys',
    description: 'Issue and revoke keys for the SDK.',
    icon: KeyRound,
  },
];

function Card({ item }: { item: Item }) {
  const { icon: Icon } = item;
  return (
    <Link
      to={item.to}
      className="group flex items-start gap-3 rounded-lg border border-border bg-card p-4 hover:border-primary/40 hover:bg-muted/40 transition-colors"
    >
      <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
        <Icon className="h-[18px] w-[18px]" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-medium">{item.label}</span>
          <ArrowRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all" />
        </div>
        <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
          {item.description}
        </p>
      </div>
    </Link>
  );
}

function Section({ title, items }: { title: string; items: Item[] }) {
  return (
    <section>
      <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-3">
        {title}
      </h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => (
          <Card key={item.to} item={item} />
        ))}
      </div>
    </section>
  );
}

export default function HomePage() {
  const { user } = useAuth();
  const { selectedProject } = useProject();

  const projectSettingsItem: Item | null = selectedProject
    ? {
        to: `/projects/${selectedProject.id}/settings`,
        label: 'Project Settings',
        description: 'Configure defaults for this project.',
        icon: Settings,
      }
    : null;

  return (
    <div className="max-w-4xl mx-auto px-6 py-10 space-y-10">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          Welcome back{user ? `, ${user.username}` : ''}
        </h1>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Memory Soda is a semantic memory layer for AI agents.
          {selectedProject ? (
            <>
              {' '}
              You&apos;re working in{' '}
              <span className="font-medium text-foreground">
                {selectedProject.name}
              </span>
              .
            </>
          ) : null}{' '}
          Jump into a section below to get started.
        </p>
      </header>

      <Section title="Application" items={applicationItems} />

      <Section
        title="Project"
        items={
          projectSettingsItem
            ? [...projectItems, projectSettingsItem]
            : projectItems
        }
      />
    </div>
  );
}
