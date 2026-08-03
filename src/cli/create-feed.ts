import { openDatabase, createFeedService } from './db.js';
import { parseArgs } from './parse-args.js';

export async function createFeedCommand(args: string[]): Promise<void> {
  const options = parseArgs(args);
  const name = options.name;
  const schoolHost = options['school-host'];
  const studentRef = options['student-ref'];
  const timezone = options.timezone ?? 'Australia/Sydney';

  if (!name || !schoolHost || !studentRef) {
    console.error(
      'Usage: npm run cli -- create-feed --name "..." --school-host "..." --student-ref "..." [--timezone Australia/Sydney]',
    );
    process.exit(1);
  }

  const { db, config } = openDatabase();
  try {
    const feedService = createFeedService(db, config);
    const result = feedService.createFeed({ name, schoolHost, studentRef, timezone });

    console.log('Feed ID:');
    console.log(result.feed.id);
    console.log('');
    console.log('Upload Token:');
    console.log(result.uploadToken);
    console.log('');
    console.log('Calendar URL:');
    console.log(result.calendarUrl);
    console.log('');
    console.log('Store these tokens securely. They cannot be recovered later.');
  } finally {
    db.close();
  }
}
