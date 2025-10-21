import { NextResponse, type NextRequest } from 'next/server';
import { ObjectId, type WithId, type Document, type Collection } from 'mongodb';
import { ZodError } from 'zod';
import { requireRole } from '@/lib/auth/require-role';
import { getDb } from '@/lib/mongodb';
import {
  EVENT_TYPE_VALUES,
  createEventSchema,
  type Event,
  type EventType,
  type EventValidationContext,
} from '@/lib/domain-schemas';

export type EventDocument = WithId<
  Document & {
    childId: ObjectId;
    type: EventType;
    startTime: Date | string;
    endTime?: Date | string | null;
    parentEventId?: ObjectId | null;
    source?: string | null;
    meta?: Record<string, unknown>;
    createdAt?: Date | string;
    updatedAt?: Date | string;
  }
>;

export type SerializedEvent = {
  id: string;
  childId: string;
  type: EventType;
  startTime: string | null;
  endTime: string | null;
  parentEventId: string | null;
  source: string | null;
  meta: Record<string, unknown> | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type HandlerLogger = {
  warn: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
};

export const MAX_EVENTS = 500;

const toIsoString = (value: unknown): string | null => {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
    return value;
  }
  return null;
};

export const sanitizeMeta = (
  meta: Record<string, unknown> | undefined,
): Record<string, unknown> | null => {
  if (!meta) {
    return null;
  }

  const sanitized: Record<string, unknown> = { ...meta };
  const caregiverId = sanitized.caregiverId;
  if (caregiverId instanceof ObjectId) {
    sanitized.caregiverId = caregiverId.toHexString();
  }

  return sanitized;
};

export const serializeEvent = (event: EventDocument): SerializedEvent => ({
  id: event._id.toHexString(),
  childId: event.childId.toHexString(),
  type: event.type,
  startTime: toIsoString(event.startTime),
  endTime: toIsoString(event.endTime ?? null),
  parentEventId: event.parentEventId ? event.parentEventId.toHexString() : null,
  source: event.source ?? 'manual',
  meta: sanitizeMeta(event.meta),
  createdAt: toIsoString(event.createdAt ?? null),
  updatedAt: toIsoString(event.updatedAt ?? null),
});

export const respondWith = (status: number, body: unknown, correlationId: string) => {
  const response = NextResponse.json(body, { status });
  response.headers.set('x-correlation-id', correlationId);
  return response;
};

const parseDateParam = (rawValue: string | null, label: string) => {
  if (!rawValue) {
    return { ok: true as const, value: undefined };
  }

  const trimmed = rawValue.trim();

  if (!trimmed) {
    return {
      ok: false as const,
      message: `${label} must not be empty`,
    };
  }

  const parsed = new Date(trimmed);

  if (Number.isNaN(parsed.getTime())) {
    return {
      ok: false as const,
      message: `${label} must be a valid ISO date`,
    };
  }

  return { ok: true as const, value: parsed };
};

export const parseChildId = async (
  params: Promise<Record<string, unknown>> | Record<string, unknown> | undefined,
  log: HandlerLogger,
  correlationId: string,
): Promise<{ ok: true; childId: ObjectId } | { ok: false; response: NextResponse }> => {
  const resolvedParams = ((await params) ?? {}) as Record<string, unknown>;
  const rawChildId = resolvedParams.id;
  const childIdParam = Array.isArray(rawChildId) ? rawChildId[0] : rawChildId;

  if (typeof childIdParam !== 'string' || !ObjectId.isValid(childIdParam)) {
    log.warn({ childId: childIdParam }, 'invalid child id provided');
    return {
      ok: false,
      response: respondWith(
        400,
        {
          error: 'Invalid childId',
        },
        correlationId,
      ),
    };
  }

  return {
    ok: true,
    childId: new ObjectId(childIdParam),
  };
};

export const ensureChildExists = async (
  db: Awaited<ReturnType<typeof getDb>>,
  childId: ObjectId,
  log: HandlerLogger,
  correlationId: string,
): Promise<{ ok: true } | { ok: false; response: NextResponse }> => {
  const child = await db.collection('children').findOne(
    { _id: childId },
    {
      projection: { _id: 1 },
    },
  );

  if (!child) {
    log.warn({ childId: childId.toHexString() }, 'child not found');
    return {
      ok: false,
      response: respondWith(
        404,
        {
          error: 'Child not found',
        },
        correlationId,
      ),
    };
  }

  return { ok: true };
};

