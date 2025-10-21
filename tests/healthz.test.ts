import { beforeEach, describe, expect, test, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mongodbMock = vi.hoisted(() => ({
  healthCheck: vi.fn(),
}));

vi.mock('@/lib/mongodb', () => mongodbMock);

const setRequiredEnv = () => {
  process.env.ZOOM_WEBHOOK_SECRET = 'test-zoom-secret';
  process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY = 'test-drive-key';
  process.env.MONGODB_URI = 'mongodb://localhost:27017/test';
  process.env.NEXTAUTH_SECRET = 'test-nextauth';
};

const clearBuildEnv = () => {
  delete process.env.BUILD_SHA;
  delete process.env.BUILD_TIMESTAMP;
  delete process.env.VERCEL_GIT_COMMIT_SHA;
  delete process.env.VERCEL_GIT_COMMIT_TIMESTAMP;
};

const createRequest = () => new NextRequest('http://localhost/api/healthz');

describe('GET /api/healthz', () => {
  beforeEach(() => {
    vi.resetModules();
    setRequiredEnv();
    clearBuildEnv();
    mongodbMock.healthCheck.mockReset();
  });

  test('returns 200 with health details when dependencies are healthy', async () => {
    mongodbMock.healthCheck.mockResolvedValue({
      ok: true,
      latencyMs: 12,
    });
    process.env.BUILD_SHA = 'abc123';
    process.env.BUILD_TIMESTAMP = '2024-01-01T00:00:00.000Z';

    const { GET } = await import('@/app/api/healthz/route');

    const response = await GET(createRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(typeof body.uptime).toBe('number');
    expect(body.uptime).toBeGreaterThanOrEqual(0);
    expect(body.db).toEqual({ ok: true, pingMs: 12 });
    expect(body.env).toEqual({ ok: true });
    expect(body.build).toEqual({
      sha: 'abc123',
      ts: '2024-01-01T00:00:00.000Z',
    });
    expect(response.headers.get('x-correlation-id')).toBeTruthy();
  });

  test('returns 503 when environment validation fails', async () => {
    mongodbMock.healthCheck.mockResolvedValue({
      ok: true,
      latencyMs: 8,
    });
    delete process.env.MONGODB_URI;

    const { GET } = await import('@/app/api/healthz/route');

    const response = await GET(createRequest());
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.ok).toBe(false);
    expect(body.env.ok).toBe(false);
    expect(body.env.missing).toContain('MONGODB_URI');
    expect(body.db).toEqual({ ok: true, pingMs: 8 });
  });

  test('returns 503 when database ping fails', async () => {
    mongodbMock.healthCheck.mockResolvedValue({
      ok: false,
      error: 'ping failed',
    });

    const { GET } = await import('@/app/api/healthz/route');

    const response = await GET(createRequest());
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.ok).toBe(false);
    expect(body.env).toEqual({ ok: true });
    expect(body.db).toEqual({ ok: false, error: 'ping failed' });
  });
});
