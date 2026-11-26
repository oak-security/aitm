import { readToken } from './token.js';

export class ApiClient {
  // The token defaults to AITM_TOKEN, then to the token file of the current user.
  constructor(url = 'http://127.0.0.1:8790', { token } = {}) {
    const parsed = new URL(url);
    if (
      parsed.protocol !== 'http:' ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname) ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== '/' ||
      parsed.search ||
      parsed.hash
    )
      throw new Error('Use a loopback HTTP API URL, for example http://127.0.0.1:8790.');
    this.url = parsed.origin;
    this.token = token;
  }
  authorization() {
    this.token ??= process.env.AITM_TOKEN || readToken();
    return this.token ? { authorization: `Bearer ${this.token}` } : {};
  }
  async request(method, path, body, { signal, format = 'json' } = {}) {
    let response;
    try {
      response = await fetch(this.url + path, {
        method,
        signal,
        redirect: 'error',
        headers: {
          ...this.authorization(),
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new Error('Cannot reach the AiTM API. Open aitm or aitm serve, and check the API URL.');
    }
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error?.message || `API request failed (${response.status}).`);
    }
    return format === 'text'
      ? response.text()
      : format === 'buffer'
        ? Buffer.from(await response.arrayBuffer())
        : response.json();
  }
  get(path, options) {
    return this.request('GET', path, undefined, options);
  }
  post(path, body = {}) {
    return this.request('POST', path, body);
  }
  projectPath(id) {
    return `/v1/projects/${encodeURIComponent(id)}`;
  }
  async *events(projectId, runId, { after = 0, signal } = {}) {
    const url = `${this.url}${this.projectPath(projectId)}/runs/${encodeURIComponent(runId)}/events?after=${after}`;
    const response = await fetch(url, {
      signal,
      redirect: 'error',
      headers: this.authorization(),
    });
    if (!response.ok) throw new Error(`Cannot stream progress (HTTP ${response.status}).`);
    const decoder = new TextDecoder();
    let pending = '';
    try {
      for await (const chunk of response.body) {
        pending = (pending + decoder.decode(chunk, { stream: true })).replace(/\r\n/g, '\n');
        let end;
        while ((end = pending.indexOf('\n\n')) >= 0) {
          const lines = pending.slice(0, end).split('\n');
          pending = pending.slice(end + 2);
          const data = lines
            .filter((l) => l.startsWith('data:'))
            .map((l) => l.slice(5).trimStart())
            .join('\n');
          if (data) yield JSON.parse(data);
        }
      }
    } catch (error) {
      if (!signal?.aborted) throw error;
    }
  }
}
