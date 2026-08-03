import { randomUUID } from "node:crypto";
import type { AppConfig } from "../../config.js";
import { nowIso } from "../../shared/dates.js";
import { generateRawToken } from "../../shared/crypto.js";
import type { FeedRecord } from "../../shared/types.js";
import { AppError } from "../../shared/errors.js";
import { FeedRepository } from "./feed.repository.js";
import { TokenService } from "./token.service.js";

export interface CreateFeedInput {
  name: string;
  schoolHost: string;
  studentRef: string;
  timezone: string;
}

export interface CreateFeedResult {
  feed: FeedRecord;
  uploadToken: string;
  calendarToken: string;
  calendarUrl: string;
}

export class FeedService {
  private readonly repo: FeedRepository;

  constructor(
    private readonly config: AppConfig,
    private readonly tokenService: TokenService,
    feedRepository: FeedRepository,
  ) {
    this.repo = feedRepository;
  }

  createFeed(input: CreateFeedInput): CreateFeedResult {
    if (input.timezone !== this.config.defaultTimezone) {
      throw new AppError(
        "INVALID_TIMEZONE",
        "Only Australia/Sydney is supported.",
        400,
      );
    }

    const tokens = this.tokenService.generateTokenPair();
    const now = nowIso();

    try {
      const feed = this.repo.createFeed({
        id: randomUUID(),
        name: input.name,
        schoolHost: input.schoolHost,
        studentRef: input.studentRef,
        timezone: input.timezone,
        uploadTokenHash: this.tokenService.hash("upload", tokens.uploadToken),
        calendarTokenHash: this.tokenService.hash(
          "calendar",
          tokens.calendarToken,
        ),
        now,
      });

      return {
        feed,
        uploadToken: tokens.uploadToken,
        calendarToken: tokens.calendarToken,
        calendarUrl: `${this.config.publicBaseUrl}/calendar/${tokens.calendarToken}.ics`,
      };
    } catch (error) {
      if (isSqliteConstraintError(error)) {
        throw new AppError(
          "INVALID_REQUEST",
          "A feed already exists for this school and student reference.",
          409,
        );
      }
      throw error;
    }
  }

  authenticateUploadToken(rawToken: string): FeedRecord {
    const hash = this.tokenService.hash("upload", rawToken);
    const feed = this.repo.findByUploadTokenHash(hash);
    if (!feed) {
      throw new AppError("INVALID_TOKEN", "Invalid upload token.", 401);
    }
    return feed;
  }

  authenticateCalendarToken(rawToken: string): FeedRecord {
    const hash = this.tokenService.hash("calendar", rawToken);
    const feed = this.repo.findByCalendarTokenHash(hash);
    if (!feed) {
      throw new AppError("INVALID_TOKEN", "Calendar feed not found.", 404);
    }
    return feed;
  }

  findById(feedId: string): FeedRecord {
    const feed = this.repo.findById(feedId);
    if (!feed) {
      throw new AppError("INVALID_REQUEST", "Feed not found.", 404);
    }
    return feed;
  }

  rotateToken(feedId: string, type: "upload" | "calendar"): string {
    this.findById(feedId);
    const newToken = generateRawToken(type);
    this.repo.updateTokenHash(
      feedId,
      type,
      this.tokenService.hash(type, newToken),
      nowIso(),
    );
    return newToken;
  }

  getStatus(feed: FeedRecord) {
    const stats = this.repo.getEventStats(feed.id);
    const lastStatus = this.repo.getLastSyncStatus(feed.id) ?? "unknown";
    return {
      feed: {
        name: feed.name,
        timezone: feed.timezone,
        revision: feed.revision,
      },
      sync: {
        lastSyncedAt: feed.lastSyncedAt,
        lastChangedAt: feed.lastChangedAt,
        lastStatus,
      },
      events: stats,
    };
  }
}

function isSqliteConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: string }).code === "SQLITE_CONSTRAINT_UNIQUE"
  );
}
