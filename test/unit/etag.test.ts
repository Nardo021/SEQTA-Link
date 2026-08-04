import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { etagMatches } from '../../src/modules/calendars/etag.js';

describe('etagMatches', () => {
  const etag = '"calendar-3"';

  it('matches strong and weak forms', () => {
    assert.equal(etagMatches(etag, etag), true);
    assert.equal(etagMatches(`W/${etag}`, etag), true);
    assert.equal(etagMatches(`"${etag}", ${etag}`, etag), true);
  });

  it('matches lists used by some calendar clients', () => {
    assert.equal(etagMatches(`W/"other", ${etag}`, etag), true);
    assert.equal(etagMatches('"other"', etag), false);
  });

  it('treats * as match', () => {
    assert.equal(etagMatches('*', etag), true);
  });
});
