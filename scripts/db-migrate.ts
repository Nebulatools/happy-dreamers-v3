import process from 'node:process';
import { pathToFileURL } from 'node:url';
import type { CreateIndexesOptions } from 'mongodb';
import { closeConnection, getDb } from '../lib/mongodb';
import { childLogger } from '../lib/logger';
import { getEnv } from '../lib/env';

const log = childLogger('db:migrate');

type IndexSpec = {
  collection: string;
  keys: Record<string, 1 | -1>;
  options?: CreateIndexesOptions;
};

const indexSpecs: IndexSpec[] = [
  {
    collection: 'events',
    keys: { childId: 1, startTime: 1 },
    options: { name: 'events_childId_startTime' },
  },
  {
    collection: 'children',
    keys: { parentId: 1 },
    options: { name: 'children_parentId' },
  },
  {
    collection: 'plans',
    keys: { childId: 1, status: 1 },
    options: { name: 'plans_childId_status' },
  },
];

const runMigrations = async () => {
  getEnv();

  const db = await getDb();

  for (const spec of indexSpecs) {
    const collection = db.collection(spec.collection);
    await collection.createIndex(spec.keys, spec.options);
    log.info({ collection: spec.collection, index: spec.options?.name }, 'index ensured');
  }

  log.info('database indexes ensured');
};

const main = async () => {
  try {
    await runMigrations();
    process.exitCode = 0;
  } catch (error) {
    log.error({ error }, 'migration failed');
    process.exitCode = 1;
  } finally {
    await closeConnection();
  }
};

const isExecutedDirectly = () => {
  const executedUrl = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
  return executedUrl === import.meta.url;
};

if (isExecutedDirectly()) {
  main();
}
