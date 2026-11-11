// Configures a fresh Metabase over its REST API:
//   1. creates the first admin (or signs in if that's done)
//   2. connects the "insights" Mongo database with the read-only user
//   3. builds the "Flow events" dashboard
//   4. optionally gives the dashboard a public, view-only link
// Re-running is safe: anything that already exists (matched by name) is kept.

const {
    METABASE_URL = 'http://localhost:3030',
    MB_ADMIN_EMAIL,
    MB_ADMIN_PASSWORD,
    MB_SITE_NAME = 'Operium Insights',
    MONGO_HOST = 'mongo',
    MONGO_PORT = '27017',
    MONGO_METABASE_PASSWORD,
    PUBLIC_DASHBOARD = 'true',
} = process.env;

const DB_NAME = 'Flow events';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let session = null;

async function api(method, path, body) {
    const res = await fetch(`${METABASE_URL}/api${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', ...(session ? { 'X-Metabase-Session': session } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : null;
}

async function waitForMetabase() {
    for (let i = 0; i < 120; i++) {
        try {
            const res = await fetch(`${METABASE_URL}/api/health`);
            if (res.ok && (await res.json()).status === 'ok') return;
        } catch { /* not up yet */ }
        await sleep(5000);
    }
    throw new Error('Metabase did not become healthy in 10 minutes.');
}

async function signIn() {
    const props = await api('GET', '/session/properties');
    if (!props['has-user-setup']) {
        console.log('Creating the Metabase admin…');
        const res = await api('POST', '/setup', {
            token: props['setup-token'],
            user: { email: MB_ADMIN_EMAIL, password: MB_ADMIN_PASSWORD, first_name: 'Operium', last_name: 'Admin', site_name: MB_SITE_NAME },
            prefs: { site_name: MB_SITE_NAME, site_locale: 'en', allow_tracking: false },
        });
        session = res.id;
    } else {
        session = (await api('POST', '/session', { username: MB_ADMIN_EMAIL, password: MB_ADMIN_PASSWORD })).id;
    }
}

async function ensureDatabase() {
    const list = await api('GET', '/database');
    const existing = (list.data ?? list).find((d) => d.name === DB_NAME);
    if (existing) return existing.id;
    console.log('Connecting MongoDB (read-only user)…');
    const db = await api('POST', '/database', {
        engine: 'mongo',
        name: DB_NAME,
        details: {
            'use-conn-uri': false,
            host: MONGO_HOST,
            port: Number(MONGO_PORT),
            dbname: 'insights',
            user: 'metabase',
            pass: MONGO_METABASE_PASSWORD,
            authdb: 'insights',
            ssl: false,
        },
        is_full_sync: true,
    });
    await api('POST', `/database/${db.id}/sync_schema`);
    return db.id;
}

// Mongo aggregation pipelines behind each card (native Metabase questions).
const pipe = (stages) => JSON.stringify(stages, null, 2);
const day = { $dateTrunc: { date: '$occurred_at', unit: 'day' } };
const FLOW_EVENT_CARDS = [
    {
        name: 'Total events', display: 'scalar', size: [6, 3],
        query: pipe([{ $count: 'events' }]),
    },
    {
        name: 'Success', display: 'scalar', size: [6, 3],
        query: pipe([{ $match: { outcome: 'success' } }, { $count: 'success' }]),
    },
    {
        name: 'No response', display: 'scalar', size: [6, 3],
        query: pipe([{ $match: { outcome: 'no_response' } }, { $count: 'no_response' }]),
    },
    {
        name: 'No-response rate', display: 'scalar', size: [6, 3],
        query: pipe([
            { $group: { _id: null, total: { $sum: 1 }, nr: { $sum: { $cond: [{ $eq: ['$outcome', 'no_response'] }, 1, 0] } } } },
            { $project: { _id: 0, rate: { $cond: [{ $eq: ['$total', 0] }, 0, { $divide: ['$nr', '$total'] }] } } },
        ]),
        viz: { column_settings: { '["name","rate"]': { number_style: 'percent', decimals: 1 } } },
    },
    {
        name: 'Events per day by outcome', display: 'bar', size: [16, 7],
        query: pipe([
            { $group: { _id: { day, outcome: { $ifNull: ['$outcome', 'unknown'] } }, count: { $sum: 1 } } },
            { $project: { _id: 0, day: '$_id.day', outcome: '$_id.outcome', count: 1 } },
            { $sort: { day: 1 } },
        ]),
        viz: { 'graph.dimensions': ['day', 'outcome'], 'graph.metrics': ['count'], 'stackable.stack_type': 'stacked', 'graph.x_axis.title_text': 'Day', 'graph.y_axis.title_text': 'Events' },
    },
    {
        name: 'Outcome split', display: 'pie', size: [8, 7],
        query: pipe([
            { $group: { _id: { $ifNull: ['$outcome', 'unknown'] }, count: { $sum: 1 } } },
            { $project: { _id: 0, outcome: '$_id', count: 1 } },
            { $sort: { count: -1 } },
        ]),
        viz: { 'pie.dimension': 'outcome', 'pie.metric': 'count' },
    },
    {
        name: 'Events by worker', display: 'row', size: [12, 7],
        query: pipe([
            { $group: { _id: { worker: { $ifNull: ['$worker', 'Not set'] }, outcome: { $ifNull: ['$outcome', 'unknown'] } }, count: { $sum: 1 } } },
            { $project: { _id: 0, worker: '$_id.worker', outcome: '$_id.outcome', count: 1 } },
            { $sort: { count: -1 } },
        ]),
        viz: { 'graph.dimensions': ['worker', 'outcome'], 'graph.metrics': ['count'], 'stackable.stack_type': 'stacked' },
    },
    {
        name: 'Events by type', display: 'row', size: [12, 7],
        query: pipe([
            { $group: { _id: '$event', count: { $sum: 1 } } },
            { $project: { _id: 0, event: '$_id', count: 1 } },
            { $sort: { count: -1 } },
        ]),
        viz: { 'graph.dimensions': ['event'], 'graph.metrics': ['count'] },
    },
    {
        name: 'Latest events', display: 'table', size: [24, 8],
        query: pipe([
            { $sort: { occurred_at: -1 } },
            { $limit: 100 },
            { $project: { _id: 0, occurred_at: 1, event: 1, outcome: 1, worker: 1, flow: 1, name: '$contact.name', phone: '$contact.phone' } },
        ]),
    },
];

// Incoming leads: one document per WhatsApp conversation in the "leads" collection.
const leadDay = { $dateTrunc: { date: '$occurred_at', unit: 'day' } };
const LEAD_CARDS = [
    { name: 'Total leads', display: 'scalar', size: [6, 3], query: pipe([{ $count: 'leads' }]) },
    { name: 'Completed', display: 'scalar', size: [6, 3], query: pipe([{ $match: { stage: 'completed' } }, { $count: 'completed' }]) },
    { name: 'Dropped', display: 'scalar', size: [6, 3], query: pipe([{ $match: { stage: 'dropped' } }, { $count: 'dropped' }]) },
    {
        name: 'Completion rate', display: 'scalar', size: [6, 3],
        query: pipe([
            { $group: { _id: null, total: { $sum: 1 }, done: { $sum: { $cond: [{ $eq: ['$stage', 'completed'] }, 1, 0] } } } },
            { $project: { _id: 0, rate: { $cond: [{ $eq: ['$total', 0] }, 0, { $divide: ['$done', '$total'] }] } } },
        ]),
        viz: { column_settings: { '["name","rate"]': { number_style: 'percent', decimals: 1 } } },
    },
    {
        name: 'Leads per day', display: 'bar', size: [16, 7],
        query: pipe([
            { $group: { _id: { day: leadDay, stage: '$stage' }, leads: { $sum: 1 } } },
            { $project: { _id: 0, day: '$_id.day', stage: '$_id.stage', leads: 1 } },
            { $sort: { day: 1 } },
        ]),
        viz: { 'graph.dimensions': ['day', 'stage'], 'graph.metrics': ['leads'], 'stackable.stack_type': 'stacked', 'graph.x_axis.title_text': 'Day', 'graph.y_axis.title_text': 'Leads' },
    },
    {
        name: 'Where leads drop off', display: 'row', size: [8, 7],
        query: pipe([
            { $match: { stage: 'dropped' } },
            { $group: { _id: '$dropped_at', leads: { $sum: 1 } } },
            { $project: { _id: 0, question: { $switch: { branches: [
                { case: { $eq: ['$_id', 'business_name'] }, then: 'Business name' },
                { case: { $eq: ['$_id', 'product_needs'] }, then: 'Product needs' },
            ], default: '$_id' } }, leads: 1 } },
            { $sort: { leads: -1 } },
        ]),
        viz: { 'graph.dimensions': ['question'], 'graph.metrics': ['leads'] },
    },
    {
        name: 'Leads by business type', display: 'pie', size: [8, 7],
        query: pipe([
            { $match: { stage: 'completed' } },
            { $group: { _id: { $ifNull: ['$business_type', 'Not given'] }, leads: { $sum: 1 } } },
            { $project: { _id: 0, business_type: '$_id', leads: 1 } },
            { $sort: { leads: -1 } },
        ]),
        viz: { 'pie.dimension': 'business_type', 'pie.metric': 'leads' },
    },
    {
        name: 'Leads by area and business type', display: 'bar', size: [16, 7],
        query: pipe([
            { $match: { stage: 'completed' } },
            { $group: { _id: { area: { $ifNull: ['$area', 'Not given'] }, business_type: { $ifNull: ['$business_type', 'Not given'] } }, leads: { $sum: 1 } } },
            { $project: { _id: 0, area: '$_id.area', business_type: '$_id.business_type', leads: 1 } },
            { $sort: { area: 1 } },
        ]),
        viz: { 'graph.dimensions': ['area', 'business_type'], 'graph.metrics': ['leads'], 'stackable.stack_type': 'stacked' },
    },
    {
        name: 'Latest leads', display: 'table', size: [24, 9],
        query: pipe([
            { $sort: { occurred_at: -1 } },
            { $limit: 200 },
            { $project: { _id: 0, received: '$occurred_at', name: 1, phone: 1, business: 1, business_type: 1, area: 1, needs: 1, stage: 1, dropped_at: 1 } },
        ]),
    },
];

// Lead journey: one document per lead in "journeys", built by POST /api/flowflex/journey
// from the main intake flow and the two salesperson flows.
const has = (field) => ({ $cond: [{ $ifNull: [`$${field}`, false] }, 1, 0] });
const minutesSince = (field) => ({ $divide: [{ $subtract: ['$$NOW', `$${field}`] }, 60000] });
// Where each journey currently stands, in plain words. An intake that hasn't moved for an
// hour stopped at one of the list questions (they have no "no reply" exit in the flow).
const outcome = {
    $switch: {
        branches: [
            { case: { $and: [{ $eq: ['$stage', 'dropped'] }, { $eq: ['$dropped_at', 'business_name'] }] }, then: 'Dropped at business name' },
            { case: { $and: [{ $eq: ['$stage', 'dropped'] }, { $eq: ['$dropped_at', 'product_needs'] }] }, then: 'Dropped at product needs' },
            { case: { $eq: ['$stage', 'dropped'] }, then: 'Dropped in intake' },
            { case: { $and: [{ $eq: ['$stage', 'in_intake'] }, { $gt: [minutesSince('started_at'), 60] }] }, then: 'Stopped at area / business type' },
            { case: { $eq: ['$stage', 'in_intake'] }, then: 'Answering intake now' },
            { case: { $eq: ['$stage', 'handed_over'] }, then: 'Handed over, intro not sent yet' },
            { case: { $eq: ['$stage', 'intro_sent'] }, then: 'Intro sent, waiting for customer' },
            { case: { $eq: ['$stage', 'customer_no_reply'] }, then: "Customer didn't reply to salesperson" },
            { case: { $eq: ['$stage', 'waiting_for_salesperson'] }, then: 'Waiting for salesperson' },
            { case: { $eq: ['$stage', 'salesperson_missed'] }, then: 'Salesperson missed (alert sent)' },
            { case: { $eq: ['$stage', 'salesperson_replied'] }, then: 'Salesperson replied' },
        ],
        default: '$stage',
    },
};
const journeyDay = { $dateTrunc: { date: '$started_at', unit: 'day' } };
const count = (name, field) => ({ name, display: 'scalar', size: [4, 3], query: pipe([{ $group: { _id: null, n: { $sum: field ? has(field) : 1 } } }, { $project: { _id: 0, [name.toLowerCase().replace(/\W+/g, '_')]: '$n' } }]) });
const JOURNEY_CARDS = [
    count('Leads started'),
    count('Handed to salesperson', 'handed_over_at'),
    count('Customer replied', 'customer_replied_at'),
    count('Salesperson replied', 'salesperson_replied_at'),
    count('Salesperson missed', 'salesperson_missed_at'),
    {
        name: 'Avg salesperson reply (min)', display: 'scalar', size: [4, 3],
        query: pipe([{ $match: { salesperson_reply_minutes: { $ne: null } } }, { $group: { _id: null, minutes: { $avg: '$salesperson_reply_minutes' } } }, { $project: { _id: 0, minutes: { $round: ['$minutes', 1] } } }]),
    },
    {
        name: 'Lead funnel', display: 'funnel', size: [12, 8],
        query: pipe([
            { $group: { _id: null, a: { $sum: 1 }, b: { $sum: has('handed_over_at') }, c: { $sum: has('intro_sent_at') }, d: { $sum: has('customer_replied_at') }, e: { $sum: has('salesperson_replied_at') } } },
            { $project: { _id: 0, steps: [
                { step: '1. Started intake', leads: '$a' },
                { step: '2. Handed to salesperson', leads: '$b' },
                { step: '3. Salesperson intro sent', leads: '$c' },
                { step: '4. Customer replied', leads: '$d' },
                { step: '5. Salesperson replied', leads: '$e' },
            ] } },
            { $unwind: '$steps' },
            { $replaceRoot: { newRoot: '$steps' } },
        ]),
        viz: { 'funnel.dimension': 'step', 'funnel.metric': 'leads' },
    },
    {
        name: 'Where every lead stands', display: 'row', size: [12, 8],
        query: pipe([{ $group: { _id: outcome, leads: { $sum: 1 } } }, { $project: { _id: 0, status: '$_id', leads: 1 } }, { $sort: { leads: -1 } }]),
        viz: { 'graph.dimensions': ['status'], 'graph.metrics': ['leads'] },
    },
    {
        name: 'Salesperson performance', display: 'table', size: [24, 4],
        query: pipe([
            { $match: { team: { $ne: null } } },
            { $group: {
                _id: '$team', handed_over: { $sum: has('handed_over_at') }, customer_replied: { $sum: has('customer_replied_at') },
                salesperson_replied: { $sum: has('salesperson_replied_at') }, missed: { $sum: has('salesperson_missed_at') },
                avg_reply_min: { $avg: '$salesperson_reply_minutes' },
            } },
            { $project: {
                _id: 0, team: '$_id', handed_over: 1, customer_replied: 1, salesperson_replied: 1, missed: 1,
                reply_rate: { $cond: [{ $eq: ['$customer_replied', 0] }, null, { $divide: ['$salesperson_replied', '$customer_replied'] }] },
                avg_reply_min: { $round: ['$avg_reply_min', 1] },
            } },
            { $sort: { team: 1 } },
        ]),
        viz: { column_settings: { '["name","reply_rate"]': { number_style: 'percent', decimals: 0 } } },
    },
    {
        name: 'Needs attention: customer waiting on salesperson (last 7 days)', display: 'table', size: [24, 6],
        query: pipe([
            { $match: { stage: { $in: ['salesperson_missed', 'waiting_for_salesperson'] }, $expr: { $lt: [minutesSince('customer_replied_at'), 7 * 24 * 60] } } },
            { $sort: { customer_replied_at: -1 } },
            { $project: { _id: 0, customer_replied: '$customer_replied_at', waiting_hours: { $round: [{ $divide: [minutesSince('customer_replied_at'), 60] }, 1] }, name: 1, phone: 1, business: 1, team: 1, category: 1, needs: 1, status: outcome } },
        ]),
    },
    {
        name: 'Leads per day by outcome', display: 'bar', size: [16, 7],
        query: pipe([
            { $group: { _id: { day: journeyDay, status: outcome }, leads: { $sum: 1 } } },
            { $project: { _id: 0, day: '$_id.day', status: '$_id.status', leads: 1 } },
            { $sort: { day: 1 } },
        ]),
        viz: { 'graph.dimensions': ['day', 'status'], 'graph.metrics': ['leads'], 'stackable.stack_type': 'stacked', 'graph.x_axis.title_text': 'Day', 'graph.y_axis.title_text': 'Leads' },
    },
    {
        name: 'Handed over by business type', display: 'pie', size: [8, 7],
        query: pipe([{ $match: { handed_over_at: { $ne: null } } }, { $group: { _id: { $ifNull: ['$category', 'Not given'] }, leads: { $sum: 1 } } }, { $project: { _id: 0, business_type: '$_id', leads: 1 } }, { $sort: { leads: -1 } }]),
        viz: { 'pie.dimension': 'business_type', 'pie.metric': 'leads' },
    },
    {
        name: 'All leads', display: 'table', size: [24, 9],
        query: pipe([
            { $sort: { started_at: -1 } },
            { $limit: 2000 },
            { $project: { _id: 0, started: '$started_at', name: 1, phone: 1, business: 1, category: 1, team: 1, area: 1, needs: 1, status: outcome, handed_over: '$handed_over_at', customer_replied: '$customer_replied_at', salesperson_replied: '$salesperson_replied_at', reply_min: '$salesperson_reply_minutes' } },
        ]),
    },
];

const DASHBOARDS = [
    { name: 'Flow events', description: 'Events sent by FlowFlex flows (success and no-response paths).', collection: 'events', cards: FLOW_EVENT_CARDS },
    { name: 'Incoming leads', description: 'WhatsApp leads from the intake flow: who completed it, where people stopped, and what they need.', collection: 'leads', cards: LEAD_CARDS },
    { name: 'Lead journey', description: 'Every lead from the main-number intake to the salesperson: handover, customer reply, and whether the salesperson replied in time.', collection: 'journeys', cards: JOURNEY_CARDS },
];

async function ensureDashboard(databaseId, { name, description, collection, cards }) {
    const dashboards = await api('GET', '/dashboard');
    let dashboard = dashboards.find((d) => d.name === name && !d.archived);
    if (dashboard) {
        console.log(`Dashboard "${name}" already exists (id ${dashboard.id}); leaving it as is.`);
        return dashboard.id;
    }
    console.log(`Building the "${name}" dashboard…`);
    dashboard = await api('POST', '/dashboard', { name, description });

    // Lay cards out left to right on Metabase's 24-column grid.
    const dashcards = [];
    let row = 0, col = 0, rowHeight = 0;
    for (const [i, spec] of cards.entries()) {
        const card = await api('POST', '/card', {
            name: spec.name,
            display: spec.display,
            dataset_query: { database: databaseId, type: 'native', native: { query: spec.query, collection } },
            visualization_settings: spec.viz ?? {},
        });
        const [w, h] = spec.size;
        if (col + w > 24) { row += rowHeight; col = 0; rowHeight = 0; }
        dashcards.push({ id: -(i + 1), card_id: card.id, row, col, size_x: w, size_y: h, parameter_mappings: [], visualization_settings: {} });
        col += w;
        rowHeight = Math.max(rowHeight, h);
    }
    await api('PUT', `/dashboard/${dashboard.id}`, { dashcards });
    return dashboard.id;
}

async function publicLink(dashboardId) {
    if (PUBLIC_DASHBOARD !== 'true') return null;
    await api('PUT', '/setting/enable-public-sharing', { value: true });
    const { uuid } = await api('POST', `/dashboard/${dashboardId}/public_link`);
    const site = (await api('GET', '/session/properties'))['site-url'] || METABASE_URL;
    return `${site.replace(/\/$/, '')}/public/dashboard/${uuid}`;
}

await waitForMetabase();
await signIn();
const databaseId = await ensureDatabase();
// Newly created collections (like "leads") need a schema sync before Metabase lists them.
await api('POST', `/database/${databaseId}/sync_schema`);
for (const spec of DASHBOARDS) {
    const dashboardId = await ensureDashboard(databaseId, spec);
    const link = await publicLink(dashboardId);
    console.log(`"${spec.name}": dashboard id ${dashboardId}${link ? `, public link ${link}` : ''}`);
}
