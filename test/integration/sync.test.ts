import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createTestApp, baseSyncPayload } from "../helpers/test-app.js";
import { createTestFeed } from "../../src/cli/db.js";
import { queryOne } from "../helpers/db-query.js";

describe("sync integration", () => {
  async function setupFeed(
    db: Awaited<ReturnType<typeof createTestApp>>["db"],
    config: Awaited<ReturnType<typeof createTestApp>>["config"],
  ) {
    return createTestFeed(db.cli, config, {
        name: "Sync Test Feed",
        schoolHost: "learn.masada.onseqtacloud.com",
        studentRef: "4284",
        timezone: "Australia/Sydney",
      });
  }

  async function eventCount(db: Awaited<ReturnType<typeof createTestApp>>["db"], calendarId: string) {
    return queryOne<{ count: string }>(
      db,
      "SELECT COUNT(*)::text AS count FROM events WHERE calendar_id = $1",
      [calendarId],
    );
  }

  async function queryCalendarEvent<T>(
    db: Awaited<ReturnType<typeof createTestApp>>["db"],
    calendarId: string,
    columns: string,
  ) {
    return queryOne<T>(
      db,
      `SELECT ${columns} FROM events WHERE calendar_id = $1 ORDER BY updated_at DESC, id DESC LIMIT 1`,
      [calendarId],
    );
  }
  async function sync(
    app: Awaited<ReturnType<typeof createTestApp>>["app"],
    token: string,
    payload: ReturnType<typeof baseSyncPayload>,
    idempotencyKey = randomUUID(),
  ) {
    return app.inject({
      method: "POST",
      url: "/api/v1/sync",
      headers: {
        authorization: `Bearer ${token}`,
        "idempotency-key": idempotencyKey,
        "content-type": "application/json",
      },
      payload,
    });
  }

  it("1. first sync creates events", async () => {
    const { app, config, db } = await createTestApp();
    const feed = await setupFeed(db, config);

    const response = await sync(app, feed.uploadToken, baseSyncPayload());
    assert.equal(response.statusCode, 200);
    const body = response.json() as { result: { inserted: number } };
    assert.equal(body.result.inserted, 1);

    const count = await eventCount(db, feed.calendar.id);
    assert.equal(Number(count?.count), 1);
    await app.close();
  });

  it("2. identical snapshot produces no changes", async () => {
    const { app, config, db } = await createTestApp();
    const feed = await setupFeed(db, config);
    const payload = baseSyncPayload();

    await sync(app, feed.uploadToken, payload);
    const response = await sync(app, feed.uploadToken, payload);
    const body = response.json() as {
      changed: boolean;
      result: { unchanged: number; inserted: number };
    };
    assert.equal(body.changed, false);
    assert.equal(body.result.unchanged, 1);
    assert.equal(body.result.inserted, 0);

    const count = await eventCount(db, feed.calendar.id);
    assert.equal(Number(count?.count), 1);
    await app.close();
  });

  it("3. idempotent retry returns replayed response", async () => {
    const { app, config, db } = await createTestApp();
    const feed = await setupFeed(db, config);
    const payload = baseSyncPayload();
    const key = randomUUID();

    const first = await sync(app, feed.uploadToken, payload, key);
    const second = await sync(app, feed.uploadToken, payload, key);

    const firstBody = first.json() as { syncId: string };
    const secondBody = second.json() as { replayed: boolean; syncId: string };
    assert.equal(secondBody.replayed, true);
    assert.equal(secondBody.syncId, firstBody.syncId);
    await app.close();
  });

  it("4. teacher change updates existing event", async () => {
    const { app, config, db } = await createTestApp();
    const feed = await setupFeed(db, config);
    await sync(app, feed.uploadToken, baseSyncPayload());

    const payload = baseSyncPayload({
      lessons: [
        {
          ...baseSyncPayload().lessons[0],
          teacher: "Ms Updated",
        },
      ],
    });
    const response = await sync(app, feed.uploadToken, payload);
    const body = response.json() as { result: { updated: number } };
    assert.equal(body.result.updated, 1);

    const event = await queryCalendarEvent<{ teacher: string; sequence: string }>(
      db,
      feed.calendar.id,
      "teacher, sequence::text AS sequence",
    );
    assert.equal(event?.teacher, "Ms Updated");
    assert.equal(Number(event?.sequence), 1);
    await app.close();
  });

  it("5. room change updates existing event", async () => {
    const { app, config, db } = await createTestApp();
    const feed = await setupFeed(db, config);
    await sync(app, feed.uploadToken, baseSyncPayload());

    const payload = baseSyncPayload({
      lessons: [{ ...baseSyncPayload().lessons[0], room: "B101" }],
    });
    const response = await sync(app, feed.uploadToken, payload);
    const body = response.json() as { result: { updated: number } };
    assert.equal(body.result.updated, 1);
    await app.close();
  });

  it("6. time change updates existing event", async () => {
    const { app, config, db } = await createTestApp();
    const feed = await setupFeed(db, config);
    await sync(app, feed.uploadToken, baseSyncPayload());

    const payload = baseSyncPayload({
      lessons: [
        { ...baseSyncPayload().lessons[0], start: "10:00:00", end: "10:55:00" },
      ],
    });
    const response = await sync(app, feed.uploadToken, payload);
    const body = response.json() as { result: { updated: number } };
    assert.equal(body.result.updated, 1);

    const event = await queryCalendarEvent<{ sequence: string }>(
      db,
      feed.calendar.id,
      "sequence::text AS sequence",
    );
    assert.equal(Number(event?.sequence), 1);
    await app.close();
  });

  it("7. complete snapshot missing lesson cancels event", async () => {
    const { app, config, db } = await createTestApp();
    const feed = await setupFeed(db, config);
    await sync(app, feed.uploadToken, baseSyncPayload());

    const response = await sync(
      app,
      feed.uploadToken,
      baseSyncPayload({
        coverage: [{ from: "2026-08-03", until: "2026-08-11", complete: true }],
        lessons: [],
      }),
    );
    assert.equal(response.statusCode, 422);

    const allowed = await sync(
      app,
      feed.uploadToken,
      baseSyncPayload({
        coverage: [{ from: "2026-08-03", until: "2026-08-11", complete: true }],
        lessons: [],
        allowEmptySnapshot: true,
      }),
    );
    const body = allowed.json() as { result: { removed: number } };
    assert.equal(body.result.removed, 1);

    const event = await queryCalendarEvent<{ status: string; active: boolean }>(
      db,
      feed.calendar.id,
      "status, active",
    );
    assert.equal(event?.status, "cancelled");
    assert.equal(event?.active, false);
    await app.close();
  });

  it("8. incomplete coverage does not delete events", async () => {
    const { app, config, db } = await createTestApp();
    const feed = await setupFeed(db, config);
    await sync(app, feed.uploadToken, baseSyncPayload());

    const response = await sync(
      app,
      feed.uploadToken,
      baseSyncPayload({
        coverage: [
          { from: "2026-08-03", until: "2026-08-09", complete: false },
        ],
        lessons: [],
      }),
    );
    assert.equal(response.statusCode, 200);
    const count = await queryOne<{ count: string }>(
      db,
      "SELECT COUNT(*)::text AS count FROM events WHERE calendar_id = $1 AND active = true",
      [feed.calendar.id],
    );
    assert.equal(Number(count?.count), 1);
    await app.close();
  });

  it("9. restored cancelled lesson keeps same UID", async () => {
    const { app, config, db } = await createTestApp();
    const feed = await setupFeed(db, config);
    await sync(app, feed.uploadToken, baseSyncPayload());

    await sync(
      app,
      feed.uploadToken,
      baseSyncPayload({ lessons: [], allowEmptySnapshot: true }),
    );

    const before = await queryCalendarEvent<{ ical_uid: string }>(
      db,
      feed.calendar.id,
      "ical_uid",
    );
    await sync(app, feed.uploadToken, baseSyncPayload());
    const after = await queryCalendarEvent<{
      ical_uid: string;
      status: string;
      active: boolean;
    }>(db, feed.calendar.id, "ical_uid, status, active");

    assert.equal(after?.ical_uid, before?.ical_uid);
    assert.equal(after?.status, "confirmed");
    assert.equal(after?.active, true);
    await app.close();
  });

  it("10. different sourceKey same naturalKey does not duplicate", async () => {
    const { app, config, db } = await createTestApp();
    const feed = await setupFeed(db, config);
    await sync(app, feed.uploadToken, baseSyncPayload());

    const payload = baseSyncPayload({
      lessons: [
        {
          ...baseSyncPayload().lessons[0],
          sourceKey: "alternate-source-key",
        },
      ],
    });
    const response = await sync(app, feed.uploadToken, payload);
    const body = response.json() as {
      result: { inserted: number; unchanged: number };
    };
    assert.equal(body.result.inserted, 0);
    assert.equal(body.result.unchanged, 1);

    const count = await eventCount(db, feed.calendar.id);
    assert.equal(Number(count?.count), 1);
    await app.close();
  });

  it("11. duplicate conflict rolls back entire transaction", async () => {
    const { app, config, db } = await createTestApp();
    const feed = await setupFeed(db, config);
    await sync(app, feed.uploadToken, baseSyncPayload());

    const payload = baseSyncPayload({
      lessons: [
        baseSyncPayload().lessons[0],
        {
          ...baseSyncPayload().lessons[0],
          sourceKey: "conflict-key",
          teacher: "Different Teacher",
        },
      ],
    });

    const response = await sync(app, feed.uploadToken, payload);
    assert.equal(response.statusCode, 409);
    const body = response.json() as { error: { code: string } };
    assert.equal(body.error.code, "DUPLICATE_LESSON_CONFLICT");

    const event = await queryCalendarEvent<{ teacher: string }>(
      db,
      feed.calendar.id,
      "teacher",
    );
    assert.equal(event?.teacher, "Mr Example");

    const syncRuns = await queryOne<{ count: string }>(
      db,
      `SELECT COUNT(*)::text AS count FROM sync_runs
       WHERE calendar_id = $1 AND status = $2`,
      [feed.calendar.id, "success"],
    );
    assert.equal(Number(syncRuns?.count), 1);
    await app.close();
  });

  it("15. failed sync leaves database unchanged", async () => {
    const { app, config, db } = await createTestApp();
    const feed = await setupFeed(db, config);
    await sync(app, feed.uploadToken, baseSyncPayload());

    const before = await queryCalendarEvent<{ teacher: string; sequence: string }>(
      db,
      feed.calendar.id,
      "teacher, sequence::text AS sequence",
    );

    const response = await sync(
      app,
      feed.uploadToken,
      baseSyncPayload({
        schoolHost: "wrong-school.edu.au",
      }),
    );
    assert.equal(response.statusCode, 409);

    const after = await queryCalendarEvent<{ teacher: string; sequence: string }>(
      db,
      feed.calendar.id,
      "teacher, sequence::text AS sequence",
    );
    assert.deepEqual(after, before);
    await app.close();
  });
});
