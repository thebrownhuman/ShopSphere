import { execSync, spawn } from 'node:child_process';
import path from 'node:path';
import { STACK_ENV } from '../playwright.checkout-api.config';

/**
 * Starts apps/workers (order event feed → invoices + notifications) next to the web servers.
 * Playwright webServer needs an HTTP readiness URL, which the worker process does not have.
 */
export default async function globalSetup(): Promise<() => void> {
  const cwd = path.resolve(__dirname, '../../workers');
  execSync('npm run build', { cwd, stdio: 'ignore' });
  const child = spawn(process.execPath, ['dist/index.js'], {
    cwd,
    env: { ...process.env, ...STACK_ENV, ORDER_EVENTS_INTERVAL_MS: '1000' },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  // The feed starts at the newest event, so give it one tick before orders are placed.
  await new Promise((r) => setTimeout(r, 2_000));
  return () => {
    child.kill();
  };
}
