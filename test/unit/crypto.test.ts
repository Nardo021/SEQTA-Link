import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { hashToken, generateRawToken, generateIcalUid, detectTokenType } from '../../src/shared/crypto.js';

const pepper = Buffer.alloc(32, 1);
const uidSecret = Buffer.alloc(32, 2);

describe('crypto', () => {
  it('generates stable token hashes', () => {
    const token = 'scu_test-token-value';
    const first = hashToken(pepper, 'upload', token);
    const second = hashToken(pepper, 'upload', token);
    assert.equal(first, second);
    assert.notEqual(first, hashToken(pepper, 'calendar', token));
  });

  it('generates prefixed tokens', () => {
    const upload = generateRawToken('upload');
    const calendar = generateRawToken('calendar');
    assert.match(upload, /^scu_/);
    assert.match(calendar, /^scc_/);
    assert.equal(detectTokenType(upload), 'upload');
    assert.equal(detectTokenType(calendar), 'calendar');
  });

  it('generates stable ical UIDs', () => {
    const uid = generateIcalUid(uidSecret, 'feed-id', 'event-id');
    assert.match(uid, /@timetable\.leoze\.top$/);
    assert.equal(uid, generateIcalUid(uidSecret, 'feed-id', 'event-id'));
  });
});
