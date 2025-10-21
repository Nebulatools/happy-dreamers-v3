import { NextResponse, type NextRequest } from 'next/server';
import { getEnv, EnvValidationError } from '@/lib/env';
import { createRequestLogger, getCorrelationId } from '@/lib/logger';
import { healthCheck } from '@/lib/mongodb';
import { getBuildInfo, resetBuildInfoCache } from '@/lib/build-info';

type HealthDbStatus =
  | {
      ok: true;
      pingMs: number;
    }
  | {
      ok: false;
      error: string;
    };

type HealthEnvStatus =
  | {
      ok: true;
    }
  | {
      ok: false;
      missing: string[];
    };

type HealthResponseBody = {
  ok: boolean;
  uptime: number;
  db: HealthDbStatus;
  env: HealthEnvStatus;
  build: ReturnType<typeof getBuildInfo>;
};

const validateEnvironment = (): HealthEnvStatus => {
  try {
    getEnv();
    return { ok: true };
  } catch (error) {
    if (error instanceof EnvValidationError) {
      return {
        ok: false,
        missing: error.missingKeys,
      };
    }

    return {
      ok: false,
      missing: ['unexpected-env-error'],
    };
  }
};

const getDbStatus = async (): Promise<HealthDbStatus> => {
  const result = await healthCheck();

  if (result.ok) {
    return {
      ok: true,
      pingMs: result.latencyMs,
    };
  }

  return {
    ok: false,
    error: result.error,
  };
};

const buildHealthPayload = async (): Promise<HealthResponseBody> => {
  const [envStatus, dbStatus] = await Promise.all([validateEnvironment(), getDbStatus()]);
  const uptime = process.uptime();
  const build = getBuildInfo();

  return {
    ok: envStatus.ok && dbStatus.ok,
    uptime,
    db: dbStatus,
    env: envStatus,
    build,
  };
};

export const GET = async (request: NextRequest) => {
  const correlationId = getCorrelationId(request.headers);
  request.headers.set('x-correlation-id', correlationId);

  const log = createRequestLogger(correlationId, {
    scope: 'healthz',
    path: request.nextUrl.pathname,
    method: request.method,
  });

  const payload = await buildHealthPayload();
  const status = payload.ok ? 200 : 503;

  if (!payload.env.ok) {
    log.error({ missing: payload.env.missing }, 'environment validation failed');
  }

  if (!payload.db.ok) {
    log.error({ error: payload.db.error }, 'database health check failed');
  }

  if (status === 200) {
    log.debug({ uptime: payload.uptime, pingMs: payload.db.ok ? payload.db.pingMs : null }, 'healthz ok');
  } else {
    log.warn({ status }, 'healthz degraded');
  }

  // Build info can change between deployments, make sure we can refresh if env vars are updated.
  resetBuildInfoCache();

  const response = NextResponse.json(payload, {
    status,
  });

  response.headers.set('x-correlation-id', correlationId);

  return response;
};
