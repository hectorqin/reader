import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyRequest } from 'fastify';
import type { AppConfig } from '../src/config/index.ts';
import { isOriginAllowed, resolveCorsOrigin } from '../src/http/cors.ts';

test('Android origin is allowed and echoed with a restricted H5 allowlist', () => {
  const config = { corsOrigins: ['https://reader.example.com'] } as AppConfig;
  const origin = 'https://appassets.androidplatform.net';
  const request = { headers: { origin } } as FastifyRequest;
  assert.equal(isOriginAllowed(config, request), true);
  assert.equal(resolveCorsOrigin(config, request), origin);
  for (const other of ['https://untrusted.example', origin + '.evil.test', 'null']) {
    assert.equal(isOriginAllowed(config, { headers: { origin: other } } as FastifyRequest), false);
  }
});

test('the public host is allowed when persisted CORS settings belong to another deployment', () => {
  const config = { corsOrigins: ['https://reader.example.com'] } as AppConfig;
  const request = {
    protocol: 'http',
    headers: {
      origin: 'https://reader-uat.example.com',
      host: 'reader-uat.example.com',
      'x-forwarded-proto': 'https',
    },
  } as unknown as FastifyRequest;
  assert.equal(isOriginAllowed(config, request), true);
});
