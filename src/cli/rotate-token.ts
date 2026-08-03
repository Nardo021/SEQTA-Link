import { openDatabase, createFeedService } from './db.js';
import { parseArgs } from './parse-args.js';

export async function rotateTokenCommand(args: string[]): Promise<void> {
  const options = parseArgs(args);
  const feedId = options.feed;
  const type = options.type as 'upload' | 'calendar' | undefined;

  if (!feedId || (type !== 'upload' && type !== 'calendar')) {
    console.error('Usage: npm run cli -- rotate-token --feed <feed-id> --type upload|calendar');
    process.exit(1);
  }

  const { db, config } = openDatabase();
  try {
    const feedService = createFeedService(db, config);
    const newToken = feedService.rotateToken(feedId, type);

    console.log(`${type === 'upload' ? 'Upload' : 'Calendar'} Token:`);
    console.log(newToken);
    if (type === 'calendar') {
      console.log('');
      console.log('Calendar URL:');
      console.log(`${config.publicBaseUrl}/calendar/${newToken}.ics`);
    }
    console.log('');
    console.log('Store this token securely. It cannot be recovered later.');
  } finally {
    db.close();
  }
}
