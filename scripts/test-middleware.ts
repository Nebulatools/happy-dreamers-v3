import assert from 'node:assert/strict';
import { NextRequest, NextResponse } from 'next/server';

import { middleware } from '../middleware';

const disallowedOrigin = 'https://malicious.example.com';
const url = 'https://happy-dreamers.app/api/test';

const request = new NextRequest(url, {
  headers: {
    origin: disallowedOrigin,
  },
});

const main = async () => {
  const response: NextResponse = await middleware(request);

  assert.equal(
    response.status,
    403,
    `Expected middleware to block disallowed origin "${disallowedOrigin}" with 403.`,
  );

  console.info('OK Middleware blocks disallowed origin with 403');
};

void main();
