import { createFeedCommand } from './create-feed.js';
import { rotateTokenCommand } from './rotate-token.js';
import { inspectFeedCommand } from './inspect-feed.js';
import { backupCommand } from './backup.js';
import { migrateV1SqliteCommand } from './migrate-v1-sqlite.js';
import { bootstrapOwnerCommand } from './bootstrap-owner.js';
import { initCommand } from './init.js';

const commands: Record<string, (args: string[]) => Promise<void> | void> = {
  init: initCommand,
  'create-feed': createFeedCommand,
  'rotate-token': rotateTokenCommand,
  'inspect-feed': inspectFeedCommand,
  backup: backupCommand,
  'migrate-v1-sqlite': migrateV1SqliteCommand,
  'bootstrap-owner': bootstrapOwnerCommand,
};

async function main(): Promise<void> {
  const [, , command, ...args] = process.argv;
  if (!command || !commands[command]) {
    console.error(`Usage: npm run cli -- <${Object.keys(commands).join('|')}> [options]`);
    process.exit(1);
  }

  const handler = commands[command]!;
  await handler(args);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
