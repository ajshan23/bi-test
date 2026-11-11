import express from 'express';
import { timingSafeEqual } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { MAX_BATCH, normalizeEvent } from './event.js';
import { normalizeLead } from './lead.js';
import { EVENTS, journeyUpdate, normalizeJourneyEvent } from './journey.js';

const { PORT = 4000, MONGO_URL, API_KEY } = process.env;
if (!MONGO_URL || !API_KEY) {
    console.error('MONGO_URL and API_KEY are required.');
    process.exit(1);
}

const client = new MongoClient(MONGO_URL);
await client.connect();
const events = client.db().collection('events');
const leads = client.db().collection('leads');
const journeys = client.db().collection('journeys');
const journeyEvents = client.db().collection('journey_events');
// Idempotent; also creates the collections so Metabase can see them.
await Promise.all([
    leads.createIndex({ occurred_at: -1 }),
    leads.createIndex({ stage: 1, occurred_at: -1 }),
    leads.createIndex({ phone: 1, occurred_at: -1 }),
    journeys.createIndex({ phone: 1, started_at: -1 }),
    journeys.createIndex({ stage: 1, started_at: -1 }),
    journeys.createIndex({ started_at: -1 }),
    journeyEvents.createIndex({ received_at: -1 }),
    journeyEvents.createIndex({ phone: 1, occurred_at: -1 }),
]);

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);
app.use(express.json({ limit: '256kb' }));

const keyBuffer = Buffer.from(API_KEY);
function requireKey(req, res, next) {
    const given = req.get('x-api-key') || req.get('authorization')?.replace(/^Bearer\s+/i, '') || '';
    const buf = Buffer.from(given);
    if (buf.length === keyBuffer.length && timingSafeEqual(buf, keyBuffer)) return next();
    res.status(401).json({ ok: false, error: 'Missing or wrong API key (send it in the x-api-key header).' });
}

const router = express.Router();

router.get('/health', async (_req, res) => {
    try {
        await client.db().command({ ping: 1 });
        res.json({ ok: true });
    } catch {
        res.status(503).json({ ok: false });
    }
});

// One event object, or an array of up to MAX_BATCH.
router.post('/events', requireKey, async (req, res) => {
    const items = Array.isArray(req.body) ? req.body : [req.body];
    if (!items.length) return res.status(400).json({ ok: false, error: 'No events in the body.' });
    if (items.length > MAX_BATCH) return res.status(400).json({ ok: false, error: `Send at most ${MAX_BATCH} events per request.` });
    const now = new Date();
    const results = items.map((item) => normalizeEvent(item, now));
    const errors = results.map((r, index) => r.error && { index, error: r.error }).filter(Boolean);
    if (errors.length) return res.status(400).json({ ok: false, errors });
    const docs = results.map((r) => r.doc);
    const { insertedIds } = await events.insertMany(docs);
    res.status(201).json({ ok: true, count: docs.length, ids: Object.values(insertedIds) });
});

// Latest events, for a quick check without opening Metabase.
router.get('/events', requireKey, async (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 200);
    const filter = {};
    for (const key of ['event', 'outcome', 'worker']) if (req.query[key]) filter[key] = String(req.query[key]);
    const docs = await events.find(filter).sort({ occurred_at: -1 }).limit(limit).toArray();
    res.json({ ok: true, count: docs.length, events: docs });
});

// One lead per conversation from the qualification flow.
router.post('/leads', requireKey, async (req, res) => {
    const { doc, error } = normalizeLead(req.body);
    if (error) return res.status(400).json({ ok: false, error });
    const { insertedId } = await leads.insertOne(doc);
    res.status(201).json({ ok: true, id: insertedId, stage: doc.stage });
});

router.get('/leads', requireKey, async (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 200);
    const filter = {};
    for (const key of ['stage', 'area', 'business_type', 'phone']) if (req.query[key]) filter[key] = String(req.query[key]);
    const docs = await leads.find(filter).sort({ occurred_at: -1 }).limit(limit).toArray();
    res.json({ ok: true, count: docs.length, leads: docs });
});

// One step of a lead's journey (intake flow → salesperson flow). See journey.js.
router.post('/journey', requireKey, async (req, res) => {
    const { doc, error } = normalizeJourneyEvent(req.body);
    if (error) return res.status(400).json({ ok: false, error });
    await journeyEvents.insertOne(doc);
    const update = journeyUpdate(doc);
    const journey = doc.event === 'intake_started'
        ? await journeys.insertOne({}).then(({ insertedId }) => journeys.findOneAndUpdate({ _id: insertedId }, update, { returnDocument: 'after' }))
        : await journeys.findOneAndUpdate({ phone: doc.phone }, update, { sort: { started_at: -1 }, upsert: true, returnDocument: 'after' });
    res.status(201).json({ ok: true, journey: journey?._id, stage: journey?.stage });
});

router.get('/journeys', requireKey, async (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 200);
    const filter = {};
    for (const key of ['stage', 'team', 'phone']) if (req.query[key]) filter[key] = String(req.query[key]).replace(/^\+/, '');
    const docs = await journeys.find(filter).sort({ started_at: -1 }).limit(limit).toArray();
    res.json({ ok: true, count: docs.length, events: Object.keys(EVENTS), journeys: docs });
});

app.use('/api/flowflex', router);
app.use((_req, res) => res.status(404).json({ ok: false, error: 'Not found' }));
// Bad JSON from a flow gets a clear 400 instead of an HTML stack trace.
app.use((err, _req, res, _next) => {
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ ok: false, error: 'Body is not valid JSON.' });
    if (err?.type === 'entity.too.large') return res.status(413).json({ ok: false, error: 'Body is too large.' });
    console.error(err);
    res.status(500).json({ ok: false, error: 'Server error' });
});

const server = app.listen(PORT, () => console.log(`Operium Insights API on :${PORT}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => client.close().then(() => process.exit(0))));
