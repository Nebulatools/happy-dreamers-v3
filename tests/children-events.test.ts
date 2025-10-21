import { ObjectId } from 'mongodb';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, test, vi } from 'vitest';

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
};

const buildSession = (role: 'user' | 'pro' | 'admin') => ({
  user: {
    id: 'user-id',
    email: 'user@example.com',
    name: 'Test User',
    role,
  },
  expires: new Date(Date.now() + 60_000).toISOString(),
});

const baseChildId = '507f1f77bcf86cd799439011';
const baseEventId = '65e0e6335dffb466f21a1d11';

const buildUrl = (childId: string, query = '') =>
  `http://localhost/api/children/${childId}/events${query}`;

const createGetRequest = (query = '', childId = baseChildId) =>
  new NextRequest(buildUrl(childId, query));

const createPostRequest = (body: unknown, childId = baseChildId, options?: { raw?: boolean }) =>
  new NextRequest(buildUrl(childId), {
    method: 'POST',
    body: options?.raw ? (body as string) : JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
    },
  });

const createContext = (childId = baseChildId) => ({
  params: Promise.resolve({ id: childId }),
});

const buildEventUrl = (childId: string, eventId: string) =>
  `http://localhost/api/children/${childId}/events/${eventId}`;

const createPatchRequest = (
  body: unknown,
  childId = baseChildId,
  eventId = baseEventId,
  options?: { raw?: boolean },
) =>
  new NextRequest(buildEventUrl(childId, eventId), {
    method: 'PATCH',
    body: options?.raw ? (body as string) : JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
    },
  });

const createPatchContext = (childId = baseChildId, eventId = baseEventId) => ({
  params: Promise.resolve({ id: childId, eventId }),
});

beforeEach(() => {
  vi.resetModules();
  setRequiredEnv();
  authMock.auth.mockReset();
  dbMock.getDb.mockReset();
});

