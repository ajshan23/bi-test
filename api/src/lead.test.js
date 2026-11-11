import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLead } from './lead.js';

const now = new Date('2026-11-11T10:00:00Z');

test('requires a phone number', () => {
    assert.match(normalizeLead({ name: 'A' }, now).error, /phone/);
    assert.match(normalizeLead({ phone: '{{tg.from}}' }, now).error, /phone/);
});

test('a completed lead keeps every answer', () => {
    const { doc } = normalizeLead({ phone: '97333000000', name: 'Ali', business: 'Gulf Hotel', needs: 'Frozen food weekly', area: 'Manama', business_type: 'Hotel', stage: 'completed', source: 'Prime FMCG intake' }, now);
    assert.equal(doc.stage, 'completed');
    assert.equal(doc.business_type, 'Hotel');
    assert.equal('dropped_at' in doc, false);
});

test('a dropped lead records the unanswered step and drops unresolved variables', () => {
    const { doc } = normalizeLead({ phone: '973', business: 'Cafe 1', needs: '{{wtn_2.response.message}}', area: '', stage: 'dropped', dropped_at: 'Product needs' }, now);
    assert.equal(doc.stage, 'dropped');
    assert.equal(doc.dropped_at, 'product_needs');
    assert.equal('needs' in doc, false);
    assert.equal('area' in doc, false);
});

test('rejects an unknown stage and defaults a missing one to completed', () => {
    assert.match(normalizeLead({ phone: '1', stage: 'maybe' }, now).error, /stage/);
    assert.equal(normalizeLead({ phone: '1' }, now).doc.stage, 'completed');
});

test('keeps extra fields under extra', () => {
    assert.deepEqual(normalizeLead({ phone: '1', quantity: '20 cartons', empty: '' }, now).doc.extra, { quantity: '20 cartons' });
});
