import { NextRequest, NextResponse } from 'next/server';

const PRODUCTION_ORIGINS = ['https://happy-dreamers.app'];
const PREVIEW_PATTERN = /^https:\/\/happy-dreamers-.*\.vercel\.app$/i;

const ALLOWED_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];

const SECURITY_HEADERS: Record<string, string> = {
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Content-Security-Policy': [
    "default-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "script-src 'self'",
    "img-src 'self' data:",
    "connect-src 'self'",
  ].join('; '),
};

const isAllowedOrigin = (origin: string) => {
  if (PRODUCTION_ORIGINS.includes(origin)) {
    return true;
  }
  return PREVIEW_PATTERN.test(origin);
};

const applySecurityHeaders = (headers: Headers) => {
  Object.entries(SECURITY_HEADERS).forEach(([key, value]) => {
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
  const origin = request.headers.get('origin');
  const responseHeaders = new Headers();

  applySecurityHeaders(responseHeaders);

  if (origin && origin !== request.nextUrl.origin) {
    if (!isAllowedOrigin(origin)) {
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
      return new NextResponse(null, {
        status: 204,
        headers: responseHeaders,
      });
    }
  }

  const response = NextResponse.next({
    request,
  });

  responseHeaders.forEach((value, key) => {
    response.headers.set(key, value);
  });

  return response;
}

export const config = {
  matcher: '/:path*',
};
