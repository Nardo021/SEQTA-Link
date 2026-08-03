import { loadConfig } from './config.js';
import { buildApp } from './app.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const app = await buildApp(config);

  await app.listen({ host: config.host, port: config.port });

  app.log.info({
    event: 'service_started',
    host: config.host,
    port: config.port,
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
