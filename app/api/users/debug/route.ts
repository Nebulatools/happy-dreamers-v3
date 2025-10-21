import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import type { WithId, Document } from 'mongodb';
import { env } from '@/lib/env';
import { getDb } from '@/lib/mongodb';
import { requireRole } from '@/lib/auth/require-role';
import { USER_ROLES, type UserRole } from '@/lib/auth/roles';

type UserDocument = WithId<
  Document & {
    email?: string | null;
    role?: string | null;
    createdAt?: Date | string;
  }
>;

const isUserRole = (value: unknown): value is UserRole =>
  typeof value === 'string' && (USER_ROLES as readonly string[]).includes(value);

const redactEmail = (email: string | null | undefined) => {
  if (!email) {
    return null;
  }

  return createHash('sha256').update(email.toLowerCase()).digest('hex').slice(0, 12);
};

const obfuscateId = (id: unknown) =>
  createHash('sha256').update(String(id)).digest('hex').slice(0, 12);

const handler = requireRole('admin')(async (request, context) => {
  const { log, correlationId } = context;
  log.info('debug users endpoint invoked');

  if (!env.ENABLE_DEBUG_ENDPOINTS) {
    log.warn('debug endpoints are disabled');
    const response = NextResponse.json(
      { error: 'Not Found' },
      {
        status: 404,
      },
    );
    response.headers.set('x-correlation-id', correlationId);
    return response;
  }

  const db = await getDb();

  const users = await db
    .collection<UserDocument>('users')
    .find({}, { projection: { email: 1, role: 1, createdAt: 1 } })
    .limit(50)
    .toArray();

  log.debug({ count: users.length }, 'fetched users from debug endpoint');

  const sanitizedUsers = users.map((user) => ({
    id: obfuscateId(user._id),
    role: isUserRole(user.role) ? (user.role as UserRole) : 'user',
    emailHash: redactEmail(user.email ?? null),
    createdAt: user.createdAt ?? null,
  }));

  log.info({ count: sanitizedUsers.length }, 'returning sanitized debug users');

  const response = NextResponse.json({
    users: sanitizedUsers,
    count: sanitizedUsers.length,
  });
  response.headers.set('x-correlation-id', correlationId);
  return response;
});

export const GET = handler;
