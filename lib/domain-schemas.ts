import { ObjectId } from 'mongodb';
import { z } from 'zod';

const coerceDate = z.coerce.date();

export const objectIdSchema = z.preprocess(
  (value) => {
    if (value instanceof ObjectId) {
      return value;
    }

    if (typeof value === 'string' && ObjectId.isValid(value)) {
      return new ObjectId(value);
    }

    return value;
  },
  z.instanceof(ObjectId, { message: 'Invalid ObjectId' }),
);

export const UserRoleSchema = z.enum(['parent', 'coach', 'admin'] as const);
export type UserRole = z.infer<typeof UserRoleSchema>;
export const USER_ROLE_VALUES = UserRoleSchema.options;

export const UserSchema = z
  .object({
    _id: objectIdSchema,
    email: z.string().email(),
    role: UserRoleSchema,
    createdAt: coerceDate,
    updatedAt: coerceDate.optional(),
    profile: z
      .object({
        firstName: z.string().trim().min(1).optional(),
        lastName: z.string().trim().min(1).optional(),
        timezone: z.string().trim().min(1).optional(),
      })
      .optional(),
  })
  .strict();

export type User = z.infer<typeof UserSchema>;

export const PlanStatusSchema = z.enum(['draft', 'active', 'completed', 'archived'] as const);
export type PlanStatus = z.infer<typeof PlanStatusSchema>;
export const PLAN_STATUS_VALUES = PlanStatusSchema.options;

export const PlanTargetSchema = z
  .object({
    key: z.string().trim().min(1),
    description: z.string().trim().min(1).optional(),
    metric: z.string().trim().optional(),
    targetValue: z.number().nonnegative().optional(),
    unit: z.string().trim().optional(),
  })
  .strict();

export type PlanTarget = z.infer<typeof PlanTargetSchema>;

export const PlanSchema = z
  .object({
    _id: objectIdSchema,
    childId: objectIdSchema,
    status: PlanStatusSchema,
    targets: z.array(PlanTargetSchema).min(1),
    from: coerceDate,
    to: coerceDate.optional(),
    notes: z.string().trim().optional(),
    createdAt: coerceDate,
    updatedAt: coerceDate.optional(),
  })
  .strict();

export type Plan = z.infer<typeof PlanSchema>;

export const ChildSchema = z
  .object({
    _id: objectIdSchema,
    parentId: objectIdSchema,
    firstName: z.string().trim().min(1),
    lastName: z.string().trim().optional(),
    birthDate: coerceDate,
    timezone: z.string().trim().default('UTC'),
    activePlanId: objectIdSchema.optional(),
    tags: z.array(z.string().trim().min(1)).default([]),
    createdAt: coerceDate,
    updatedAt: coerceDate.optional(),
    meta: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export type Child = z.infer<typeof ChildSchema>;

export const EventTypeSchema = z.enum(
  [
    'sleep_start',
    'sleep_end',
    'night_wake',
    'feeding_bottle',
    'feeding_breast',
    'feeding_solids',
    'medication',
    'extra',
  ] as const,
);
export type EventType = z.infer<typeof EventTypeSchema>;
export const EVENT_TYPE_VALUES = EventTypeSchema.options;

const EventMetaSchema = z
  .object({
    notes: z.string().trim().optional(),
    caregiverId: objectIdSchema.optional(),
    durationMinutes: z.number().nonnegative().optional(),
    feeding: z
      .object({
        volumeMl: z.number().nonnegative().optional(),
        formula: z.string().trim().optional(),
        side: z.enum(['left', 'right']).optional(),
      })
      .optional(),
    nightFeeding: z.boolean().optional(),
  })
  .strict()
  .optional();

export const baseEventSchema = z
  .object({
    _id: objectIdSchema.optional(),
    childId: objectIdSchema,
    type: EventTypeSchema,
    startTime: coerceDate,
    endTime: coerceDate.optional(),
    parentEventId: objectIdSchema.optional(),
    source: z.enum(['manual', 'imported', 'sensor']).default('manual'),
    meta: EventMetaSchema,
    createdAt: coerceDate.default(() => new Date()),
    updatedAt: coerceDate.optional(),
  })
  .strict();

export type Event = z.infer<typeof baseEventSchema>;

export type NightBlockContext = {
  eventId: ObjectId;
  startTime: Date;
  endTime?: Date;
};

export type EventValidationContext = {
  activeNightBlock?: NightBlockContext;
};

const ensureNightWakeWithinBlock = (
  event: Event,
  ctx: z.RefinementCtx,
  context: EventValidationContext,
) => {
  if (event.type !== 'night_wake') {
    return;
  }

  if (!context.activeNightBlock) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'night_wake requiere un bloque nocturno activo',
      path: ['type'],
    });
    return;
  }

  if (!event.parentEventId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'night_wake requiere parentEventId vinculado al bloque nocturno',
      path: ['parentEventId'],
    });
    return;
  }

  if (!event.parentEventId.equals(context.activeNightBlock.eventId)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'night_wake debe vincularse al bloque nocturno activo',
      path: ['parentEventId'],
    });
  }

  if (
    event.startTime < context.activeNightBlock.startTime ||
    (context.activeNightBlock.endTime && event.startTime > context.activeNightBlock.endTime)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'night_wake debe ocurrir dentro de la ventana del bloque nocturno activo',
      path: ['startTime'],
    });
  }
};

const ensureTemporalConsistency = (event: Event, ctx: z.RefinementCtx) => {
  if (event.endTime && event.endTime <= event.startTime) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'endTime debe ser mayor que startTime',
      path: ['endTime'],
    });
  }
};

const ensureNightFeedingConsistency = (event: Event, ctx: z.RefinementCtx) => {
  if (event.type === 'feeding_solids' && event.meta?.nightFeeding) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'feeding_solids nunca puede marcarse como night_feeding',
      path: ['meta', 'nightFeeding'],
    });
  }
};

export const createEventSchema = (context: EventValidationContext = {}) =>
  baseEventSchema.superRefine((event, refineCtx) => {
    ensureTemporalConsistency(event, refineCtx);
    ensureNightFeedingConsistency(event, refineCtx);
    ensureNightWakeWithinBlock(event, refineCtx, context);
  });

export const TranscriptSourceSchema = z.enum(['zoom', 'manual', 'upload'] as const);
export type TranscriptSource = z.infer<typeof TranscriptSourceSchema>;
export const TRANSCRIPT_SOURCE_VALUES = TranscriptSourceSchema.options;

export const TranscriptSchema = z
  .object({
    _id: objectIdSchema,
    childId: objectIdSchema,
    source: TranscriptSourceSchema,
    text: z.string().trim().min(1),
    meta: z
      .object({
        language: z.string().trim().optional(),
        durationSeconds: z.number().nonnegative().optional(),
        confidence: z.number().min(0).max(1).optional(),
      })
      .strict()
      .optional(),
    createdAt: coerceDate,
    updatedAt: coerceDate.optional(),
  })
  .strict();

export type Transcript = z.infer<typeof TranscriptSchema>;
