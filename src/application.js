import { Engine } from './engine/engine.js';
import { startServer } from './api/server.js';

// Both interfaces share this engine. The caller owns the application's lifetime.
export async function startApplication({ dataDir, providers, port = 8790 }) {
  const engine = await Engine.open({ dataDir, providers });
  let api;
  try {
    api = await startServer(engine, { port });
  } catch (error) {
    await engine.close();
    throw error;
  }
  let closing;
  return {
    engine,
    url: api.url,
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
