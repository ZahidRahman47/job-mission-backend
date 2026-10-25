// Liveness (process up) and readiness (MongoDB reachable and not shutting down) (NFR-023).
import type { Request, Response } from 'express';
import { pingDatabase } from '../../db/connect.ts';

let shuttingDown = false;

// Called by server.ts on SIGTERM so load balancers stop sending new traffic before we close.
export function markShuttingDown(): void {
  shuttingDown = true;
}

// "Is the process alive?" No dependencies: if this fails, the host should restart the process.
export function live(_req: Request, res: Response): void {
  res.json({ status: 'ok' });
}

// "Can this instance serve traffic right now?" If not, route traffic elsewhere, but don't restart.
export async function ready(_req: Request, res: Response): Promise<void> {
  if (shuttingDown) {
    res.status(503).json({ status: 'shutting_down' });
    return;
  }

  const databaseOk = await pingDatabase();
  res.status(databaseOk ? 200 : 503).json({
    status: databaseOk ? 'ok' : 'unavailable',
    checks: { database: databaseOk ? 'ok' : 'down' },
  });
}
