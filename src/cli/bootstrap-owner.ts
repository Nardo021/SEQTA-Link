import { bootstrapOwner } from '../modules/auth/owner-bootstrap.js';
import { closeDatabase, openDatabase } from './db.js';
import { parseArgs } from './parse-args.js';

export async function bootstrapOwnerCommand(args: string[]): Promise<void> {
  const options = parseArgs(args);
  const email =
    (options.email as string | undefined)?.trim() ||
    process.env.OWNER_BOOTSTRAP_EMAIL;
  const password =
    (options.password as string | undefined) ||
    process.env.OWNER_BOOTSTRAP_PASSWORD;
  const forcePassword = options['force-password'] === 'true';

  if (!email || !password) {
    console.error(
      'Usage: npm run cli -- bootstrap-owner --email <email> --password <password> [--force-password]\n' +
        'Or set OWNER_BOOTSTRAP_EMAIL and OWNER_BOOTSTRAP_PASSWORD.',
    );
    process.exit(1);
  }

  const handle = await openDatabase();
  try {
    const user = await bootstrapOwner(
      handle.db.cli,
      handle.config,
      handle.tokenService,
      email,
      password,
      { forcePassword: Boolean(forcePassword) },
    );
    console.log(
      JSON.stringify(
        {
          event: 'owner_bootstrap_completed',
          userId: user.id,
          email: user.email,
          role: user.role,
        },
        null,
        2,
      ),
    );
  } finally {
    await closeDatabase(handle);
  }
}
