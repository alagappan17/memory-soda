import { useState, useEffect, useCallback } from 'react';
import api from '@/lib/api';

type ServiceStatus = 'ok' | 'error' | 'checking';

interface HealthData {
  status: 'ok' | 'error';
  services: {
    postgres: 'ok' | 'error';
    redis: 'ok' | 'error';
  };
}

const SERVICE_LABELS: Record<string, string> = {
  postgres: 'Postgres',
  redis: 'Redis',
};

function StatusDot({ status }: { status: ServiceStatus }) {
  if (status === 'checking') {
    return <span className="inline-block w-2.5 h-2.5 rounded-full bg-yellow-400 animate-pulse" />;
  }
  return (
    <span
      className={`inline-block w-2.5 h-2.5 rounded-full ${
        status === 'ok' ? 'bg-green-500' : 'bg-red-500'
      }`}
    />
  );
}

export default function StatusPage() {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);

  const apiUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:3004';

  const check = useCallback(async () => {
    setChecking(true);
    setError(null);
    try {
      const res = await api.get<HealthData>('/health');
      setHealth(res.data);
      setLastChecked(new Date());
    } catch {
      setError('Could not reach API');
      setHealth(null);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    check();
  }, [check]);

  const services = health
    ? Object.entries(health.services)
    : [['postgres', null], ['redis', null]];

  return (
    <div className="max-w-lg mx-auto px-6 py-12">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-xl font-semibold">System Status</h1>
          <p className="text-sm text-muted-foreground mt-1">
            API:{' '}
            <span className="font-mono text-xs">{apiUrl}</span>
          </p>
        </div>
        <button
          onClick={check}
          disabled={checking}
          className="text-sm px-3 py-1.5 rounded border border-border hover:bg-muted transition-colors disabled:opacity-50"
        >
          {checking ? 'Checking…' : 'Re-check'}
        </button>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error} — is the API running?
        </div>
      ) : (
        <div className="rounded-lg border border-border divide-y divide-border">
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-sm font-medium">API</span>
            <div className="flex items-center gap-2">
              <StatusDot status={checking ? 'checking' : health ? 'ok' : 'error'} />
              <span className="text-xs text-muted-foreground capitalize">
                {checking ? 'checking' : health ? 'reachable' : 'unreachable'}
              </span>
            </div>
          </div>
          {services.map(([key, val]) => (
            <div key={key as string} className="flex items-center justify-between px-4 py-3">
              <span className="text-sm">{SERVICE_LABELS[key as string] ?? key}</span>
              <div className="flex items-center gap-2">
                <StatusDot status={checking ? 'checking' : (val as ServiceStatus) ?? 'error'} />
                <span className="text-xs text-muted-foreground capitalize">
                  {checking ? 'checking' : (val as string) ?? 'error'}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {lastChecked && !checking && (
        <p className="text-xs text-muted-foreground mt-4">
          Last checked {lastChecked.toLocaleTimeString()}
        </p>
      )}
    </div>
  );
}
