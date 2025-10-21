import { NextResponse, type NextRequest } from 'next/server';
import { ObjectId } from 'mongodb';
import { requireRole } from '@/lib/auth/require-role';
import { getDb } from '@/lib/mongodb';
import {
  createEventSchema,
  EVENT_TYPE_VALUES,
  type EventType,
} from '@/lib/domain-schemas';
import {
  parseChildId,
  ensureChildExists,
  respondWith,
  serializeEvent,
  formatValidationErrors,
  isPlainRecord,
  normalizeNullable,
  resolveValidationContext,
  coerceToDate,
  type HandlerLogger,
  type EventDocument,
} from '../route';

const parseEventId = async (
  params: Promise<Record<string, unknown>> | Record<string, unknown> | undefined,
  log: HandlerLogger,
  correlationId: string,
): Promise<{ ok: true; eventId: ObjectId } | { ok: false; response: NextResponse }> => {
  const resolvedParams = ((await params) ?? {}) as Record<string, unknown>;
  const rawEventId = resolvedParams.eventId;
  const eventIdParam = Array.isArray(rawEventId) ? rawEventId[0] : rawEventId;

  if (typeof eventIdParam !== 'string' || !ObjectId.isValid(eventIdParam)) {
    log.warn({ eventId: eventIdParam }, 'invalid event id provided');
    return {
      ok: false,
      response: respondWith(
        400,
        {
          error: 'Invalid eventId',
        },
        correlationId,
      ),
    };
  }

  return {
    ok: true,
    eventId: new ObjectId(eventIdParam),
  };
};

type EventPatchDescriptor = {
  hasType: boolean;
  type?: EventType;
  hasStartTime: boolean;
  startTime?: string;
  hasEndTime: boolean;
  endTime?: string;
  hasParentEventId: boolean;
  parentEventId?: ObjectId;
  hasSource: boolean;
  source?: string;
  hasMeta: boolean;
  meta?: Record<string, unknown>;
};

const ALLOWED_PATCH_FIELDS = new Set([
  'type',
  'startTime',
  'endTime',
  'parentEventId',
  'source',
  'meta',
]);

const parsePatchPayload = (
  payload: unknown,
): { ok: true; patch: EventPatchDescriptor } | { ok: false; status: number; body: unknown } => {
  if (!isPlainRecord(payload)) {
    return { ok: false, status: 400, body: { error: 'Payload must be an object' } };
  }

  const keys = Object.keys(payload);
  if (keys.length === 0) {
    return { ok: false, status: 400, body: { error: 'Payload must not be empty' } };
  }

  const unknownKeys = keys.filter((key) => !ALLOWED_PATCH_FIELDS.has(key));
  if (unknownKeys.length > 0) {
    return {
      ok: false,
      status: 400,
      body: { error: 'Unsupported fields in payload', fields: unknownKeys },
    };
  }

  const patch: EventPatchDescriptor = {
    hasType: Object.prototype.hasOwnProperty.call(payload, 'type'),
    hasStartTime: Object.prototype.hasOwnProperty.call(payload, 'startTime'),
    hasEndTime: Object.prototype.hasOwnProperty.call(payload, 'endTime'),
    hasParentEventId: Object.prototype.hasOwnProperty.call(payload, 'parentEventId'),
    hasSource: Object.prototype.hasOwnProperty.call(payload, 'source'),
    hasMeta: Object.prototype.hasOwnProperty.call(payload, 'meta'),
  };

  if (patch.hasType) {
    const rawType = payload.type;
    if (typeof rawType !== 'string' || !(EVENT_TYPE_VALUES as readonly string[]).includes(rawType)) {
      return { ok: false, status: 400, body: { error: 'Invalid event type' } };
    }
    patch.type = rawType as EventType;
  }

  if (patch.hasStartTime) {
    const rawStart = payload.startTime;
    if (typeof rawStart !== 'string') {
      return { ok: false, status: 400, body: { error: 'startTime must be an ISO string' } };
    }
    const parsed = new Date(rawStart);
    if (Number.isNaN(parsed.getTime())) {
      return { ok: false, status: 400, body: { error: 'startTime must be a valid ISO date' } };
    }
    patch.startTime = rawStart;
  }

  if (patch.hasEndTime) {
    const rawEnd = payload.endTime;
    if (rawEnd === null) {
      patch.endTime = undefined;
    } else if (typeof rawEnd === 'string') {
      const parsed = new Date(rawEnd);
      if (Number.isNaN(parsed.getTime())) {
        return { ok: false, status: 400, body: { error: 'endTime must be a valid ISO date' } };
      }
      patch.endTime = rawEnd;
    } else {
      return { ok: false, status: 400, body: { error: 'endTime must be null or an ISO string' } };
    }
  }

  if (patch.hasParentEventId) {
    const rawParent = normalizeNullable(payload.parentEventId);
    if (rawParent === undefined) {
      patch.parentEventId = undefined;
    } else if (typeof rawParent === 'string' && ObjectId.isValid(rawParent)) {
      patch.parentEventId = new ObjectId(rawParent);
    } else {
      return {
        ok: false,
        status: 400,
        body: { error: 'parentEventId must be a valid ObjectId or null' },
      };
    }
  }

  if (patch.hasSource) {
    const rawSource = payload.source;
    if (typeof rawSource !== 'string' || !rawSource.trim()) {
      return { ok: false, status: 400, body: { error: 'source must be a non-empty string' } };
    }
    patch.source = rawSource;
  }

  if (patch.hasMeta) {
    const rawMeta = normalizeNullable(payload.meta);
    if (rawMeta === undefined) {
      patch.meta = undefined;
    } else if (isPlainRecord(rawMeta)) {
      patch.meta = { ...rawMeta };
    } else {
      return { ok: false, status: 400, body: { error: 'meta must be an object or null' } };
    }
  }

  return { ok: true, patch };
};