const getHandler = requireRole('pro')(async (request: NextRequest, context) => {
  const { log, correlationId, params } = context;

  const parsedChildId = await parseChildId(params, log, correlationId);
  if (!parsedChildId.ok) {
    return parsedChildId.response;
  }
  const { childId } = parsedChildId;

  const searchParams = request.nextUrl.searchParams;
  const fromResult = parseDateParam(searchParams.get('from'), 'from');
  if (!fromResult.ok) {
    return respondWith(400, { error: fromResult.message }, correlationId);
  }
  const toResult = parseDateParam(searchParams.get('to'), 'to');
  if (!toResult.ok) {
    return respondWith(400, { error: toResult.message }, correlationId);
  }

  const { value: from } = fromResult;
  const { value: to } = toResult;

  if (from && to && from > to) {
    return respondWith(400, { error: 'from must be earlier than to' }, correlationId);
  }

  const typeParam = searchParams.get('type');
  let eventType: EventType | undefined;
  if (typeParam) {
    if ((EVENT_TYPE_VALUES as readonly string[]).includes(typeParam)) {
      eventType = typeParam as EventType;
    } else {
      return respondWith(400, { error: 'Invalid event type' }, correlationId);
    }
  }

  try {
    const db = await getDb();

    const childCheck = await ensureChildExists(db, childId, log, correlationId);
    if (!childCheck.ok) {
      return childCheck.response;
    }

    const filter: Record<string, unknown> = {
      childId,
    };

    if (eventType) {
      filter.type = eventType;
    }

    if (from || to) {
      const range: Record<string, Date> = {};
      if (from) {
        range.$gte = from;
      }
      if (to) {
        range.$lte = to;
      }
      filter.startTime = range;
    }

    const eventsCollection = db.collection<EventDocument>('events');

    const events = await eventsCollection
      .find(filter)
      .sort({ startTime: 1, _id: 1 })
      .limit(MAX_EVENTS)
      .toArray();

    const serializedEvents = events.map(serializeEvent);

    log.info(
      {
        childId: childId.toHexString(),
        count: serializedEvents.length,
        filters: {
          from: from ? from.toISOString() : undefined,
          to: to ? to.toISOString() : undefined,
          type: eventType ?? undefined,
        },
      },
      'child events retrieved',
    );

    return respondWith(
      200,
      {
        events: serializedEvents,
        count: serializedEvents.length,
        limit: MAX_EVENTS,
      },
      correlationId,
    );
  } catch (error) {
    log.error({ error }, 'failed to fetch child events');
    return respondWith(
      500,
      {
        error: 'Internal Server Error',
      },
      correlationId,
    );
  }
});

export const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const normalizeNullable = <T>(value: T | null | undefined): T | undefined =>
  value === null || value === undefined ? undefined : value;

export const formatValidationErrors = (error: ZodError) =>
  error.issues.map((issue) => issue.message);

type EventCandidate = {
  childId: ObjectId;
  type?: unknown;
  startTime?: unknown;
  endTime?: unknown;
  parentEventId?: ObjectId;
  source?: unknown;
  meta?: Record<string, unknown>;
};

const parseEventPayload = (
  payload: unknown,
  childId: ObjectId,
): { ok: true; value: EventCandidate } | { ok: false; status: number; body: unknown } => {
  if (!isPlainRecord(payload)) {
    return { ok: false, status: 400, body: { error: 'Payload must be an object' } };
  }

  const parentEventIdRaw = normalizeNullable(payload.parentEventId);
  let parentEventId: ObjectId | undefined;
  if (parentEventIdRaw !== undefined) {
    if (typeof parentEventIdRaw !== 'string' || !ObjectId.isValid(parentEventIdRaw)) {
      return { ok: false, status: 400, body: { error: 'parentEventId must be a valid ObjectId' } };
    }
    parentEventId = new ObjectId(parentEventIdRaw);
  }

  const metaRaw = normalizeNullable(payload.meta);
  let meta: Record<string, unknown> | undefined;
  if (metaRaw !== undefined) {
    if (!isPlainRecord(metaRaw)) {
      return { ok: false, status: 400, body: { error: 'meta must be an object' } };
    }
    meta = { ...metaRaw };
  }

  return {
    ok: true,
    value: {
      childId,
      type: payload.type,
      startTime: payload.startTime,
      endTime: normalizeNullable(payload.endTime),
      parentEventId,
      source: normalizeNullable(payload.source),
      meta,
    },
  };
};