describe('GET /api/children/:id/events', () => {
  test('returns sanitized events for pro role', async () => {
    authMock.auth.mockResolvedValue(buildSession('pro'));

    const childId = new ObjectId('65e0e6335dffb466f21a1c01');
    const parentEventId = new ObjectId('65e0e6335dffb466f21a1c02');
    const caregiverId = new ObjectId('65e0e6335dffb466f21a1c03');

    const childrenFindOne = vi.fn().mockResolvedValue({ _id: childId });
    const eventsToArray = vi.fn().mockResolvedValue([
      {
        _id: new ObjectId('65e0e6335dffb466f21a1c05'),
        childId,
        type: 'sleep_start',
        startTime: new Date('2024-01-01T20:00:00Z'),
        endTime: new Date('2024-01-02T06:00:00Z'),
        parentEventId,
        source: 'manual',
        meta: {
          caregiverId,
          notes: 'Bedtime',
        },
        createdAt: new Date('2024-01-01T19:50:00Z'),
        updatedAt: new Date('2024-01-01T19:55:00Z'),
      },
    ]);
    const eventsLimit = vi.fn().mockImplementation(() => ({
      toArray: eventsToArray,
    }));
    const eventsSort = vi.fn().mockImplementation(() => ({
      limit: eventsLimit,
    }));
    const eventsFind = vi.fn().mockImplementation(() => ({
      sort: eventsSort,
    }));

    const collection = vi.fn((name: string) => {
      if (name === 'children') {
        return {
          findOne: childrenFindOne,
        };
      }
      if (name === 'events') {
        return {
          find: eventsFind,
        };
      }
      throw new Error(`Unexpected collection ${name}`);
    });

    dbMock.getDb.mockResolvedValue({
      collection,
    });

    const { GET } = await import('@/app/api/children/[id]/events/route');

    const response = await GET(
      createGetRequest('?from=2024-01-01T00:00:00Z&to=2024-01-03T00:00:00Z&type=sleep_start', childId.toHexString()),
      createContext(childId.toHexString()),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('x-correlation-id')).toBeTruthy();
    expect(childrenFindOne).toHaveBeenCalledWith(
      { _id: childId },
      { projection: { _id: 1 } },
    );
    expect(eventsFind).toHaveBeenCalledWith({
      childId,
      type: 'sleep_start',
      startTime: {
        $gte: new Date('2024-01-01T00:00:00.000Z'),
        $lte: new Date('2024-01-03T00:00:00.000Z'),
      },
    });
    expect(body.count).toBe(1);
    expect(body.limit).toBeGreaterThan(0);
    expect(body.events[0]).toMatchObject({
      id: '65e0e6335dffb466f21a1c05',
      childId: childId.toHexString(),
      type: 'sleep_start',
      startTime: '2024-01-01T20:00:00.000Z',
      endTime: '2024-01-02T06:00:00.000Z',
      parentEventId: parentEventId.toHexString(),
      source: 'manual',
      meta: {
        caregiverId: caregiverId.toHexString(),
        notes: 'Bedtime',
      },
    });
  });

  test('rejects invalid event type', async () => {
    authMock.auth.mockResolvedValue(buildSession('pro'));

    const { GET } = await import('@/app/api/children/[id]/events/route');

    const response = await GET(createGetRequest('?type=unknown'), createContext());
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Invalid event type' });
    expect(dbMock.getDb).not.toHaveBeenCalled();
  });

  test('returns 404 when child does not exist', async () => {
    authMock.auth.mockResolvedValue(buildSession('pro'));

    const childrenFindOne = vi.fn().mockResolvedValue(null);
    const collection = vi.fn((name: string) => {
      if (name === 'children') {
        return {
          findOne: childrenFindOne,
        };
      }
      if (name === 'events') {
        return {
          find: vi.fn(),
        };
      }
      throw new Error(`Unexpected collection ${name}`);
    });

    dbMock.getDb.mockResolvedValue({
      collection,
    });

    const { GET } = await import('@/app/api/children/[id]/events/route');

    const response = await GET(createGetRequest(), createContext());

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Child not found' });
  });

  test('rejects invalid child id', async () => {
    authMock.auth.mockResolvedValue(buildSession('pro'));

    const { GET } = await import('@/app/api/children/[id]/events/route');

    const response = await GET(createGetRequest(), createContext('invalid-id'));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Invalid childId' });
  });

  test('returns 403 for insufficient role', async () => {
    authMock.auth.mockResolvedValue(buildSession('user'));

    const { GET } = await import('@/app/api/children/[id]/events/route');

    const response = await GET(createGetRequest(), createContext());

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'Forbidden' });
  });
});