const patchHandler = requireRole('pro')(async (request: NextRequest, context) => {
  const { log, correlationId, params } = context;

  const parsedChildId = await parseChildId(params, log, correlationId);
  if (!parsedChildId.ok) {
    return parsedChildId.response;
  }
  const { childId } = parsedChildId;

  const parsedEventId = await parseEventId(params, log, correlationId);
  if (!parsedEventId.ok) {
    return parsedEventId.response;
  }
  const { eventId } = parsedEventId;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch (error) {
    log.warn({ error }, 'invalid json payload for patch');
    return respondWith(400, { error: 'Invalid JSON payload' }, correlationId);
  }

  const parsedPatch = parsePatchPayload(payload);
  if (!parsedPatch.ok) {
    return respondWith(parsedPatch.status, parsedPatch.body, correlationId);
  }

  try {
    const db = await getDb();

    const childCheck = await ensureChildExists(db, childId, log, correlationId);
    if (!childCheck.ok) {
      return childCheck.response;
    }

    const eventsCollection = db.collection<EventDocument>('events');

    const existingEvent = await eventsCollection.findOne({ _id: eventId, childId });
    if (!existingEvent) {
      log.warn({ childId: childId.toHexString(), eventId: eventId.toHexString() }, 'event not found');
      return respondWith(404, { error: 'Event not found' }, correlationId);
    }

    const { patch } = parsedPatch;

    const existingMeta =
      existingEvent.meta && isPlainRecord(existingEvent.meta)
        ? { ...existingEvent.meta }
        : undefined;

    const candidate = {
      childId,
      type: patch.hasType ? patch.type : existingEvent.type,
      startTime: patch.hasStartTime ? patch.startTime : existingEvent.startTime,
      endTime: patch.hasEndTime ? patch.endTime : existingEvent.endTime ?? undefined,
      parentEventId: patch.hasParentEventId
        ? patch.parentEventId
        : existingEvent.parentEventId ?? undefined,
      source: patch.hasSource ? patch.source : existingEvent.source ?? undefined,
      meta: patch.hasMeta ? patch.meta : existingMeta,
      createdAt: coerceToDate(existingEvent.createdAt) ?? new Date(),
      updatedAt: new Date(),
    };

    const contextResult = await resolveValidationContext(
      eventsCollection,
      childId,
      candidate.parentEventId instanceof ObjectId ? candidate.parentEventId : undefined,
    );

    if (!contextResult.ok) {
      return respondWith(contextResult.status, contextResult.body, correlationId);
    }

    const parseResult = createEventSchema(contextResult.context).safeParse(candidate);

    if (!parseResult.success) {
      return respondWith(
        400,
        { error: 'Invalid event payload', details: formatValidationErrors(parseResult.error) },
        correlationId,
      );
    }

    const validated = parseResult.data;

    const setDoc: Record<string, unknown> = {
      updatedAt: validated.updatedAt ?? new Date(),
    };
    const unsetDoc: Record<string, ''> = {};

    if (patch.hasType) {
      setDoc.type = validated.type;
    }
    if (patch.hasStartTime) {
      setDoc.startTime = validated.startTime;
    }
    if (patch.hasSource) {
      setDoc.source = validated.source;
    }
    if (patch.hasEndTime) {
      if (validated.endTime) {
        setDoc.endTime = validated.endTime;
      } else {
        unsetDoc.endTime = '';
      }
    }
    if (patch.hasParentEventId) {
      if (validated.parentEventId) {
        setDoc.parentEventId = validated.parentEventId;
      } else {
        unsetDoc.parentEventId = '';
      }
    }
    if (patch.hasMeta) {
      if (validated.meta) {
        setDoc.meta = validated.meta;
      } else {
        unsetDoc.meta = '';
      }
    }

    const updateOperation: Record<string, unknown> = {
      $set: setDoc,
    };
    if (Object.keys(unsetDoc).length > 0) {
      updateOperation.$unset = unsetDoc;
    }

    const updateResult = await eventsCollection.updateOne(
      { _id: eventId, childId },
      updateOperation,
    );

    if (updateResult.matchedCount === 0) {
      log.warn(
        { childId: childId.toHexString(), eventId: eventId.toHexString() },
        'event not found during update',
      );
      return respondWith(404, { error: 'Event not found' }, correlationId);
    }

    const updatedEvent = await eventsCollection.findOne({ _id: eventId, childId });
    if (!updatedEvent) {
      log.error({ childId: childId.toHexString(), eventId: eventId.toHexString() }, 'updated event not found');
      return respondWith(500, { error: 'Failed to load updated event' }, correlationId);
    }

    log.info(
      {
        childId: childId.toHexString(),
        eventId: eventId.toHexString(),
      },
      'child event updated',
    );

    return respondWith(200, { event: serializeEvent(updatedEvent) }, correlationId);
  } catch (error) {
    log.error({ error }, 'failed to patch child event');
    return respondWith(500, { error: 'Internal Server Error' }, correlationId);
  }
});

export const PATCH = patchHandler;