export const coerceToDate = (value: unknown): Date | undefined => {
  if (!value) {
    return undefined;
  }
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }
  return undefined;
};

export const resolveValidationContext = async (
  eventsCollection: Collection<EventDocument>,
  childId: ObjectId,
  parentEventId: ObjectId | undefined,
): Promise<
  | { ok: true; context: EventValidationContext }
  | { ok: false; status: number; body: unknown }
> => {
  if (!parentEventId) {
    return { ok: true, context: {} };
  }

  const parentEvent = await eventsCollection.findOne(
    { _id: parentEventId, childId },
    { projection: { _id: 1, startTime: 1, endTime: 1 } },
  );

  if (!parentEvent) {
    return {
      ok: false,
      status: 400,
      body: { error: 'parentEventId not found for the provided child' },
    };
  }

  const startTime = coerceToDate(parentEvent.startTime);
  const endTime = coerceToDate(parentEvent.endTime ?? undefined);

  if (!startTime) {
    return {
      ok: false,
      status: 500,
      body: { error: 'Parent event is missing a valid startTime' },
    };
  }

  return {
    ok: true,
    context: {
      activeNightBlock: {
        eventId: parentEvent._id,
        startTime,
        endTime,
      },
    },
  };
};

const postHandler = requireRole('pro')(async (request: NextRequest, context) => {
  const { log, correlationId, params } = context;

  const parsedChildId = await parseChildId(params, log, correlationId);
  if (!parsedChildId.ok) {
    return parsedChildId.response;
  }
  const { childId } = parsedChildId;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch (error) {
    log.warn({ error }, 'invalid json payload');
    return respondWith(400, { error: 'Invalid JSON payload' }, correlationId);
  }

  const eventPayloadResult = parseEventPayload(payload, childId);
  if (!eventPayloadResult.ok) {
    return respondWith(eventPayloadResult.status, eventPayloadResult.body, correlationId);
  }

  try {
    const db = await getDb();

    const childCheck = await ensureChildExists(db, childId, log, correlationId);
    if (!childCheck.ok) {
      return childCheck.response;
    }

    const eventsCollection = db.collection<EventDocument>('events');
    const { value: eventCandidate } = eventPayloadResult;

    const contextResult = await resolveValidationContext(
      eventsCollection,
      childId,
      eventCandidate.parentEventId,
    );

    if (!contextResult.ok) {
      return respondWith(contextResult.status, contextResult.body, correlationId);
    }

    const parseResult = createEventSchema(contextResult.context).safeParse(eventCandidate);

    if (!parseResult.success) {
      return respondWith(
        400,
        {
          error: 'Invalid event payload',
          details: formatValidationErrors(parseResult.error),
        },
        correlationId,
      );
    }

    const eventToInsert = parseResult.data as Event;

    const insertResult = await eventsCollection.insertOne(eventToInsert);
    if (!insertResult.acknowledged) {
      log.error({ childId: childId.toHexString() }, 'failed to insert child event');
      return respondWith(500, { error: 'Failed to persist event' }, correlationId);
    }

    const insertedEvent = await eventsCollection.findOne({ _id: insertResult.insertedId });
    if (!insertedEvent) {
      log.error({ insertedId: insertResult.insertedId }, 'inserted event not found');
      return respondWith(500, { error: 'Failed to load inserted event' }, correlationId);
    }

    log.info(
      {
        childId: childId.toHexString(),
        eventId: insertResult.insertedId.toHexString(),
        type: insertedEvent.type,
      },
      'child event created',
    );

    return respondWith(
      201,
      {
        event: serializeEvent(insertedEvent as EventDocument),
      },
      correlationId,
    );
  } catch (error) {
    log.error({ error }, 'failed to create child event');
    return respondWith(500, { error: 'Internal Server Error' }, correlationId);
  }
});

export const GET = getHandler;
export const POST = postHandler;
