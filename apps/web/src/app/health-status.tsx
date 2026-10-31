'use client';

import type { HealthResponse } from '@shopsphere/types';
import { useQuery } from '@tanstack/react-query';
import { API_URL, apiGet } from '@/lib/api';

export function HealthStatus() {
  const { data, error, isPending } = useQuery({
    queryKey: ['healthz'],
    queryFn: () => apiGet<HealthResponse>('/healthz'),
    refetchInterval: 10_000,
  });

  if (isPending) return <p className="text-slate-500">Checking API at {API_URL}...</p>;
  if (error) return <p className="font-medium text-red-700">API unreachable: {error.message}</p>;

  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
      <dt className="font-medium">API status</dt>
      <dd
        data-testid="api-status"
        className={data.status === 'ok' ? 'text-green-700' : 'text-amber-700'}
      >
        {data.status}
      </dd>
      {Object.entries(data.checks).map(([name, state]) => (
        <div key={name} className="contents">
          <dt className="font-medium">{name}</dt>
          <dd>{state}</dd>
        </div>
      ))}
      <dt className="font-medium">Checked at</dt>
      <dd>{new Date(data.time).toLocaleString()}</dd>
    </dl>
  );
}
