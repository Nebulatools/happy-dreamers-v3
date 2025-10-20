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

const handler = requireRole('admin')(async (_request, _context) => {
  if (!env.ENABLE_DEBUG_ENDPOINTS) {
    return NextResponse.json(
      { error: 'Not Found' },
      {
        status: 404,
      },
    );
  }

  const db = await getDb();

  const users = await db
    .collection<UserDocument>('users')
    .find({}, { projection: { email: 1, role: 1, createdAt: 1 } })
    .limit(50)
    .toArray();

  const sanitizedUsers = users.map((user) => ({
    id: String(user._id),
    role: isUserRole(user.role) ? (user.role as UserRole) : 'user',
    emailHash: redactEmail(user.email ?? null),
    createdAt: user.createdAt ?? null,
  }));

  return NextResponse.json({
    users: sanitizedUsers,
    count: sanitizedUsers.length,
  });
});

export const GET = handler;
