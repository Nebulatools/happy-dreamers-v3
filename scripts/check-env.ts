import { EnvValidationError, getEnv } from '../lib/env';

const main = () => {
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
