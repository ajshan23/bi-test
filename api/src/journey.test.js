import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeJourneyEvent, journeyUpdate, teamFor } from './journey.js';

const now = new Date('2026-11-11T10:00:00Z');

test('requires phone and a known event', () => {
    assert.match(normalizeJourneyEvent({ event: 'handed_over' }, now).error, /phone/);
    assert.match(normalizeJourneyEvent({ phone: '{{tg.phone}}', event: 'handed_over' }, now).error, /phone/);
    assert.match(normalizeJourneyEvent({ phone: '973', event: 'lol' }, now).error, /event/);
});

test('maps the business type to the salesperson team', () => {
    assert.equal(teamFor('Hotel'), 'HoReCa');
    assert.equal(teamFor('Restaurant / Café'), 'HoReCa');
    assert.equal(teamFor('Airline / Catering'), 'HoReCa');
    assert.equal(teamFor('Supermarket / Grocery'), 'Retail');
    assert.equal(teamFor('Other business'), 'Retail');
    const { doc } = normalizeJourneyEvent({ phone: '+97333000000', event: 'handed_over', category: 'Hotel', needs: '{{wtn_2.response.message}}' }, now);
    assert.equal(doc.phone, '97333000000');
    assert.equal(doc.team, 'HoReCa');
    assert.equal('needs' in doc, false);
});

test('an explicit team from the sales flow wins', () => {
    assert.equal(normalizeJourneyEvent({ phone: '1', event: 'customer_replied', team: 'Retail', category: 'Hotel' }, now).doc.team, 'Retail');
});

test('dropped events keep a slugged question name', () => {
    assert.equal(normalizeJourneyEvent({ phone: '1', event: 'dropped', dropped_at: 'Product needs' }, now).doc.dropped_at, 'product_needs');
});

test('the update only moves the stage forward and quotes values', () => {
    const { doc } = normalizeJourneyEvent({ phone: '1', event: 'customer_replied', business: '$where 1', flow: 'Sales HoReCa' }, now);
    const [{ $set: set }] = journeyUpdate(doc);
    assert.deepEqual(set.stage, { $cond: [{ $gt: [6, { $ifNull: ['$stage_rank', 0] }] }, 'waiting_for_salesperson', '$stage'] });
    assert.deepEqual(set.business, { $literal: '$where 1' });
    assert.deepEqual(set.customer_replied_at, { $ifNull: ['$customer_replied_at', now] });
});

test('agent_replied computes the salesperson reply time', () => {
    const { doc } = normalizeJourneyEvent({ phone: '1', event: 'agent_replied' }, now);
    assert.ok(journeyUpdate(doc)[0].$set.salesperson_reply_minutes);
    const { doc: other } = normalizeJourneyEvent({ phone: '1', event: 'customer_replied' }, now);
    assert.equal('salesperson_reply_minutes' in journeyUpdate(other)[0].$set, false);
});
