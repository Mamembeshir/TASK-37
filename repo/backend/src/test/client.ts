/**
 * Thin HTTP client for integration tests.
 *
 * Wraps Node.js 20 native fetch() in an API compatible with Fastify's
 * inject() helper so test files need minimal changes:
 *   - app.inject(opts)  →  inject(url, opts)
 *   - res.statusCode    →  res.statusCode   (unchanged)
 *   - res.json()        →  res.json()       (synchronous, pre-parsed)
 */

import type { AddressInfo } from 'net';
import type { FastifyInstance } from 'fastify';

export interface InjectOptions {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  url: string;
  headers?: Record<string, string>;
  /** JSON payload — serialised automatically; sets Content-Type: application/json */
  payload?: unknown;
  /** Raw body bytes (e.g. multipart Buffer) — caller must set content-type in headers */
  body?: Buffer | string;
}

export interface InjectResponse {
  statusCode: number;
  /** Synchronous — body is pre-read and pre-parsed during the request. */
  json: <T = any>() => T;
}

/**
 * Make a real HTTP request to a running Fastify test server.
 * Returns a response object with the same API as Fastify's inject() result.
 */
export async function inject(
  baseUrl: string,
  options: InjectOptions,
): Promise<InjectResponse> {
  const { method, url, headers = {}, payload, body } = options;

  const fetchHeaders: Record<string, string> = { ...headers };
  let fetchBody: string | Uint8Array | undefined;

  if (body !== undefined) {
    fetchBody = typeof body === 'string' ? body : (body as unknown as Uint8Array);
  } else if (payload !== undefined) {
    fetchHeaders['content-type'] ??= 'application/json';
    fetchBody = JSON.stringify(payload);
  }

  const response = await fetch(baseUrl + url, {
    method,
    headers: fetchHeaders,
    body: fetchBody,
  });

  const text = await response.text();
  let parsed: unknown = null;
  try { parsed = JSON.parse(text); } catch { /* non-JSON body */ }

  return {
    statusCode: response.status,
    json: <T = any>() => parsed as T,
  };
}

/**
 * Start a Fastify app on a random OS-assigned port and return its base URL.
 * Call this AFTER app.ready() / buildXxxTestApp() in beforeAll.
 * app.close() will also shut down the listener.
 */
export async function startServer(app: FastifyInstance): Promise<string> {
  await app.listen({ port: 0, host: '127.0.0.1' });
  const { port } = app.server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}
