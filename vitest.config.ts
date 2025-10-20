import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(dirname, '.'),
      '@components': path.resolve(dirname, 'components'),
      '@lib': path.resolve(dirname, 'lib'),
    },
  },
  test: {
    environment: 'node',
  },
});
