import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { createTestApp, cleanupTempDb } from "../helpers/test-app.js";
import { createFeedService } from "../../src/cli/db.js";

describe("feeds and auth", () => {
  let dbPath = "";

  after(async () => {
    if (dbPath) {
      cleanupTempDb(dbPath);
    }
  });

  it("creates feed with unique school/student constraint", async () => {
    const { app, config, dbPath: path } = await createTestApp();
    dbPath = path;

    const feedService = createFeedService(app.db, config);
    const first = feedService.createFeed({
      name: "Test Feed",
      schoolHost: "learn.example-school.edu.au",
      studentRef: "4284",
      timezone: "Australia/Sydney",
    });

    assert.match(first.uploadToken, /^scu_/);
    assert.match(first.calendarToken, /^scc_/);

    assert.throws(
      () =>
        feedService.createFeed({
          name: "Duplicate",
          schoolHost: "learn.example-school.edu.au",
          studentRef: "4284",
          timezone: "Australia/Sydney",
        }),
      (error: unknown) =>
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code: string }).code === "INVALID_REQUEST",
    );

    await app.close();
  });

  it("rejects invalid upload token with 401", async () => {
    const { app, dbPath: path } = await createTestApp();
    dbPath = path;

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/status",
      headers: { authorization: "Bearer scu_invalid" },
    });

    assert.equal(response.statusCode, 401);
    await app.close();
  });

  it("returns status whitelist fields only", async () => {
    const { app, config, dbPath: path } = await createTestApp();
    dbPath = path;

    const feedService = createFeedService(app.db, config);
    const created = feedService.createFeed({
      name: "Leo SEQTA Timetable",
      schoolHost: "learn.example-school.edu.au",
      studentRef: "4284",
      timezone: "Australia/Sydney",
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/status",
      headers: { authorization: `Bearer ${created.uploadToken}` },
    });

    assert.equal(response.statusCode, 200);
    const body = response.json() as Record<string, unknown>;
    assert.ok(body.feed);
    assert.ok(body.sync);
    assert.ok(body.events);
    assert.equal(JSON.stringify(body).includes("scu_"), false);
    assert.equal(JSON.stringify(body).includes("scc_"), false);

    await app.close();
  });

  it("invalidates old token after rotation", async () => {
    const { app, config, dbPath: path } = await createTestApp();
    dbPath = path;

    const feedService = createFeedService(app.db, config);
    const created = feedService.createFeed({
      name: "Rotate Feed",
      schoolHost: "learn.example-school.edu.au",
      studentRef: "9999",
      timezone: "Australia/Sydney",
    });

    const oldToken = created.uploadToken;
    feedService.rotateToken(created.feed.id, "upload");

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/status",
      headers: { authorization: `Bearer ${oldToken}` },
    });
    assert.equal(response.statusCode, 401);

    await app.close();
  });
});
