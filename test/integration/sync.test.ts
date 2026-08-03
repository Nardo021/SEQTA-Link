import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  createTestApp,
  cleanupTempDb,
  baseSyncPayload,
} from "../helpers/test-app.js";
import { createFeedService } from "../../src/cli/db.js";

describe("sync integration", () => {
  let dbPath = "";

  after(async () => {
    if (dbPath) {
      cleanupTempDb(dbPath);
    }
  });

  async function setupFeed(
    app: Awaited<ReturnType<typeof createTestApp>>["app"],
    config: Awaited<ReturnType<typeof createTestApp>>["config"],
  ) {
    const feedService = createFeedService(app.db, config);
    return feedService.createFeed({
      name: "Sync Test Feed",
      schoolHost: "learn.example-school.edu.au",
      studentRef: "4284",
      timezone: "Australia/Sydney",
    });
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
    const { app, config, dbPath: path } = await createTestApp();
    dbPath = path;
    const feed = await setupFeed(app, config);

    const response = await sync(app, feed.uploadToken, baseSyncPayload());
    assert.equal(response.statusCode, 200);
    const body = response.json() as { result: { inserted: number } };
    assert.equal(body.result.inserted, 1);

    const count = app.db
      .prepare("SELECT COUNT(*) AS count FROM events")
      .get() as { count: number };
    assert.equal(count.count, 1);
    await app.close();
  });

  it("2. identical snapshot produces no changes", async () => {
    const { app, config, dbPath: path } = await createTestApp();
    dbPath = path;
    const feed = await setupFeed(app, config);
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

    const count = app.db
      .prepare("SELECT COUNT(*) AS count FROM events")
      .get() as { count: number };
    assert.equal(count.count, 1);
    await app.close();
  });

  it("3. idempotent retry returns replayed response", async () => {
    const { app, config, dbPath: path } = await createTestApp();
    dbPath = path;
    const feed = await setupFeed(app, config);
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
    const { app, config, dbPath: path } = await createTestApp();
    dbPath = path;
    const feed = await setupFeed(app, config);
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

    const event = app.db
      .prepare("SELECT teacher, sequence FROM events")
      .get() as {
      teacher: string;
      sequence: number;
    };
    assert.equal(event.teacher, "Ms Updated");
    assert.equal(event.sequence, 1);
    await app.close();
  });

  it("5. room change updates existing event", async () => {
    const { app, config, dbPath: path } = await createTestApp();
    dbPath = path;
    const feed = await setupFeed(app, config);
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
    const { app, config, dbPath: path } = await createTestApp();
    dbPath = path;
    const feed = await setupFeed(app, config);
    await sync(app, feed.uploadToken, baseSyncPayload());

    const payload = baseSyncPayload({
      lessons: [
        { ...baseSyncPayload().lessons[0], start: "10:00:00", end: "10:55:00" },
      ],
    });
    const response = await sync(app, feed.uploadToken, payload);
    const body = response.json() as { result: { updated: number } };
    assert.equal(body.result.updated, 1);

    const event = app.db.prepare("SELECT sequence FROM events").get() as {
      sequence: number;
    };
    assert.equal(event.sequence, 1);
    await app.close();
  });

  it("7. complete snapshot missing lesson cancels event", async () => {
    const { app, config, dbPath: path } = await createTestApp();
    dbPath = path;
    const feed = await setupFeed(app, config);
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

    const event = app.db.prepare("SELECT status, active FROM events").get() as {
      status: string;
      active: number;
    };
    assert.equal(event.status, "cancelled");
    assert.equal(event.active, 0);
    await app.close();
  });

  it("8. incomplete coverage does not delete events", async () => {
    const { app, config, dbPath: path } = await createTestApp();
    dbPath = path;
    const feed = await setupFeed(app, config);
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
    const count = app.db
      .prepare("SELECT COUNT(*) AS count FROM events WHERE active = 1")
      .get() as {
      count: number;
    };
    assert.equal(count.count, 1);
    await app.close();
  });

  it("9. restored cancelled lesson keeps same UID", async () => {
    const { app, config, dbPath: path } = await createTestApp();
    dbPath = path;
    const feed = await setupFeed(app, config);
    await sync(app, feed.uploadToken, baseSyncPayload());

    await sync(
      app,
      feed.uploadToken,
      baseSyncPayload({ lessons: [], allowEmptySnapshot: true }),
    );

    const before = app.db.prepare("SELECT ical_uid FROM events").get() as {
      ical_uid: string;
    };
    await sync(app, feed.uploadToken, baseSyncPayload());
    const after = app.db
      .prepare("SELECT ical_uid, status, active FROM events")
      .get() as {
      ical_uid: string;
      status: string;
      active: number;
    };

    assert.equal(after.ical_uid, before.ical_uid);
    assert.equal(after.status, "confirmed");
    assert.equal(after.active, 1);
    await app.close();
  });

  it("10. different sourceKey same naturalKey does not duplicate", async () => {
    const { app, config, dbPath: path } = await createTestApp();
    dbPath = path;
    const feed = await setupFeed(app, config);
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

    const count = app.db
      .prepare("SELECT COUNT(*) AS count FROM events")
      .get() as { count: number };
    assert.equal(count.count, 1);
    await app.close();
  });

  it("11. duplicate conflict rolls back entire transaction", async () => {
    const { app, config, dbPath: path } = await createTestApp();
    dbPath = path;
    const feed = await setupFeed(app, config);
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

    const event = app.db.prepare("SELECT teacher FROM events").get() as {
      teacher: string;
    };
    assert.equal(event.teacher, "Mr Example");

    const syncRuns = app.db
      .prepare("SELECT COUNT(*) AS count FROM sync_runs WHERE status = ?")
      .get("success") as {
      count: number;
    };
    assert.equal(syncRuns.count, 1);
    await app.close();
  });

  it("15. failed sync leaves database unchanged", async () => {
    const { app, config, dbPath: path } = await createTestApp();
    dbPath = path;
    const feed = await setupFeed(app, config);
    await sync(app, feed.uploadToken, baseSyncPayload());

    const before = app.db
      .prepare("SELECT teacher, sequence FROM events")
      .get() as {
      teacher: string;
      sequence: number;
    };

    const response = await sync(
      app,
      feed.uploadToken,
      baseSyncPayload({
        schoolHost: "wrong-school.edu.au",
      }),
    );
    assert.equal(response.statusCode, 409);

    const after = app.db
      .prepare("SELECT teacher, sequence FROM events")
      .get() as {
      teacher: string;
      sequence: number;
    };
    assert.deepEqual(after, before);
    await app.close();
  });
});
