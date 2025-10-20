import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import type { Session } from 'next-auth';
import { auth } from '@/auth';
import { hasSufficientRole, type UserRole } from './roles';

type RouteContext = {
  params?: Record<string, string | string[]>;
  [key: string]: unknown;
};

type HandlerContext<TContext extends RouteContext> = TContext & {
  session: Session;
};

type RouteHandler<TContext extends RouteContext> = (
  request: NextRequest,
  context: HandlerContext<TContext>,
) => Promise<Response> | Response;

export const requireRole =
  <TContext extends RouteContext = RouteContext>(requiredRole: UserRole) =>
  (handler: RouteHandler<TContext>) =>
  async (request: NextRequest, context: TContext) => {
    const session = await auth();

    if (!session?.user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        {
          status: 401,
        },
      );
    }

    const { role } = session.user;

    if (!hasSufficientRole(role, requiredRole)) {
      return NextResponse.json(
        { error: 'Forbidden' },
        {
          status: 403,
        },
      );
    }

    const handlerContext = Object.assign({}, context, { session }) as HandlerContext<TContext>;

    return handler(request, handlerContext);
  };
