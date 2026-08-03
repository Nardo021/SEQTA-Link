import { openDatabase, createFeedService } from './db.js';
import { parseArgs } from './parse-args.js';

export async function inspectFeedCommand(args: string[]): Promise<void> {
  const options = parseArgs(args);
  const feedId = options.feed;

  if (!feedId) {
    console.error('Usage: npm run cli -- inspect-feed --feed <feed-id>');
    process.exit(1);
  }

  const { db, config } = openDatabase();
  try {
    const feedService = createFeedService(db, config);
    const feed = feedService.findById(feedId);
    const status = feedService.getStatus(feed);
    console.log(JSON.stringify(status, null, 2));
  } finally {
    db.close();
  }
}
