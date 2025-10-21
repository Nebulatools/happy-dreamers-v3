import { MongoDBAdapter } from '@auth/mongodb-adapter';
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

type NextAuthFn = (typeof import('next-auth/next'))['default'];
type NextAuthOptions = Parameters<NextAuthFn>[2];
type Callbacks = NonNullable<NextAuthOptions['callbacks']>;
type JwtCallbackParams = Parameters<NonNullable<Callbacks['jwt']>>[0];
type SessionCallbackParams = Parameters<NonNullable<Callbacks['session']>>[0];

export const authConfig: NextAuthOptions = {
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
    async jwt({ token, user }: JwtCallbackParams) {
      if (user) {
        token.role = resolveRole((user as { role?: unknown })?.role);
      } else if (!isUserRole(token.role)) {
        token.role = 'user';
      }

      return token;
    },
    async session({ session, token }: SessionCallbackParams) {
      if (session.user) {
        const user = session.user as typeof session.user & {
          id?: string;
          role?: UserRole;
        };
        session.user = {
          ...user,
          id: (token.sub as string | undefined) ?? user.id ?? '',
          role: resolveRole(token.role),
        } as typeof session.user;
      }

      return session;
    },
  },
};
