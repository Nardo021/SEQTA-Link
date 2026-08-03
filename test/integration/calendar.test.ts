import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import {
  createTestApp,
  cleanupTempDb,
  baseSyncPayload,
} from "../helpers/test-app.js";
import { createFeedService } from "../../src/cli/db.js";
import { randomUUID } from "node:crypto";

describe("calendar integration", () => {
  let dbPath = "";

  after(async () => {
    if (dbPath) {
      cleanupTempDb(dbPath);
    }
  });

  it("12. invalid calendar token returns 404", async () => {
    const { app, dbPath: path } = await createTestApp();
    dbPath = path;

    const response = await app.inject({
      method: "GET",
      url: "/calendar/scc_invalidtokenvaluexxxxxxxxxxxxxxxxxxxxxxxxx.ics",
    });
    assert.equal(response.statusCode, 404);
    await app.close();
  });

  it("13. matching ETag returns 304", async () => {
    const { app, config, dbPath: path } = await createTestApp();
    dbPath = path;

    const feedService = createFeedService(app.db, config);
    const feed = feedService.createFeed({
      name: "Calendar Feed",
      schoolHost: "learn.example-school.edu.au",
      studentRef: "7777",
      timezone: "Australia/Sydney",
    });

    await app.inject({
      method: "POST",
      url: "/api/v1/sync",
      headers: {
        authorization: `Bearer ${feed.uploadToken}`,
        "idempotency-key": randomUUID(),
      },
      payload: baseSyncPayload({ studentRef: "7777" }),
    });

    const first = await app.inject({
      method: "GET",
      url: `/calendar/${feed.calendarToken}.ics`,
    });
    const etag = first.headers.etag;
    assert.ok(etag);

    const second = await app.inject({
      method: "GET",
      url: `/calendar/${feed.calendarToken}.ics`,
      headers: { "if-none-match": etag },
    });
    assert.equal(second.statusCode, 304);
    await app.close();
  });

  it("14. content change updates ETag but preserves UID", async () => {
    const { app, config, dbPath: path } = await createTestApp();
    dbPath = path;

    const feedService = createFeedService(app.db, config);
    const feed = feedService.createFeed({
      name: "ETag Feed",
      schoolHost: "learn.example-school.edu.au",
      studentRef: "8888",
      timezone: "Australia/Sydney",
    });

    await app.inject({
      method: "POST",
      url: "/api/v1/sync",
      headers: {
        authorization: `Bearer ${feed.uploadToken}`,
        "idempotency-key": randomUUID(),
      },
      payload: baseSyncPayload({ studentRef: "8888" }),
    });

    const first = await app.inject({
      method: "GET",
      url: `/calendar/${feed.calendarToken}.ics`,
    });
    const firstEtag = first.headers.etag;
    const uidBefore = app.db.prepare("SELECT ical_uid FROM events").get() as {
      ical_uid: string;
    };
    assert.ok(uidBefore.ical_uid);

    await app.inject({
      method: "POST",
      url: "/api/v1/sync",
      headers: {
        authorization: `Bearer ${feed.uploadToken}`,
        "idempotency-key": randomUUID(),
      },
      payload: baseSyncPayload({
        studentRef: "8888",
        lessons: [
          { ...baseSyncPayload().lessons[0], teacher: "Changed Teacher" },
        ],
      }),
    });

    const second = await app.inject({
      method: "GET",
      url: `/calendar/${feed.calendarToken}.ics`,
    });

    assert.notEqual(second.headers.etag, firstEtag);
    assert.match(
      String(second.body),
      new RegExp(
        `UID:${uidBefore.ical_uid.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
      ),
    );
    assert.match(String(second.body), /SEQUENCE:1/);
    await app.close();
  });
});
