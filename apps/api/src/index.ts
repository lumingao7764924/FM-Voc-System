import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import { env } from './config.js';
import { registerRoutes } from './routes.js';

async function main() {
  const app = Fastify({
    logger: true,
    bodyLimit: 25 * 1024 * 1024,
  });

  await app.register(cors, {
    origin: env.corsOrigin,
    credentials: true,
  });
  await app.register(cookie);
  await app.register(multipart, {
    limits: { fileSize: 20 * 1024 * 1024 },
  });

  app.setErrorHandler((err, _req, reply) => {
    const status = (err as Error & { statusCode?: number }).statusCode ?? 500;
    const message = err instanceof Error ? err.message : 'Unknown error';
    app.log.error(err);
    reply.code(status).send({
      error: status === 401 ? 'unauthorized' : status === 403 ? 'forbidden' : 'error',
      message,
    });
  });

  await registerRoutes(app);

  await app.listen({ port: env.port, host: env.host });
  app.log.info(`VOC API listening on ${env.host}:${env.port} (dryRun=${env.importDryRun})`);
  if (env.llmApiKey && env.llmBaseUrl && env.llmModel) {
    app.log.info(
      `LLM ready: model=${env.llmModel} base=${env.llmBaseUrl} mode=responses effort=${env.llmReasoningEffort || 'default'}`,
    );
  } else {
    app.log.info('LLM not configured → analysis uses stub');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});