import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { env } from './lib/env';
import { createRequestLogger, getCorrelationId } from './lib/logger';

const PRODUCTION_ORIGINS = ['https://happydreamers.mx'];
const PREVIEW_PATTERN = /^https:\/\/happy-dreamers-.*\.vercel\.app$/i;

const ALLOWED_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];

const buildContentSecurityPolicy = () => {
  const scriptSources = ["'self'"];
  const connectSources = ["'self'"];

  if (process.env.NODE_ENV !== 'production') {
    scriptSources.push("'unsafe-inline'", "'unsafe-eval'");
    connectSources.push('ws:');
  }

  return [
    "default-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    `script-src ${scriptSources.join(' ')}`,
    "img-src 'self' data:",
    `connect-src ${connectSources.join(' ')}`,
  ].join('; ');
};

const getSecurityHeaders = (): Record<string, string> => ({
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Content-Security-Policy': buildContentSecurityPolicy(),
});

const PROTECTED_PATH_PATTERNS = [
  /^\/dashboard(?:\/|$)/i,
  /^\/children(?:\/|$)/i,
  /^\/analytics(?:\/|$)/i,
  /^\/plans(?:\/|$)/i,
  /^\/admin(?:\/|$)/i,
  /^\/settings(?:\/|$)/i,
];

const isAllowedOrigin = (origin: string) => {
  if (PRODUCTION_ORIGINS.includes(origin)) {
    return true;
  }
  return PREVIEW_PATTERN.test(origin);
};

const isProtectedPath = (pathname: string) =>
  PROTECTED_PATH_PATTERNS.some((pattern) => pattern.test(pathname));

const isSkippablePath = (pathname: string) =>
  pathname.startsWith('/api/') ||
  pathname.startsWith('/_next/') ||
  pathname.startsWith('/favicon') ||
  pathname.startsWith('/assets/');

const applySecurityHeaders = (headers: Headers) => {
  const securityHeaders = getSecurityHeaders();
  Object.entries(securityHeaders).forEach(([key, value]) => {
    headers.set(key, value);
  });
};

const applyCorsHeaders = (headers: Headers, origin: string, request: NextRequest) => {
  headers.set('Access-Control-Allow-Origin', origin);
  headers.append('Vary', 'Origin');
  headers.set('Access-Control-Allow-Methods', ALLOWED_METHODS.join(', '));
  const requestedHeaders = request.headers.get('access-control-request-headers');
  if (requestedHeaders) {
    headers.set('Access-Control-Allow-Headers', requestedHeaders);
  } else {
    headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  }
  headers.set('Access-Control-Allow-Credentials', 'true');
};

export function middleware(request: NextRequest) {
  return handleRequest(request);
}

const handleRequest = async (request: NextRequest) => {
  const origin = request.headers.get('origin');
  const responseHeaders = new Headers();
  const correlationId = getCorrelationId(request.headers);

  request.headers.set('x-correlation-id', correlationId);
  responseHeaders.set('x-correlation-id', correlationId);

  const log = createRequestLogger(correlationId, {
    path: request.nextUrl.pathname,
    method: request.method,
  });

  applySecurityHeaders(responseHeaders);

  if (origin && origin !== request.nextUrl.origin) {
    if (!isAllowedOrigin(origin)) {
      log.warn({ origin }, 'blocked request from forbidden origin');
      return NextResponse.json(
        { error: 'Forbidden origin' },
        {
          status: 403,
          headers: responseHeaders,
        },
      );
    }

    applyCorsHeaders(responseHeaders, origin, request);

    if (request.method === 'OPTIONS') {
      log.debug({ origin }, 'handled preflight request');
      return new NextResponse(null, {
        status: 204,
        headers: responseHeaders,
      });
    }
  }

  if (
    request.method !== 'OPTIONS' &&
    !isSkippablePath(request.nextUrl.pathname) &&
    isProtectedPath(request.nextUrl.pathname)
  ) {
    const token = await getToken({
      req: request,
      secret: env.NEXTAUTH_SECRET,
    });

    if (!token) {
      log.info('unauthenticated request redirected to sign-in');
      const signInUrl = new URL('/api/auth/signin', request.url);
      signInUrl.searchParams.set('callbackUrl', request.nextUrl.pathname + request.nextUrl.search);

      const redirectResponse = NextResponse.redirect(signInUrl);

      responseHeaders.forEach((value, key) => {
        redirectResponse.headers.set(key, value);
      });

      return redirectResponse;
    }
  }

  const response = NextResponse.next({
    request,
  });

  responseHeaders.forEach((value, key) => {
    response.headers.set(key, value);
  });

  log.debug('request allowed to proceed');

  return response;
};

export const config = {
  matcher: '/:path*',
};
