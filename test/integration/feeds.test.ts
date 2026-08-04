import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTestApp } from "../helpers/test-app.js";
import { createCalendarService } from "../../src/cli/db.js";

describe("feeds and auth", () => {
  it("creates calendar with upload and calendar tokens", async () => {
    const { app, config, db } = await createTestApp();

    const first = await createCalendarService(db.cli, config).createCalendar({
        name: "Test Feed",
        schoolHost: "learn.masada.onseqtacloud.com",
        studentRef: "4284",
        timezone: "Australia/Sydney",
      });

    assert.match(first.uploadToken, /^scu_/);
    assert.match(first.calendarToken, /^scc_/);

    await app.close();
  });

  it("rejects invalid upload token with 401", async () => {
    const { app } = await createTestApp();

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/status",
      headers: { authorization: "Bearer scu_invalid" },
    });

    assert.equal(response.statusCode, 401);
    await app.close();
  });

  it("returns status whitelist fields only", async () => {
    const { app, config, db } = await createTestApp();

    const created = await createCalendarService(db.cli, config).createCalendar({
        name: "Leo SEQTA Timetable",
        schoolHost: "learn.masada.onseqtacloud.com",
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
    const { app, config, db } = await createTestApp();

    const created = await createCalendarService(db.cli, config).createCalendar({
        name: "Rotate Feed",
        schoolHost: "learn.masada.onseqtacloud.com",
        studentRef: "9999",
        timezone: "Australia/Sydney",
      });

    const oldToken = created.uploadToken;

    await (async (client) => {
      await client.exec(
        `UPDATE devices SET status = 'revoked', revoked_at = now() WHERE calendar_id = $1`,
        [created.calendar.id],
      );
    })(db.admin);

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/status",
      headers: { authorization: `Bearer ${oldToken}` },
    });
    assert.equal(response.statusCode, 401);

    await app.close();
  });
});
