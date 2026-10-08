import { useEffect, useState } from 'react';
import type { HealthStatus } from '@latency-wars/contracts';
import { fetchHealth } from './health-client';

export function App() {
  const [status, setStatus] = useState<HealthStatus | 'checking'>('checking');

  useEffect(() => {
    let cancelled = false;
    fetchHealth().then((s) => {
      if (!cancelled) setStatus(s);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="hello">
      <h1>
        Hello, API is{' '}
        <span className={`status status--${status}`}>
          {status === 'checking' ? '…' : status}
        </span>
      </h1>
    </main>
  );
}

export default App;
