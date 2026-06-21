/**
 * Unit tests for the mailbox fan-out core (the logic every Gmail-by-id lookup
 * now depends on). Run: npx tsx --test test/mailbox-fallback.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { orderMailboxes, runMailboxFallback, MailboxAccountLike } from '../lib/mailbox-fallback';

const acct = (email: string): MailboxAccountLike => ({ email, tokens: { access_token: 'a-' + email } });

test('orderMailboxes puts the owner-hint mailbox first', () => {
  const accts = [acct('a@x.com'), acct('b@x.com'), acct('c@x.com')];
  const ordered = orderMailboxes(accts, 'b@x.com');
  assert.equal(ordered[0].email, 'b@x.com');
  assert.equal(ordered.length, 3);
});

test('orderMailboxes is case-insensitive on the hint', () => {
  const ordered = orderMailboxes([acct('a@x.com'), acct('Owner@X.com')], 'owner@x.com');
  assert.equal(ordered[0].email, 'Owner@X.com');
});

test('orderMailboxes preserves order when no hint / no match', () => {
  const accts = [acct('a@x.com'), acct('b@x.com')];
  assert.deepEqual(orderMailboxes(accts).map(a => a.email), ['a@x.com', 'b@x.com']);
  assert.deepEqual(orderMailboxes(accts, 'nope@x.com').map(a => a.email), ['a@x.com', 'b@x.com']);
});

test('orderMailboxes does not mutate the input array', () => {
  const accts = [acct('a@x.com'), acct('b@x.com')];
  orderMailboxes(accts, 'b@x.com');
  assert.equal(accts[0].email, 'a@x.com'); // original untouched
});

test('runMailboxFallback returns the first truthy result + which account', async () => {
  const accts = [acct('a@x.com'), acct('b@x.com')];
  const tried: string[] = [];
  const r = await runMailboxFallback(accts, async (_t, email) => {
    tried.push(email);
    return email === 'a@x.com' ? { ok: true } : null;
  });
  assert.deepEqual(r.result, { ok: true });
  assert.equal(r.accountEmail, 'a@x.com');
  assert.equal(r.candidateCount, 2);
  assert.deepEqual(tried, ['a@x.com']); // stopped at first hit
});

test('runMailboxFallback keeps trying when an account returns null (per-mailbox 404)', async () => {
  const accts = [acct('a@x.com'), acct('b@x.com'), acct('c@x.com')];
  const tried: string[] = [];
  const r = await runMailboxFallback(accts, async (_t, email) => {
    tried.push(email);
    return email === 'c@x.com' ? 'FOUND' : null;
  });
  assert.equal(r.result, 'FOUND');
  assert.equal(r.accountEmail, 'c@x.com');
  assert.deepEqual(tried, ['a@x.com', 'b@x.com', 'c@x.com']);
});

test('runMailboxFallback swallows a thrown account error and continues', async () => {
  const accts = [acct('bad@x.com'), acct('good@x.com')];
  const r = await runMailboxFallback(accts, async (_t, email) => {
    if (email === 'bad@x.com') throw new Error('expired token');
    return 'OK';
  });
  assert.equal(r.result, 'OK');
  assert.equal(r.accountEmail, 'good@x.com');
});

test('runMailboxFallback returns null result when nothing matches', async () => {
  const accts = [acct('a@x.com'), acct('b@x.com')];
  const r = await runMailboxFallback(accts, async () => null);
  assert.equal(r.result, null);
  assert.equal(r.accountEmail, null);
  assert.equal(r.candidateCount, 2);
});

test('runMailboxFallback signals candidateCount=0 when there are no mailboxes (→ caller can 401)', async () => {
  const r = await runMailboxFallback([], async () => 'never');
  assert.equal(r.result, null);
  assert.equal(r.candidateCount, 0);
});
