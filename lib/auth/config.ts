import { MongoDBAdapter } from '@auth/mongodb-adapter';
import type { NextAuthConfig } from 'next-auth';
import { env } from '../env';
import { getMongoClient } from '../mongodb';
import { USER_ROLES, type UserRole } from './roles';

const isProd = process.env.NODE_ENV === 'production';
const cookiePrefix = isProd ? '__Secure-' : '';

const isUserRole = (value: unknown): value is UserRole =>
  typeof value === 'string' && (USER_ROLES as readonly string[]).includes(value);

const resolveRole = (value: unknown): UserRole => (isUserRole(value) ? value : 'user');

const baseCookieOptions = {
  sameSite: 'lax' as const,
  path: '/',
  secure: isProd,
};

const clientPromise = getMongoClient();

export const authConfig: NextAuthConfig = {
  adapter: MongoDBAdapter(clientPromise),
  session: {
    strategy: 'jwt',
  },
  secret: env.NEXTAUTH_SECRET,
  providers: [],
  cookies: {
    sessionToken: {
      name: `${cookiePrefix}next-auth.session-token`,
      options: {
        ...baseCookieOptions,
        httpOnly: true,
      },
    },
    callbackUrl: {
      name: `${cookiePrefix}next-auth.callback-url`,
      options: baseCookieOptions,
    },
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.role = resolveRole((user as { role?: unknown })?.role);
      } else if (!isUserRole(token.role)) {
        token.role = 'user';
      }

      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = (token.sub as string | undefined) ?? session.user.id ?? '';
        session.user.role = resolveRole(token.role);
      }

      return session;
    },
  },
};
