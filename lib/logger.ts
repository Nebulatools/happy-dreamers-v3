import crypto from 'node:crypto';
import pino, { Logger, LoggerOptions } from 'pino';

type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

const redactFields = ['req.headers.authorization', 'req.body.password', 'user.email', 'user.phone'];

const getLogLevel = (): LogLevel => {
  const env = process.env.NODE_ENV ?? 'development';
  if (env === 'production') {
    return 'info';
  }
  if (env === 'test') {
    return 'silent';
  }
  return 'debug';
};

const baseLoggerOptions: LoggerOptions = {
  level: getLogLevel(),
  redact: {
    paths: redactFields,
    remove: true,
  },
  formatters: {
    level(label) {
      return { level: label };
    },
    bindings(bindings) {
      return {
        pid: bindings.pid,
        hostname: bindings.hostname,
      };
    },
  },
};

const rootLogger = pino(baseLoggerOptions);

export const getCorrelationId = (headers?: Headers | Record<string, string | undefined>) => {
  const headerKey = 'x-correlation-id';

  if (headers instanceof Headers) {
    const value = headers.get(headerKey);
    if (value) {
      return value;
    }
  } else if (headers) {
    const value = headers[headerKey] ?? headers[headerKey.toLowerCase()];
    if (value) {
      return value;
    }
  }

  return crypto.randomUUID();
};

export const createRequestLogger = (
  correlationId: string,
  bindings: Record<string, unknown> = {},
) => {
  return rootLogger.child({
    correlationId,
    ...bindings,
  });
};

export const childLogger = (scope: string, bindings: Record<string, unknown> = {}) =>
  rootLogger.child({ scope, ...bindings });

export const logger = rootLogger;

export type AppLogger = Logger;
