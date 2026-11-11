import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coerce, normalizeEvent } from './event.js';

const now = new Date('2026-11-11T10:00:00Z');

test('requires an event name', () => {
    assert.match(normalizeEvent({}, now).error, /event/);
    assert.match(normalizeEvent([], now).error, /object/);
});

test('maps path/status to a snake_case outcome', () => {
    assert.equal(normalizeEvent({ event: 'x', path: 'No Response' }, now).doc.outcome, 'no_response');
    assert.equal(normalizeEvent({ event: 'x', status: 'SUCCESS' }, now).doc.outcome, 'success');
});

test('keeps unknown fields under data and coerces flow strings', () => {
    const { doc } = normalizeEvent({ event: 'lead', score: '42', paid: 'true', city: 'Kochi', data: { amount: '1999.50' } }, now);
    assert.deepEqual(doc.data, { score: 42, paid: true, city: 'Kochi', amount: 1999.5 });
});

test('leaves phone numbers and leading-zero ids as text', () => {
    assert.equal(coerce('+919876543210'), '+919876543210');
    assert.equal(coerce('00123'), '00123');
});

test('parses occurred_at from ISO or unix time, else uses now', () => {
    assert.equal(normalizeEvent({ event: 'x', occurred_at: '2026-11-01T00:00:00Z' }, now).doc.occurred_at.toISOString(), '2026-11-01T00:00:00.000Z');
    assert.equal(normalizeEvent({ event: 'x', occurred_at: '1793491200' }, now).doc.occurred_at.toISOString(), '2026-11-01T00:00:00.000Z');
    assert.equal(normalizeEvent({ event: 'x', occurred_at: 'soon' }, now).doc.occurred_at, now);
});

test('builds the contact from phone/name and drops empty fields', () => {
    const { doc } = normalizeEvent({ event: 'x', phone: '+91 98', name: '' }, now);
    assert.deepEqual(doc.contact, { phone: '+91 98' });
    assert.equal('worker' in doc, false);
});
