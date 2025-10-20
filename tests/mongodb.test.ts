import { beforeEach, describe, expect, test, vi } from 'vitest';

const mockState = vi.hoisted(() => ({
  connectCalls: 0,
  closeCalls: 0,
  connectShouldFail: false,
  pingShouldFail: false,
  serverStatus: {
    connections: {
      current: 1,
      available: 9,
      totalCreated: 2,
    },
  },
}));

const makeLoggerMock = () => ({
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

vi.mock('../lib/logger', () => ({
  childLogger: () => makeLoggerMock(),
}));

vi.mock('mongodb', () => {
  class MockDb {
    command = vi.fn(async (command: { ping?: number }) => {
      if (command?.ping === 1) {
        if (mockState.pingShouldFail) {
          throw new Error('simulated ping failure');
        }
        return { ok: 1 };
      }
      return {};
    });

    admin() {
      return {
        command: vi.fn(async () => mockState.serverStatus),
      };
    }
  }

  class MockMongoClient {
    private readonly dbInstance = new MockDb();
    private destroyed = false;

    constructor(public readonly uri: string, public readonly options: unknown) {}

    async connect() {
      mockState.connectCalls += 1;
      if (mockState.connectShouldFail) {
        throw new Error('simulated connection failure');
      }
      return this;
    }

    db() {
      return this.dbInstance;
    }

    async close() {
      mockState.closeCalls += 1;
      this.destroyed = true;
    }

    get topology() {
      return {
        isDestroyed: () => this.destroyed,
      };
    }
  }

  return { MongoClient: MockMongoClient };
});

const setRequiredEnv = () => {
  process.env.ZOOM_WEBHOOK_SECRET = process.env.ZOOM_WEBHOOK_SECRET ?? 'test-zoom';
  process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY =
    process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY ?? 'test-drive';
  process.env.MONGODB_URI = process.env.MONGODB_URI ?? 'mongodb://localhost:27017/test';
  process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET ?? 'test-nextauth';
};

describe('lib/mongodb', () => {
  beforeEach(() => {
    mockState.connectCalls = 0;
    mockState.closeCalls = 0;
    mockState.connectShouldFail = false;
    mockState.pingShouldFail = false;
    mockState.serverStatus = {
      connections: {
        current: 1,
        available: 9,
        totalCreated: 2,
      },
    };
    vi.resetModules();
    setRequiredEnv();
  });

  test('reuses the same MongoClient instance for consecutive calls', async () => {
    const { getDb } = await import('../lib/mongodb');

    const dbA = await getDb();
    const dbB = await getDb();

    expect(dbA).toBe(dbB);
    expect(mockState.connectCalls).toBe(1);
  });

  test('reports healthy status when ping succeeds', async () => {
    const { healthCheck } = await import('../lib/mongodb');

    const result = await healthCheck();

    expect(result.ok).toBe(true);
    expect(result).toHaveProperty('latencyMs');
    expect((result as { latencyMs: number }).latencyMs).toBeGreaterThanOrEqual(0);
  });

  test('returns current pool metrics from serverStatus', async () => {
    const { getConnectionStats } = await import('../lib/mongodb');

    mockState.serverStatus = {
      connections: {
        current: 4,
        available: 6,
        totalCreated: 10,
      },
    };

    const stats = await getConnectionStats();

    expect(stats.ok).toBe(true);
    expect(stats.connections).toEqual({
      current: 4,
      available: 6,
      totalCreated: 10,
    });
    expect(stats.pool).toMatchObject({
      maxPoolSize: 10,
      minPoolSize: 2,
      maxIdleTimeMS: 30_000,
    });
  });

  test('simulates reconnection after manual close', async () => {
    const mongoModule = await import('../lib/mongodb');

    await mongoModule.getDb();
    expect(mockState.connectCalls).toBe(1);

    await mongoModule.closeConnection();

    const dbAfterReconnect = await mongoModule.getDb();
    expect(dbAfterReconnect).toBeDefined();
    expect(mockState.connectCalls).toBe(2);
  });

  test('health check surfaces errors when ping fails', async () => {
    mockState.pingShouldFail = true;
    const { healthCheck } = await import('../lib/mongodb');

    const result = await healthCheck();

    expect(result.ok).toBe(false);
    expect(result).toHaveProperty('error');
  });
});
