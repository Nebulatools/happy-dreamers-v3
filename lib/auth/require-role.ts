import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import type { Session } from 'next-auth';
import { auth } from '@/auth';
import { hasSufficientRole, type UserRole } from './roles';
import { createRequestLogger, getCorrelationId, type AppLogger } from '../logger';

type MaybePromise<T> = T | Promise<T>;

type RouteParams = Record<string, string | string[]>;

type RouteContext<TParams extends RouteParams = RouteParams> = {
  params?: MaybePromise<TParams>;
  [key: string]: unknown;
};

type HandlerContext<TContext extends RouteContext> = TContext & {
  session: Session;
  correlationId: string;
  log: AppLogger;
};

type RouteHandler<TContext extends RouteContext> = (
  request: NextRequest,
  context: HandlerContext<TContext>,
) => Promise<Response> | Response;

export const requireRole =
  <TContext extends RouteContext = RouteContext>(requiredRole: UserRole) =>
  (handler: RouteHandler<TContext>) =>
  async (request: NextRequest, context?: TContext) => {
    const correlationId = getCorrelationId(request.headers);
    request.headers.set('x-correlation-id', correlationId);

    const log = createRequestLogger(correlationId, {
      scope: 'requireRole',
      path: request.nextUrl.pathname,
      method: request.method,
      requiredRole,
    });

    const session = await auth();

    if (!session?.user) {
      log.warn('unauthenticated request blocked');
      const response = NextResponse.json(
        { error: 'Unauthorized' },
        {
          status: 401,
        },
      );
      response.headers.set('x-correlation-id', correlationId);
      return response;
    }

    const { role } = session.user;

    if (!hasSufficientRole(role, requiredRole)) {
      log.warn({ role }, 'insufficient role for protected resource');
      const response = NextResponse.json(
        { error: 'Forbidden' },
        {
          status: 403,
        },
      );
      response.headers.set('x-correlation-id', correlationId);
      return response;
    }

    log.debug({ role }, 'authorization successful');

    const handlerContext = Object.assign({}, context ?? {}, {
      session,
      correlationId,
      log,
    }) as HandlerContext<TContext>;

    return handler(request, handlerContext);
  };
