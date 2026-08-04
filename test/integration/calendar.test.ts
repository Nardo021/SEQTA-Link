import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTestApp, baseSyncPayload } from "../helpers/test-app.js";
import { createCalendarService } from "../../src/cli/db.js";
import { randomUUID } from "node:crypto";

describe("calendar integration", () => {
  it("12. invalid calendar token returns 404", async () => {
    const { app } = await createTestApp();

    const response = await app.inject({
      method: "GET",
      url: "/calendar/scc_invalidtokenvaluexxxxxxxxxxxxxxxxxxxxxxxxx.ics",
    });
    assert.equal(response.statusCode, 404);
    await app.close();
  });

  it("13. matching ETag returns 304", async () => {
    const { app, config, db } = await createTestApp();

    const feed = await createCalendarService(db.cli, config).createCalendar({
        name: "Calendar Feed",
        schoolHost: "learn.masada.onseqtacloud.com",
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
      payload: baseSyncPayload({
        schoolHost: "learn.masada.onseqtacloud.com",
        studentRef: "7777",
      }),
    });

    const first = await app.inject({
      method: "GET",
      url: `/calendar/${feed.calendarToken}.ics`,
    });
    assert.equal(first.statusCode, 200);
    const etag = first.headers.etag;
    assert.ok(etag);

    const second = await app.inject({
      method: "GET",
      url: `/calendar/${feed.calendarToken}.ics`,
      headers: { "if-none-match": String(etag) },
    });
    assert.equal(second.statusCode, 304);

    await app.close();
  });

  it("14. content change updates ETag but preserves UID", async () => {
    const { app, config, db } = await createTestApp();

    const feed = await createCalendarService(db.cli, config).createCalendar({
        name: "UID Feed",
        schoolHost: "learn.masada.onseqtacloud.com",
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
      payload: baseSyncPayload({
        schoolHost: "learn.masada.onseqtacloud.com",
        studentRef: "8888",
      }),
    });

    const first = await app.inject({
      method: "GET",
      url: `/calendar/${feed.calendarToken}.ics`,
    });
    const firstBody = String(first.body);
    const uidMatch = firstBody.match(/UID:[^\r\n]+/);
    assert.ok(uidMatch);
    const firstEtag = first.headers.etag;

    await app.inject({
      method: "POST",
      url: "/api/v1/sync",
      headers: {
        authorization: `Bearer ${feed.uploadToken}`,
        "idempotency-key": randomUUID(),
      },
      payload: baseSyncPayload({
        schoolHost: "learn.masada.onseqtacloud.com",
        studentRef: "8888",
        lessons: [
          {
            ...baseSyncPayload().lessons[0],
            teacher: "Ms Updated",
          },
        ],
      }),
    });

    const second = await app.inject({
      method: "GET",
      url: `/calendar/${feed.calendarToken}.ics`,
    });
    assert.notEqual(second.headers.etag, firstEtag);
    assert.match(String(second.body), /UID:[^\r\n]+/);
    assert.ok(String(second.body).includes(uidMatch[0]!));

    await app.close();
  });
});
