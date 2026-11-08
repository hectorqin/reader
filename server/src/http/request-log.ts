import type { FastifyRequest } from 'fastify';

export function requestLogPath(url: string): string {
  return url.split(/[?#]/, 1)[0] ?? '';
}

export function serializeRequest(request: FastifyRequest) {
  return {
    method: request.method,
    url: requestLogPath(request.url),
    hostname: request.hostname,
    remoteAddress: request.ip,
  };
}