describe('POST /api/children/:id/events', () => {
  test('creates event for pro role', async () => {
    authMock.auth.mockResolvedValue(buildSession('pro'));

    const childId = new ObjectId('65e0e6335dffb466f21a1c21');
    const insertedId = new ObjectId('65e0e6335dffb466f21a1c22');

    const childrenFindOne = vi.fn().mockResolvedValue({ _id: childId });
    const insertOne = vi.fn().mockResolvedValue({
      acknowledged: true,
      insertedId,
    });
    const eventsFindOne = vi.fn().mockImplementation((filter: Record<string, unknown>) => {
      if (filter._id instanceof ObjectId && filter._id.equals(insertedId)) {
        return Promise.resolve({
          _id: insertedId,
          childId,
          type: 'sleep_start',
          startTime: new Date('2024-01-01T20:00:00Z'),
          endTime: new Date('2024-01-02T06:00:00Z'),
          source: 'manual',
          meta: { notes: 'Bedtime' },
          createdAt: new Date('2024-01-01T19:50:00Z'),
          updatedAt: new Date('2024-01-01T19:55:00Z'),
        });
      }
      return Promise.resolve(null);
    });

    const collection = vi.fn((name: string) => {
      if (name === 'children') {
        return {
          findOne: childrenFindOne,
        };
      }
      if (name === 'events') {
        return {
          insertOne,
          findOne: eventsFindOne,
        };
      }
      throw new Error(`Unexpected collection ${name}`);
    });

    dbMock.getDb.mockResolvedValue({
      collection,
    });

    const { POST } = await import('@/app/api/children/[id]/events/route');

    const response = await POST(
      createPostRequest(
        {
          type: 'sleep_start',
          startTime: '2024-01-01T20:00:00Z',
          endTime: '2024-01-02T06:00:00Z',
          meta: { notes: 'Bedtime' },
        },
        childId.toHexString(),
      ),
      createContext(childId.toHexString()),
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(response.headers.get('x-correlation-id')).toBeTruthy();
    expect(insertOne).toHaveBeenCalledTimes(1);
    const insertedDoc = insertOne.mock.calls[0][0];
    expect(insertedDoc.childId).toEqual(childId);
    expect(insertedDoc.type).toBe('sleep_start');
    expect(insertedDoc.startTime).toBeInstanceOf(Date);
    expect((insertedDoc.startTime as Date).toISOString()).toBe('2024-01-01T20:00:00.000Z');
    expect(body.event).toMatchObject({
      id: insertedId.toHexString(),
      childId: childId.toHexString(),
      type: 'sleep_start',
      meta: { notes: 'Bedtime' },
    });
  });

  test('rejects invalid event payload', async () => {
    authMock.auth.mockResolvedValue(buildSession('pro'));

    const childId = new ObjectId('65e0e6335dffb466f21a1c31');

    const childrenFindOne = vi.fn().mockResolvedValue({ _id: childId });
    const insertOne = vi.fn();
    const eventsFindOne = vi.fn();

    const collection = vi.fn((name: string) => {
      if (name === 'children') {
        return { findOne: childrenFindOne };
      }
      if (name === 'events') {
        return {
          insertOne,
          findOne: eventsFindOne,
        };
      }
      throw new Error(`Unexpected collection ${name}`);
    });

    dbMock.getDb.mockResolvedValue({
      collection,
    });

    const { POST } = await import('@/app/api/children/[id]/events/route');

    const response = await POST(
      createPostRequest({}, childId.toHexString()),
      createContext(childId.toHexString()),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Invalid event payload');
    expect(insertOne).not.toHaveBeenCalled();
  });

  test('rejects parentEventId when parent event is missing', async () => {
    authMock.auth.mockResolvedValue(buildSession('pro'));

    const childId = new ObjectId('65e0e6335dffb466f21a1c41');
    const parentEventId = new ObjectId('65e0e6335dffb466f21a1c42');

    const childrenFindOne = vi.fn().mockResolvedValue({ _id: childId });
    const insertOne = vi.fn();
    const eventsFindOne = vi
      .fn()
      .mockResolvedValue(null);

    const collection = vi.fn((name: string) => {
      if (name === 'children') {
        return { findOne: childrenFindOne };
      }
      if (name === 'events') {
        return {
          insertOne,
          findOne: eventsFindOne,
        };
      }
      throw new Error(`Unexpected collection ${name}`);
    });

    dbMock.getDb.mockResolvedValue({
      collection,
    });

    const { POST } = await import('@/app/api/children/[id]/events/route');

    const response = await POST(
      createPostRequest(
        {
          type: 'night_wake',
          startTime: '2024-01-02T02:00:00Z',
          parentEventId: parentEventId.toHexString(),
        },
        childId.toHexString(),
      ),
      createContext(childId.toHexString()),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({
      error: 'parentEventId not found for the provided child',
    });
    expect(insertOne).not.toHaveBeenCalled();
  });

  test('returns 404 when child does not exist', async () => {
    authMock.auth.mockResolvedValue(buildSession('pro'));

    const childrenFindOne = vi.fn().mockResolvedValue(null);
    const collection = vi.fn((name: string) => {
      if (name === 'children') {
        return { findOne: childrenFindOne };
      }
      if (name === 'events') {
        return {
          insertOne: vi.fn(),
          findOne: vi.fn(),
        };
      }
      throw new Error(`Unexpected collection ${name}`);
    });

    dbMock.getDb.mockResolvedValue({
      collection,
    });

    const { POST } = await import('@/app/api/children/[id]/events/route');

    const response = await POST(
      createPostRequest({
        type: 'sleep_start',
        startTime: '2024-01-01T20:00:00Z',
      }),
      createContext(),
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Child not found' });
  });

  test('returns 403 for insufficient role', async () => {
    authMock.auth.mockResolvedValue(buildSession('user'));

    const { POST } = await import('@/app/api/children/[id]/events/route');

    const response = await POST(
      createPostRequest({
        type: 'sleep_start',
        startTime: '2024-01-01T20:00:00Z',
      }),
      createContext(),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'Forbidden' });
  });

  test('rejects invalid JSON payload', async () => {
    authMock.auth.mockResolvedValue(buildSession('pro'));

    const childId = baseChildId;

    const { POST } = await import('@/app/api/children/[id]/events/route');

    const response = await POST(createPostRequest('{', childId, { raw: true }), createContext());
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Invalid JSON payload' });
    expect(dbMock.getDb).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/children/:id/events/:eventId', () => {
  test('updates event endTime for pro role', async () => {
    authMock.auth.mockResolvedValue(buildSession('pro'));

    const childId = new ObjectId('65e0e6335dffb466f21a1d21');
    const eventId = new ObjectId('65e0e6335dffb466f21a1d22');

    const childrenFindOne = vi.fn().mockResolvedValue({ _id: childId });
    const existingEvent = {
      _id: eventId,
      childId,
      type: 'sleep_start' as const,
      startTime: new Date('2024-01-01T20:00:00Z'),
      endTime: null,
      source: 'manual',
      meta: { notes: 'Bedtime' },
      createdAt: new Date('2024-01-01T19:50:00Z'),
      updatedAt: new Date('2024-01-01T19:55:00Z'),
    };
    const updatedEvent = {
      ...existingEvent,
      endTime: new Date('2024-01-02T06:00:00Z'),
      updatedAt: new Date('2024-01-02T06:05:00Z'),
    };

    const eventsFindOne = vi
      .fn()
      .mockResolvedValueOnce(existingEvent)
      .mockResolvedValueOnce(updatedEvent);
    const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });

    const collection = vi.fn((name: string) => {
      if (name === 'children') {
        return { findOne: childrenFindOne };
      }
      if (name === 'events') {
        return {
          findOne: eventsFindOne,
          updateOne,
        };
      }
      throw new Error(`Unexpected collection ${name}`);
    });

    dbMock.getDb.mockResolvedValue({
      collection,
    });

    const { PATCH } = await import('@/app/api/children/[id]/events/[eventId]/route');

    const response = await PATCH(
      createPatchRequest(
        { endTime: '2024-01-02T06:00:00Z' },
        childId.toHexString(),
        eventId.toHexString(),
      ),
      createPatchContext(childId.toHexString(), eventId.toHexString()),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.event).toMatchObject({
      id: eventId.toHexString(),
      endTime: '2024-01-02T06:00:00.000Z',
    });
    expect(updateOne).toHaveBeenCalledWith(
      { _id: eventId, childId },
      expect.objectContaining({
        $set: expect.objectContaining({
          endTime: expect.any(Date),
          updatedAt: expect.any(Date),
        }),
      }),
    );
  });

  test('removes endTime when null provided', async () => {
    authMock.auth.mockResolvedValue(buildSession('pro'));

    const childId = new ObjectId('65e0e6335dffb466f21a1d31');
    const eventId = new ObjectId('65e0e6335dffb466f21a1d32');

    const childrenFindOne = vi.fn().mockResolvedValue({ _id: childId });
    const existingEvent = {
      _id: eventId,
      childId,
      type: 'sleep_start' as const,
      startTime: new Date('2024-01-01T20:00:00Z'),
      endTime: new Date('2024-01-02T06:00:00Z'),
      source: 'manual',
      meta: { notes: 'Bedtime' },
      createdAt: new Date('2024-01-01T19:50:00Z'),
      updatedAt: new Date('2024-01-01T19:55:00Z'),
    };
    const updatedEvent = {
      ...existingEvent,
      endTime: null,
      updatedAt: new Date('2024-01-02T07:00:00Z'),
    };

    const eventsFindOne = vi
      .fn()
      .mockResolvedValueOnce(existingEvent)
      .mockResolvedValueOnce(updatedEvent);
    const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });

    const collection = vi.fn((name: string) => {
      if (name === 'children') {
        return { findOne: childrenFindOne };
      }
      if (name === 'events') {
        return {
          findOne: eventsFindOne,
          updateOne,
        };
      }
      throw new Error(`Unexpected collection ${name}`);
    });

    dbMock.getDb.mockResolvedValue({
      collection,
    });

    const { PATCH } = await import('@/app/api/children/[id]/events/[eventId]/route');

    const response = await PATCH(
      createPatchRequest(
        { endTime: null },
        childId.toHexString(),
        eventId.toHexString(),
      ),
      createPatchContext(childId.toHexString(), eventId.toHexString()),
    );
    await response.json();

    expect(response.status).toBe(200);
    expect(updateOne).toHaveBeenCalledWith(
      { _id: eventId, childId },
      expect.objectContaining({
        $set: expect.objectContaining({
          updatedAt: expect.any(Date),
        }),
        $unset: expect.objectContaining({
          endTime: '',
        }),
      }),
    );
  });

  test('rejects unsupported fields', async () => {
    authMock.auth.mockResolvedValue(buildSession('pro'));

    const { PATCH } = await import('@/app/api/children/[id]/events/[eventId]/route');

    const response = await PATCH(
      createPatchRequest({ foo: 'bar' }),
      createPatchContext(),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'Unsupported fields in payload',
      fields: ['foo'],
    });
    expect(dbMock.getDb).not.toHaveBeenCalled();
  });

  test('validates event type changes', async () => {
    authMock.auth.mockResolvedValue(buildSession('pro'));

    const { PATCH } = await import('@/app/api/children/[id]/events/[eventId]/route');

    const response = await PATCH(
      createPatchRequest({ type: 'invalid-type' }),
      createPatchContext(),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Invalid event type' });
    expect(dbMock.getDb).not.toHaveBeenCalled();
  });

  test('requires parent event when specified', async () => {
    authMock.auth.mockResolvedValue(buildSession('pro'));

    const childId = new ObjectId('65e0e6335dffb466f21a1d41');
    const eventId = new ObjectId('65e0e6335dffb466f21a1d42');
    const parentEventId = new ObjectId('65e0e6335dffb466f21a1d43');

    const childrenFindOne = vi.fn().mockResolvedValue({ _id: childId });
    const existingEvent = {
      _id: eventId,
      childId,
      type: 'night_wake' as const,
      startTime: new Date('2024-01-02T02:00:00Z'),
      parentEventId: null,
      createdAt: new Date('2024-01-02T01:00:00Z'),
      updatedAt: new Date('2024-01-02T01:30:00Z'),
      source: 'manual',
    };

    const eventsFindOne = vi
      .fn()
      .mockResolvedValueOnce(existingEvent)
      .mockResolvedValueOnce(null);
    const updateOne = vi.fn();

    const collection = vi.fn((name: string) => {
      if (name === 'children') {
        return { findOne: childrenFindOne };
      }
      if (name === 'events') {
        return {
          findOne: eventsFindOne,
          updateOne,
        };
      }
      throw new Error(`Unexpected collection ${name}`);
    });

    dbMock.getDb.mockResolvedValue({
      collection,
    });

    const { PATCH } = await import('@/app/api/children/[id]/events/[eventId]/route');

    const response = await PATCH(
      createPatchRequest(
        { parentEventId: parentEventId.toHexString() },
        childId.toHexString(),
        eventId.toHexString(),
      ),
      createPatchContext(childId.toHexString(), eventId.toHexString()),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'parentEventId not found for the provided child',
    });
    expect(updateOne).not.toHaveBeenCalled();
  });

  test('returns 404 when event does not exist', async () => {
    authMock.auth.mockResolvedValue(buildSession('pro'));

    const childId = new ObjectId('65e0e6335dffb466f21a1d51');
    const eventId = new ObjectId('65e0e6335dffb466f21a1d52');

    const childrenFindOne = vi.fn().mockResolvedValue({ _id: childId });
    const eventsFindOne = vi.fn().mockResolvedValueOnce(null);
    const updateOne = vi.fn();

    const collection = vi.fn((name: string) => {
      if (name === 'children') {
        return { findOne: childrenFindOne };
      }
      if (name === 'events') {
        return {
          findOne: eventsFindOne,
          updateOne,
        };
      }
      throw new Error(`Unexpected collection ${name}`);
    });

    dbMock.getDb.mockResolvedValue({
      collection,
    });

    const { PATCH } = await import('@/app/api/children/[id]/events/[eventId]/route');

    const response = await PATCH(
      createPatchRequest({ endTime: null }, childId.toHexString(), eventId.toHexString()),
      createPatchContext(childId.toHexString(), eventId.toHexString()),
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Event not found' });
    expect(updateOne).not.toHaveBeenCalled();
  });

  test('returns 404 when child does not exist', async () => {
    authMock.auth.mockResolvedValue(buildSession('pro'));

    const childrenFindOne = vi.fn().mockResolvedValue(null);
    const collection = vi.fn((name: string) => {
      if (name === 'children') {
        return { findOne: childrenFindOne };
      }
      if (name === 'events') {
        return {
          findOne: vi.fn(),
          updateOne: vi.fn(),
        };
      }
      throw new Error(`Unexpected collection ${name}`);
    });

    dbMock.getDb.mockResolvedValue({
      collection,
    });

    const { PATCH } = await import('@/app/api/children/[id]/events/[eventId]/route');

    const response = await PATCH(createPatchRequest({ endTime: null }), createPatchContext());
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Child not found' });
  });

  test('rejects invalid child and event ids', async () => {
    authMock.auth.mockResolvedValue(buildSession('pro'));

    const { PATCH } = await import('@/app/api/children/[id]/events/[eventId]/route');

    const responseInvalidChild = await PATCH(
      createPatchRequest({ endTime: null }),
      {
        params: Promise.resolve({ id: 'invalid-child', eventId: baseEventId }),
      },
    );
    expect(responseInvalidChild.status).toBe(400);
    expect(await responseInvalidChild.json()).toEqual({ error: 'Invalid childId' });

    const responseInvalidEvent = await PATCH(
      createPatchRequest({ endTime: null }),
      {
        params: Promise.resolve({ id: baseChildId, eventId: 'invalid-event' }),
      },
    );
    expect(responseInvalidEvent.status).toBe(400);
    expect(await responseInvalidEvent.json()).toEqual({ error: 'Invalid eventId' });
  });

  test('returns 403 for insufficient role', async () => {
    authMock.auth.mockResolvedValue(buildSession('user'));

    const { PATCH } = await import('@/app/api/children/[id]/events/[eventId]/route');

    const response = await PATCH(createPatchRequest({ endTime: null }), createPatchContext());
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'Forbidden' });
  });

  test('rejects invalid JSON payload', async () => {
    authMock.auth.mockResolvedValue(buildSession('pro'));

    const { PATCH } = await import('@/app/api/children/[id]/events/[eventId]/route');

    const response = await PATCH(
      createPatchRequest('{', baseChildId, baseEventId, { raw: true }),
      createPatchContext(),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Invalid JSON payload' });
    expect(dbMock.getDb).not.toHaveBeenCalled();
  });
});
