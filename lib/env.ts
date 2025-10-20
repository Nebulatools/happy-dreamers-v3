import { z } from 'zod';

const requiredString = (name: string) =>
  z.string().trim().min(1, `${name} must not be empty`);

const envSchema = z
  .object({
    ZOOM_WEBHOOK_SECRET: requiredString('ZOOM_WEBHOOK_SECRET'),
    GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY: requiredString('GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY'),
    MONGODB_URI: requiredString('MONGODB_URI'),
    NEXTAUTH_SECRET: requiredString('NEXTAUTH_SECRET'),
    ENABLE_DEBUG_ENDPOINTS: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
  })
  .passthrough();

export class EnvValidationError extends Error {
  constructor(public readonly missingKeys: string[]) {
    super(`[env] Missing or invalid environment variables: ${missingKeys.join(', ')}`);
    this.name = 'EnvValidationError';
  }
}

const formatIssues = (issues: readonly z.ZodIssue[]) => {
  const keys = new Set<string>();
  for (const issue of issues) {
    const key = issue.path.join('.');
    if (key) {
      keys.add(key);
    } else if (issue.message) {
      keys.add(issue.message);
    }
  }
  return Array.from(keys);
};

export const loadEnv = () => {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    throw new EnvValidationError(formatIssues(parsed.error.issues));
  }

  const env = {
    ZOOM_WEBHOOK_SECRET: parsed.data.ZOOM_WEBHOOK_SECRET,
    GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY: parsed.data.GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY,
    MONGODB_URI: parsed.data.MONGODB_URI,
    NEXTAUTH_SECRET: parsed.data.NEXTAUTH_SECRET,
    ENABLE_DEBUG_ENDPOINTS: parsed.data.ENABLE_DEBUG_ENDPOINTS,
  } as const;

  return env;
};

export type AppEnv = ReturnType<typeof loadEnv>;

let cachedEnv: AppEnv | null = null;

export const getEnv = () => {
  if (!cachedEnv) {
    cachedEnv = loadEnv();
  }
  return cachedEnv;
};

export const env = new Proxy({} as AppEnv, {
  get(_target, property, receiver) {
    const value = Reflect.get(getEnv(), property, receiver);
    return value;
  },
  ownKeys() {
    return Reflect.ownKeys(getEnv());
  },
  getOwnPropertyDescriptor(_target, property) {
    return Object.getOwnPropertyDescriptor(getEnv(), property);
  },
});
