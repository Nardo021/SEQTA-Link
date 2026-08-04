import { randomUUID } from 'node:crypto';
import type { DbClient } from '../../db/client.js';
import { resolvePairingCodeRow } from '../../db/token-resolve.js';
import { generatePairingCode, normalizePairingCode } from '../../shared/crypto.js';
import { nowIso } from '../../shared/dates.js';
import { AppError } from '../../shared/errors.js';
import type { TokenService } from '../../security/token.service.js';
import { DeviceRepository } from './device.repository.js';
import type { UserRecord } from '../../shared/types.js';
import { PairingRepository } from './pairing.repository.js';

export class PairingService {
  constructor(
    private readonly db: DbClient,
    private readonly pairingRepo: PairingRepository,
    private readonly deviceRepo: DeviceRepository,
    private readonly tokenService: TokenService,
  ) {}

  hashPairingCode(rawCode: string): string {
    return this.tokenService.hash('device', `pair:${normalizePairingCode(rawCode)}`);
  }

  async listPendingCodes(
    user: UserRecord,
  ): Promise<Array<{ id: string; expiresAt: string; createdAt: string }>> {
    return this.pairingRepo.listPendingByOwner(user.id);
  }

  async revokePendingCode(user: UserRecord, pairingCodeId: string): Promise<void> {
    const cancelled = await this.pairingRepo.cancelPending(user.id, pairingCodeId);
    if (!cancelled) {
      throw new AppError('INVALID_REQUEST', 'Pairing code not found.', 404);
    }
  }

  async createPairingCode(
    user: UserRecord,
    calendarId: string,
  ): Promise<{ code: string; expiresAt: string }> {
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
    if (!pairing.syncEnabled) {
      throw new AppError('SYNC_DISABLED', 'Sync is disabled for this account.', 403);
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
