import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AppContext } from '../context.ts';
import { authenticate, currentUser } from '../auth.ts';
import { McpCredentials } from '../../services/mcp-credentials.ts';
import { McpService, type JsonRpcRequest } from '../../services/mcp.ts';
import { withSignal } from '../request-signal.ts';

export function registerMcpRoutes(app: FastifyInstance, ctx: AppContext): void {
  const credentials = new McpCredentials(ctx.db);
  const service = new McpService(ctx);
  const auth = authenticate(ctx);
  const endpointUrl = () => `${ctx.config.publicUrl.replace(/\/$/, '')}/mcp`;

  app.addHook('onSend', async (request, reply, payload) => {
    if (request.url === '/mcp' || request.url.startsWith('/mcp?') || request.url.startsWith('/api/v1/mcp/')) {
      reply.header('cache-control', 'private, no-store');
      reply.header('referrer-policy', 'no-referrer');
    }
    return payload;
  });

  app.get('/api/v1/mcp/credentials', { preHandler: auth }, async (request) => ({
    credentials: credentials.list(currentUser(request).id),
    endpointUrl: endpointUrl(),
  }));

  app.post('/api/v1/mcp/credentials', { preHandler: auth }, async (request, reply) => {
    const body = (request.body ?? {}) as { name?: unknown; scope?: unknown };
    reply.code(201);
    return {
      ...credentials.create(currentUser(request).id, body.name, body.scope),
      endpointUrl: endpointUrl(),
    };
  });

  app.delete('/api/v1/mcp/credentials/:id', { preHandler: auth }, async (request) => {
    credentials.revoke(currentUser(request).id, (request.params as { id: string }).id);
    return { ok: true };
  });

  const handleMcp = async (request: FastifyRequest, reply: FastifyReply) => {
    const principal = credentials.authenticate(request.headers.authorization);
    const body = request.body;
    if (!body || typeof body !== 'object') {
      return reply.code(400).send({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: 'Expected JSON-RPC 2.0 object or array' },
      });
    }

    return withSignal(request, reply, async (signal) => {
      if (Array.isArray(body)) {
        if (body.length === 0 || body.length > 20) {
          return reply.code(400).send({
            jsonrpc: '2.0',
            id: null,
            error: { code: -32600, message: 'Batch size must be between 1 and 20' },
          });
        }
        const responses = [];
        for (const item of body) {
          const res = await service.handle(principal, item as JsonRpcRequest, signal);
          if (res) responses.push(res);
        }
        if (responses.length === 0) return reply.code(202).send();
        return reply.type('application/json').send(responses);
      }

      const response = await service.handle(principal, body as JsonRpcRequest, signal);
      if (!response) return reply.code(202).send();
      return reply.type('application/json').send(response);
    });
  };

  app.post('/mcp', handleMcp);
  app.get('/mcp', async (_request, reply) =>
    reply
      .code(405)
      .header('allow', 'POST')
      .send({
        error: { code: 'METHOD_NOT_ALLOWED', message: 'Use POST /mcp for MCP Streamable HTTP JSON-RPC requests' },
      }),
  );
}
