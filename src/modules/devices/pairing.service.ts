import { randomUUID } from 'node:crypto';
import type { DbClient } from '../../db/client.js';
import { resolvePairingCodeRow } from '../../db/token-resolve.js';
import { generatePairingCode, normalizePairingCode } from '../../shared/crypto.js';
import { nowIso } from '../../shared/dates.js';
import { AppError } from '../../shared/errors.js';
import type { TokenService } from '../feeds/token.service.js';
import { DeviceRepository } from '../calendars/device.repository.js';
import type { UserRecord } from '../../shared/types.js';
import { UserRepository } from '../users/user.repository.js';

export interface PairingCodeRecord {
  id: string;
  ownerUserId: string;
  calendarId: string;
  expiresAt: string;
}

export class PairingRepository {
  constructor(private readonly db: DbClient) {}

  async createPairingCode(input: {
    id: string;
    ownerUserId: string;
    calendarId: string;
    codeHash: string;
    expiresAt: string;
    now: string;
  }): Promise<void> {
    await this.db.exec(
      `INSERT INTO pairing_codes (id, owner_user_id, calendar_id, code_hash, expires_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        input.id,
        input.ownerUserId,
        input.calendarId,
        input.codeHash,
        input.expiresAt,
        input.now,
      ],
    );
  }

  async findActiveByHash(codeHash: string): Promise<PairingCodeRecord | null> {
    const row = await this.db.queryOne<{
      id: string;
      owner_user_id: string;
      calendar_id: string;
      expires_at: string;
      used_at: string | null;
    }>(
      `SELECT id, owner_user_id, calendar_id, expires_at, used_at
       FROM pairing_codes
       WHERE code_hash = $1`,
      [codeHash],
    );
    if (!row || row.used_at) {
      return null;
    }
    return {
      id: row.id,
      ownerUserId: row.owner_user_id,
      calendarId: row.calendar_id,
      expiresAt: row.expires_at,
    };
  }

  async markUsed(pairingCodeId: string, deviceId: string, now: string): Promise<void> {
    await this.db.exec(
      `UPDATE pairing_codes SET used_at = $2, device_id = $3 WHERE id = $1`,
      [pairingCodeId, now, deviceId],
    );
  }
}

export class PairingService {
  constructor(
    private readonly db: DbClient,
    private readonly pairingRepo: PairingRepository,
    private readonly deviceRepo: DeviceRepository,
    private readonly userRepo: UserRepository,
    private readonly tokenService: TokenService,
  ) {}

  hashPairingCode(rawCode: string): string {
    return this.tokenService.hash('device', `pair:${normalizePairingCode(rawCode)}`);
  }

  async createPairingCode(user: UserRecord, calendarId: string): Promise<{ code: string; expiresAt: string }> {
    if (user.accountStatus !== 'active') {
      throw new AppError('ACCOUNT_SUSPENDED', 'Account is not active.', 403);
    }

    const activeDevices = await this.deviceRepo.countActiveByOwner(user.id);
    if (activeDevices >= user.maxDevices) {
      throw new AppError(
        'DEVICE_LIMIT_REACHED',
        `Maximum of ${user.maxDevices} active devices reached.`,
        400,
      );
    }

    const code = generatePairingCode();
    const now = nowIso();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    await this.pairingRepo.createPairingCode({
      id: randomUUID(),
      ownerUserId: user.id,
      calendarId,
      codeHash: this.hashPairingCode(code),
      expiresAt,
      now,
    });
    return { code, expiresAt };
  }

  async pairDevice(input: {
    rawCode: string;
    deviceName: string;
  }): Promise<{ deviceToken: string; deviceId: string; calendarId: string; calendarLabel: string }> {
    const normalized = normalizePairingCode(input.rawCode);
    if (normalized.length !== 8) {
      throw new AppError('PAIRING_CODE_INVALID', 'Invalid pairing code.', 400);
    }

    const pairing = await resolvePairingCodeRow(this.db, this.hashPairingCode(input.rawCode));
    if (!pairing || pairing.usedAt) {
      throw new AppError('PAIRING_CODE_INVALID', 'Invalid or already used pairing code.', 400);
    }
    if (new Date(pairing.expiresAt).getTime() <= Date.now()) {
      throw new AppError('PAIRING_CODE_EXPIRED', 'Pairing code has expired.', 400);
    }
    if (pairing.accountStatus !== 'active') {
      throw new AppError('PAIRING_CODE_INVALID', 'Invalid pairing code.', 400);
    }

    const deviceToken = this.tokenService.generateDeviceToken();
    const now = nowIso();
    const deviceId = randomUUID();

    await this.db.withUserContext(pairing.ownerUserId, async (client) => {
      const deviceRepo = new DeviceRepository(client);
      const pairingRepo = new PairingRepository(client);
      const activeDevices = await deviceRepo.countActiveByOwner(pairing.ownerUserId);
      if (activeDevices >= pairing.maxDevices) {
        throw new AppError('DEVICE_LIMIT_REACHED', 'Device limit reached for this account.', 400);
      }
      await deviceRepo.createDevice({
        id: deviceId,
        ownerUserId: pairing.ownerUserId,
        calendarId: pairing.calendarId,
        name: input.deviceName.trim() || 'Browser',
        tokenHash: this.tokenService.hash('device', deviceToken),
        tokenPrefix: deviceToken.slice(0, 12),
        now,
      });
      await pairingRepo.markUsed(pairing.pairingId, deviceId, now);
    });

    return {
      deviceToken,
      deviceId,
      calendarId: pairing.calendarId,
      calendarLabel: pairing.calendarName || 'My Timetable',
    };
  }
}
