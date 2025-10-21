import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { NextRequest } from 'next/server';

const authMock = vi.hoisted(() => ({
  auth: vi.fn(),
}));

const dbMock = vi.hoisted(() => ({
  getDb: vi.fn(),
}));

vi.mock('@/auth', () => authMock);
vi.mock('@/lib/mongodb', () => dbMock);

const setRequiredEnv = () => {
  process.env.ZOOM_WEBHOOK_SECRET = process.env.ZOOM_WEBHOOK_SECRET ?? 'test-zoom';
  process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY =
    process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY ?? 'test-drive';
  process.env.MONGODB_URI = process.env.MONGODB_URI ?? 'mongodb://localhost:27017/test';
  process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET ?? 'test-nextauth';
  process.env.ENABLE_DEBUG_ENDPOINTS = 'true';
};

const createRequest = () => new NextRequest('http://localhost/api/users/debug');
const createContext = () => ({ params: Promise.resolve({}) });

const buildSession = (role: 'user' | 'pro' | 'admin') => ({
  user: {
    id: 'user-id',
    email: 'user@example.com',
    name: 'Test User',
    role,
  },
  expires: new Date(Date.now() + 60_000).toISOString(),
});

const obfuscateId = (value: string) =>
  createHash('sha256').update(value).digest('hex').slice(0, 12);

describe('GET /api/users/debug', () => {
  beforeEach(() => {
    vi.resetModules();
    setRequiredEnv();
    authMock.auth.mockReset();
    dbMock.getDb.mockReset();
  });

  test('rejects unauthenticated requests with 401', async () => {
    authMock.auth.mockResolvedValue(null);

    const { GET } = await import('@/app/api/users/debug/route');

    const response = await GET(createRequest(), createContext());

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Unauthorized' });
    expect(dbMock.getDb).not.toHaveBeenCalled();
  });

  test('rejects non-admin roles with 403', async () => {
    authMock.auth.mockResolvedValue(buildSession('pro'));

    const { GET } = await import('@/app/api/users/debug/route');

    const response = await GET(createRequest(), createContext());

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'Forbidden' });
    expect(dbMock.getDb).not.toHaveBeenCalled();
  });

  test('returns sanitized users for admin role', async () => {
    authMock.auth.mockResolvedValue(buildSession('admin'));

    const users = [
      {
        _id: '507f1f77bcf86cd799439011',
        email: 'alice@example.com',
        role: 'admin',
        createdAt: new Date('2024-01-01T00:00:00Z'),
      },
      {
        _id: '507f1f77bcf86cd799439012',
        email: null,
        role: 'user',
        createdAt: null,
      },
    ];

    const toArray = vi.fn().mockResolvedValue(users);
    const limit = vi.fn(() => ({ toArray }));
    const find = vi.fn(() => ({ limit }));
    const collection = vi.fn(() => ({ find }));

    dbMock.getDb.mockResolvedValue({
      collection,
    });

    const { GET } = await import('@/app/api/users/debug/route');

    const response = await GET(createRequest(), createContext());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(collection).toHaveBeenCalledWith('users');
    expect(find).toHaveBeenCalledWith({}, { projection: { email: 1, role: 1, createdAt: 1 } });
    expect(limit).toHaveBeenCalledWith(50);

    expect(data.count).toBe(2);
    expect(data.users).toEqual([
      {
        id: obfuscateId('507f1f77bcf86cd799439011'),
        role: 'admin',
        emailHash: createHash('sha256').update('alice@example.com').digest('hex').slice(0, 12),
        createdAt: '2024-01-01T00:00:00.000Z',
      },
      {
        id: obfuscateId('507f1f77bcf86cd799439012'),
        role: 'user',
        emailHash: null,
        createdAt: null,
      },
    ]);
  });

  test('returns 404 when debug endpoints are disabled', async () => {
    process.env.ENABLE_DEBUG_ENDPOINTS = 'false';
    authMock.auth.mockResolvedValue(buildSession('admin'));

    const { GET } = await import('@/app/api/users/debug/route');

    const response = await GET(createRequest(), createContext());
    expect(response.status).toBe(404);
  });
});
