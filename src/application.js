import { Engine } from './engine/engine.js';
import { startServer } from './api/server.js';

// Both interfaces share this engine. The caller owns the application's lifetime.
export async function startApplication({ dataDir, providers, port = 8790, token, allowedHosts }) {
  const engine = await Engine.open({ dataDir, providers });
  let api;
  try {
    api = await startServer(engine, { port, token, allowedHosts });
  } catch (error) {
    await engine.close();
    throw error;
  }
  let closing;
  return {
    engine,
    url: api.url,
    token: api.token,
    webUrl: api.webUrl,
    close() {
      return (closing ||= (async () => {
        try {
          await engine.close();
        } finally {
          await api.close();
        }
      })());
    },
  };
}

export { openAssessment } from './assessments.js';
