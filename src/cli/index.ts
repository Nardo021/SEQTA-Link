import { createFeedCommand } from './create-feed.js';
import { rotateTokenCommand } from './rotate-token.js';
import { inspectFeedCommand } from './inspect-feed.js';
import { backupCommand } from './backup.js';

const commands: Record<string, (args: string[]) => Promise<void> | void> = {
  'create-feed': createFeedCommand,
  'rotate-token': rotateTokenCommand,
  'inspect-feed': inspectFeedCommand,
  backup: backupCommand,
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
