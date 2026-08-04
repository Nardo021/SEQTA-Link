import { randomUUID } from 'node:crypto';
import type { AppConfig } from '../../config.js';
import type { DbClient } from '../../db/client.js';
import { nowIso } from '../../shared/dates.js';
import { AppError } from '../../shared/errors.js';
import {
  assertPasswordPolicy,
  hashPassword,
  normalizeEmail,
} from '../../shared/password.js';
import type { UserRecord } from '../../shared/types.js';
import type { TokenService } from '../../security/token.service.js';
import { provisionUserCalendar } from '../calendars/calendar-provisioning.js';
import { UserRepository } from '../users/user.repository.js';

export async function bootstrapOwner(
  db: DbClient,
  config: AppConfig,
  tokenService: TokenService,
  emailRaw: string,
  password: string,
  options: { forcePassword?: boolean } = {},
): Promise<UserRecord> {
  const email = normalizeEmail(emailRaw);
  if (!email.includes('@')) {
    throw new AppError('INVALID_REQUEST', 'A valid email is required.', 400);
  }
  try {
    assertPasswordPolicy(password);
  } catch (error) {
    throw new AppError(
      'INVALID_REQUEST',
      error instanceof Error ? error.message : 'Invalid password.',
      400,
    );
  }

  const userRepo = new UserRepository(db);
  const now = nowIso();
  const passwordHash = hashPassword(password);
  let user = await userRepo.findByEmail(email);

  if (!user) {
    user = await userRepo.createUser({
      id: randomUUID(),
      displayName: email.split('@')[0] || 'Owner',
      email,
      passwordHash,
      role: 'owner',
      now,
    });
  } else {
    const existingHash = await userRepo.getPasswordHash(user.id);
    const updates: Parameters<UserRepository['updateUser']>[1] = {
      role: 'owner',
      accountStatus: 'active',
    };
    if (!existingHash || options.forcePassword) {
      updates.passwordHash = passwordHash;
    }
    user = (await userRepo.updateUser(user.id, updates, now))!;
  }

  await db.withUserContext(user.id, async (client) => {
    await provisionUserCalendar(client, config, tokenService, user);
  });
  return user;
}

export async function ensureOwnerBootstrapFromConfig(
  db: DbClient,
  config: AppConfig,
  tokenService: TokenService,
): Promise<UserRecord | null> {
  const email = config.ownerBootstrapEmail;
  const password = config.ownerBootstrapPassword;
  if (!email || !password) {
    return null;
  }
  const userRepo = new UserRepository(db);
  if ((await userRepo.countOwners()) > 0) {
    return null;
  }
  return bootstrapOwner(db, config, tokenService, email, password);
}
