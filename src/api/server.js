import http from 'node:http';
import { z } from 'zod';
import { AppError, insist, parse } from '../engine/errors.js';
import {
  CreateProject,
  UpdateProject,
  SourceInput,
  RunInput,
  Review,
  PhaseId,
  ProviderId,
  PHASES,
  Schemas,
  jsonSchema,
  enabledPhases,
} from '../engine/schema.js';
import { markdownReport, pdfReport } from '../engine/report.js';

const MAX_BODY = 16 * 1024 * 1024;
const json = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
};

export async function startServer(engine, { port = 8790, host = '127.0.0.1' } = {}) {
  insist(
    ['127.0.0.1', '::1', 'localhost'].includes(host),
    'AiTM is a single-user local server. Bind to loopback only.',
  );
  const streams = new Set();
  const routes = [];
  const route = (method, path, summary, body, handler) =>
    routes.push({
      method,
      path,
      summary,
      body,
      handler,
      names: [...path.matchAll(/:([\w]+)/g)].map((m) => m[1]),
      pattern: new RegExp(`^${path.replace(/:[\w]+/g, '([^/]+)')}$`),
    });
  route('GET', '/v1/health', 'Server identity and health', null, () => ({
    service: 'aitm',
    version: '2.0.0',
    apiVersion: 1,
    pid: process.pid,
    dataDir: engine.store.directory,
  }));
  route('GET', '/v1/meta', 'TRACE phase registry and artifact schemas', null, () => ({
    phases: PHASES,
    schemas: Object.fromEntries(Object.entries(Schemas).map(([k, v]) => [k, jsonSchema(v)])),
  }));
  route('GET', '/v1/providers', 'Provider configuration (no credentials)', null, () =>
    engine.providers.status(),
  );
  route(
    'POST',
    '/v1/providers/:provider/test',
    'Verify a provider and model with a small API request',
    z.strictObject({ model: z.string().min(1).max(300) }),
    ({ params, body }) =>
      engine.providers.test(
        parse(ProviderId, params.provider),
        body.model,
        AbortSignal.timeout(30000),
      ),
  );
  route('GET', '/v1/projects', 'List projects', null, () => engine.list());
  route('POST', '/v1/projects', 'Create a project', CreateProject, ({ body }) =>
    engine.create(body),
  );
  route(
    'POST',
    '/v1/projects/import',
    'Import a portable project snapshot',
    z.object({
      format: z.literal('aitm-project'),
      version: z.literal(2),
      project: z.record(z.string(), z.unknown()),
    }),
    ({ body }) => engine.import(body),
  );
  route('GET', '/v1/projects/:projectId', 'Read project state', null, ({ params }) =>
    engine.get(params.projectId),
  );
  route(
    'PATCH',
    '/v1/projects/:projectId',
    'Edit scope, name or configuration with revision check',
    UpdateProject,
    ({ params, body }) => engine.update(params.projectId, body),
  );
  route('DELETE', '/v1/projects/:projectId', 'Delete a project', null, ({ params }) => {
    engine.remove(params.projectId);
    return { deleted: true };
  });
  route('GET', '/v1/projects/:projectId/phases', 'Get enabled TRACE phases', null, ({ params }) =>
    enabledPhases(engine.get(params.projectId)),
  );
  route(
    'POST',
    '/v1/projects/:projectId/sources',
    'Ingest local, repository, document or synced evidence',
    SourceInput,
    ({ params, body }) => engine.addSource(params.projectId, body),
  );
  route(
    'PUT',
    '/v1/projects/:projectId/sources/:sourceId',
    'Replace a source snapshot and invalidate dependent analysis',
    SourceInput,
    ({ params, body }) => engine.addSource(params.projectId, body, params.sourceId),
  );
  route(
    'POST',
    '/v1/projects/:projectId/sources/:sourceId/sync',
    'Refresh a local path or repository snapshot',
    z.strictObject({}),
    ({ params }) => engine.syncSource(params.projectId, params.sourceId),
  );
  route(
    'DELETE',
    '/v1/projects/:projectId/sources/:sourceId',
    'Remove a source',
    null,
    ({ params }) => engine.removeSource(params.projectId, params.sourceId),
  );
  route(
    'PUT',
    '/v1/projects/:projectId/artifacts/:phase',
    'Edit a phase artifact and invalidate its dependents',
    z.strictObject({ revision: z.int().min(1), data: z.unknown() }),
    ({ params, body }) => engine.editArtifact(params.projectId, parse(PhaseId, params.phase), body),
  );
  route(
    'POST',
    '/v1/projects/:projectId/artifacts/:phase/approve',
    'Record an explicit human review',
    Review,
    ({ params, body }) => engine.approve(params.projectId, parse(PhaseId, params.phase), body),
  );
  route(
    'POST',
    '/v1/projects/:projectId/runs',
    'Start or resume a TRACE pipeline job',
    RunInput,
    ({ params, body }) => engine.run(params.projectId, body),
  );
  route(
    'GET',
    '/v1/projects/:projectId/runs/:runId',
    'Get durable job state and progress',
    null,
    ({ params }) => engine.getRun(params.projectId, params.runId),
  );
  route(
    'POST',
    '/v1/projects/:projectId/runs/:runId/cancel',
    'Cancel a running job',
    z.strictObject({}),
    ({ params }) => engine.cancel(params.projectId, params.runId),
  );
  route(
    'GET',
    '/v1/projects/:projectId/export',
    'Export a portable project snapshot',
    null,
    ({ params }) => engine.export(params.projectId),
  );
  route(
    'GET',
    '/v1/projects/:projectId/report',
    'Export a report as Markdown or PDF (?format=pdf)',
    null,
    async ({ params, url, res }) => {
      const p = engine.get(params.projectId),
        format = url.searchParams.get('format') || 'markdown';
      insist(['markdown', 'pdf'].includes(format), 'Report format must be markdown or pdf.');
      const body = format === 'pdf' ? await pdfReport(p) : markdownReport(p);
      res.writeHead(200, {
        'content-type': format === 'pdf' ? 'application/pdf' : 'text/markdown; charset=utf-8',
        'content-disposition': `attachment; filename="aitm-${p.id}.${format === 'pdf' ? 'pdf' : 'md'}"`,
      });
      res.end(body);
    },
  );
  route(
    'GET',
    '/v1/projects/:projectId/runs/:runId/events',
    'Replay and stream job events using Last-Event-ID',
    null,
    ({ params, req, res, url }) => {
      const run = engine.getRun(params.projectId, params.runId);
      const after = Number(req.headers['last-event-id'] || url.searchParams.get('after') || 0);
      insist(
        Number.isSafeInteger(after) && after >= 0 && after <= run.lastEventId,
        'Invalid event cursor.',
      );
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        connection: 'keep-alive',
        'cache-control': 'no-cache',
        'x-accel-buffering': 'no',
      });
      streams.add(res);
      const terminal = (event) =>
        ['completed', 'failed', 'cancelled', 'interrupted', 'awaiting_review'].includes(event.type);
      const send = (event) => {
        if (res.destroyed) return;
        if (res.writableLength > 1024 * 1024) {
          res.destroy();
          return;
        }
        res.write(`id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
        if (terminal(event)) res.end();
      };
      for (const event of run.events.filter((e) => e.id > after)) send(event);
      if (!['queued', 'running'].includes(run.status)) {
        res.end();
        streams.delete(res);
        return;
      }
      engine.events.on(params.runId, send);
      const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15000);
      heartbeat.unref();
      res.on('close', () => {
        clearInterval(heartbeat);
        streams.delete(res);
        engine.events.off(params.runId, send);
      });
    },
  );
  route(
    'GET',
    '/v1/openapi.json',
    'Machine-readable API contract and artifact schemas',
    null,
    () => ({
      openapi: '3.1.0',
      info: { title: 'AiTM engine API', version: '2.0.0' },
      paths: routes.reduce((paths, r) => {
        const p = r.path.replace(/:([\w]+)/g, '{$1}');
        paths[p] ||= {};
        paths[p][r.method.toLowerCase()] = {
          summary: r.summary,
          parameters: r.names.map((name) => ({
            name,
            in: 'path',
            required: true,
            schema: { type: 'string' },
          })),
          ...(r.body
            ? {
                requestBody: {
                  required: true,
                  content: { 'application/json': { schema: jsonSchema(r.body) } },
                },
              }
            : {}),
          responses: {
            200: {
              description:
                'Successful result; runs return 202 and project creation/import return 201.',
            },
            422: { description: 'Validation error' },
            409: { description: 'Conflict or review gate' },
          },
        };
        return paths;
      }, {}),
      components: {
        schemas: Object.fromEntries(Object.entries(Schemas).map(([k, v]) => [k, jsonSchema(v)])),
      },
    }),
  );
  const server = http.createServer(async (req, res) => {
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('cache-control', 'no-store');
    try {
      const address = server.address(),
        actualPort = address.port;
      const hosts = new Set([
        `127.0.0.1:${actualPort}`,
        `localhost:${actualPort}`,
        `[::1]:${actualPort}`,
      ]);
      insist(hosts.has(req.headers.host), 'Invalid Host header.', 403, 'forbidden');
      if (req.headers.origin)
        insist(
          [...hosts].some((h) => req.headers.origin === `http://${h}`),
          'Cross-origin access is not allowed.',
          403,
          'forbidden',
        );
      if (req.headers['sec-fetch-site'])
        insist(
          ['none', 'same-origin'].includes(req.headers['sec-fetch-site']),
          'Cross-site access is not allowed.',
          403,
          'forbidden',
        );
      const url = new URL(req.url, `http://${req.headers.host}`);
      const selected = routes.find((r) => r.method === req.method && r.pattern.test(url.pathname));
      insist(selected, 'API route not found. See /v1/openapi.json.', 404, 'not_found');
      const matches = selected.pattern.exec(url.pathname);
      const params = Object.fromEntries(
        selected.names.map((name, i) => [name, decodeURIComponent(matches[i + 1])]),
      );
      for (const key of ['projectId', 'sourceId', 'runId'])
        if (params[key]) parse(z.uuid(), params[key]);
      let body;
      if (selected.body) {
        insist(
          req.headers['content-type']?.split(';')[0] === 'application/json',
          'Use Content-Type: application/json.',
          415,
          'unsupported_media',
        );
        const chunks = [];
        let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          insist(size <= MAX_BODY, 'Request exceeds 16 MiB.', 413, 'body_too_large');
          chunks.push(chunk);
        }
        try {
          body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch {
          throw new AppError(400, 'invalid_json', 'Request body is not valid JSON.');
        }
        body = parse(selected.body, body);
      }
      const result = await selected.handler({ params, body, url, req, res });
      if (!res.headersSent) {
        const status =
          req.method === 'POST' && selected.path.endsWith('/runs')
            ? 202
            : req.method === 'POST' &&
                ['/v1/projects', '/v1/projects/import'].includes(selected.path)
              ? 201
              : 200;
        json(res, status, result);
      }
    } catch (error) {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      const known = error instanceof AppError;
      json(res, known ? error.status : 500, {
        error: {
          code: known ? error.code : 'internal_error',
          message: known
            ? engine.providers.redact(error.message)
            : 'The operation could not be completed. Check the selected input and retry.',
        },
      });
    }
  });
  server.requestTimeout = 120000;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  const address = server.address();
  return {
    url: `http://${host === '::1' ? '[::1]' : host}:${address.port}`,
    server,
    close: async () => {
      for (const res of streams) res.end();
      server.closeIdleConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
