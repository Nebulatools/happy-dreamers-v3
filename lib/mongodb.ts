import { createRequire } from 'node:module';
import { MongoClient, MongoClientOptions, Db, Document } from 'mongodb';
import { env } from './env';
import { childLogger } from './logger';

const log = childLogger('mongodb');

const require = createRequire(import.meta.url);

type CompressorName = 'none' | 'snappy' | 'zlib' | 'zstd';

const DEFAULT_COMPRESSORS: ReadonlyArray<CompressorName> = ['snappy', 'zlib'];

const resolveCompressors = (): Exclude<MongoClientOptions['compressors'], string> => {
  const negotiated: CompressorName[] = [];

  for (const compressor of DEFAULT_COMPRESSORS) {
    if (compressor === 'snappy') {
      try {
        require.resolve('@mongodb-js/snappy');
        negotiated.push(compressor);
      } catch (error) {
        log.warn(
          { reason: (error as Error).message },
          'snappy compressor unavailable, falling back to remaining options',
        );
      }
      continue;
    }

    negotiated.push(compressor);
  }

  return negotiated;
};

const mongoClientOptions: MongoClientOptions = {
  // NFR (Scalabilidad): dimensionar correctamente el pool evita tormentas de conexiones bajo carga alta.
  maxPoolSize: 10,
  minPoolSize: 2,
  maxIdleTimeMS: 30_000,
  retryWrites: true,
  compressors: resolveCompressors(),
};

let cachedClient: MongoClient | null = null;
let clientPromise: Promise<MongoClient> | null = null;
let cachedDb: Db | null = null;

const isClientUsable = (client: MongoClient | null) => {
  if (!client) {
    return false;
  }

  const topology = (client as unknown as { topology?: { isDestroyed?: () => boolean } }).topology;
  if (topology?.isDestroyed?.()) {
    return false;
  }

  return true;
};

const createMongoClient = () => {
  const uri = env.MONGODB_URI;
  log.debug({ uri: uri.replace(/\/\/[^@]*@/, '//***:***@') }, 'creating MongoDB client');
  return new MongoClient(uri, mongoClientOptions);
};

const connectClient = async () => {
  if (isClientUsable(cachedClient)) {
    return cachedClient as MongoClient;
  }

  if (!clientPromise) {
    clientPromise = createMongoClient()
      .connect()
      .then((client) => {
        cachedClient = client;
        cachedDb = null;
        log.debug('MongoDB client connected');
        return client;
      })
      .catch((error) => {
        log.error({ error }, 'MongoDB connection failed');
        clientPromise = null;
        throw error;
      });
  }

  return clientPromise;
};

export const getDb = async (database?: string) => {
  const client = await connectClient();

  if (database) {
    return client.db(database);
  }

  if (!cachedDb) {
    cachedDb = client.db();
  }

  return cachedDb;
};

export type HealthCheckResult =
  | { ok: true; latencyMs: number }
  | { ok: false; error: string };

export const healthCheck = async (): Promise<HealthCheckResult> => {
  try {
    const start = Date.now();
    const db = await getDb();
    await db.command({ ping: 1 });
    const latencyMs = Date.now() - start;

    return { ok: true, latencyMs };
  } catch (error) {
    log.warn({ error }, 'MongoDB health check failed');
    return { ok: false, error: (error as Error).message };
  }
};

export type ConnectionStats = {
  ok: boolean;
  connections?: {
    current?: number;
    available?: number;
    totalCreated?: number;
  };
  pool?: {
    maxPoolSize: number;
    minPoolSize: number;
    maxIdleTimeMS: number;
  };
  error?: string;
};

export const getConnectionStats = async (): Promise<ConnectionStats> => {
  try {
    const client = await connectClient();
    const db = client.db();
    const adminDb = db.admin();
    const serverStatus = (await adminDb.command({ serverStatus: 1 })) as Document;
    const connections = (serverStatus.connections ?? {}) as Record<string, number>;

    return {
      ok: true,
      connections: {
        current: connections.current,
        available: connections.available,
        totalCreated: connections.totalCreated,
      },
      pool: {
        maxPoolSize: mongoClientOptions.maxPoolSize ?? 0,
        minPoolSize: mongoClientOptions.minPoolSize ?? 0,
        maxIdleTimeMS: mongoClientOptions.maxIdleTimeMS ?? 0,
      },
    };
  } catch (error) {
    log.error({ error }, 'Failed to retrieve MongoDB connection stats');
    return {
      ok: false,
      pool: {
        maxPoolSize: mongoClientOptions.maxPoolSize ?? 0,
        minPoolSize: mongoClientOptions.minPoolSize ?? 0,
        maxIdleTimeMS: mongoClientOptions.maxIdleTimeMS ?? 0,
      },
      error: (error as Error).message,
    };
  }
};

export const closeConnection = async () => {
  if (cachedClient) {
    try {
      await cachedClient.close();
      log.debug('MongoDB client closed');
    } catch (error) {
      log.error({ error }, 'Error closing MongoDB client');
    }
  }

  cachedClient = null;
  cachedDb = null;
  clientPromise = null;
};
