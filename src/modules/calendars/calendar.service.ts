import type { DbClient } from '../../db/client.js';
import { generateRawToken } from '../../shared/crypto.js';
import { nowIso } from '../../shared/dates.js';
import type { CalendarRecord } from '../../shared/types.js';
import { AppError } from '../../shared/errors.js';
import type { TokenService } from '../../security/token.service.js';
import { CalendarRepository } from './calendar.repository.js';

export class CalendarService {
  private readonly calendarRepo: CalendarRepository;

  constructor(
    private readonly tokenService: TokenService,
    calendarRepo: CalendarRepository,
  ) {
    this.calendarRepo = calendarRepo;
  }

  static fromDb(db: DbClient, tokenService: TokenService): CalendarService {
    return new CalendarService(tokenService, new CalendarRepository(db));
  }

  async findById(calendarId: string): Promise<CalendarRecord> {
    const calendar = await this.calendarRepo.findById(calendarId);
    if (!calendar) {
      throw new AppError('INVALID_REQUEST', 'Calendar not found.', 404);
    }
    return calendar;
  }

  async rotateCalendarToken(calendarId: string): Promise<string> {
    await this.findById(calendarId);
    const newToken = generateRawToken('calendar');
    await this.calendarRepo.updateCalendarToken(
      calendarId,
      this.tokenService.hash('calendar', newToken),
      newToken.slice(0, 12),
      nowIso(),
    );
    return newToken;
  }
}
