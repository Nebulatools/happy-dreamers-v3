import { loadEnvConfig } from '@next/env';
import { EnvValidationError, getEnv } from '../lib/env';

const main = () => {
  loadEnvConfig(process.cwd());

  try {
    const validatedEnv = getEnv();
    const presentKeys = Object.keys(validatedEnv);

    console.info('[env] Validated required environment keys:', presentKeys.join(', '));
  } catch (error) {
    if (error instanceof EnvValidationError) {
      console.error('[env] Missing or invalid environment keys:', error.missingKeys.join(', '));
    } else {
      console.error('[env] Unexpected error while validating environment variables.');
    }
    process.exit(1);
  }
};

main();
