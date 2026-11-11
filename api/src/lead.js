// An incoming WhatsApp lead, as the qualification flow sends it.
//
// One document per conversation. `stage` says how far the customer got:
//   completed  - answered every question
//   dropped    - stopped replying; `dropped_at` names the unanswered question
//
// Unanswered questions arrive as unresolved flow variables ("{{wtn_2.response.message}}")
// or empty strings; both are stored as missing so dashboards don't count them.

const STAGES = new Set(['completed', 'dropped']);
const KNOWN = new Set(['phone', 'name', 'business', 'needs', 'area', 'business_type', 'stage', 'dropped_at', 'source', 'channel', 'occurred_at']);

const clean = (value, max = 300) => {
    if (value === undefined || value === null) return undefined;
    const s = String(value).trim();
    if (!s || /^\{\{.*\}\}$/.test(s)) return undefined;
    return s.slice(0, max);
};
const slug = (value) => clean(value, 60)?.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

function parseDate(value, now) {
    if (value === undefined || value === null || value === '') return now;
    const n = Number(value);
    const date = Number.isFinite(n) ? new Date(n < 1e12 ? n * 1000 : n) : new Date(String(value));
    return Number.isFinite(date.getTime()) ? date : now;
}

/** Returns { doc } or { error } for one posted lead. */
export function normalizeLead(body, now = new Date()) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'The lead must be a JSON object.' };
    const phone = clean(body.phone, 30);
    if (!phone) return { error: 'Field "phone" is required (use {{tg.from}} in the flow).' };
    const stage = slug(body.stage) || 'completed';
    if (!STAGES.has(stage)) return { error: 'Field "stage" must be "completed" or "dropped".' };

    const extra = Object.fromEntries(Object.entries(body).filter(([k]) => !KNOWN.has(k)).map(([k, v]) => [k, clean(v)]).filter(([, v]) => v !== undefined));
    const doc = {
        phone,
        name: clean(body.name, 120),
        business: clean(body.business, 200),
        needs: clean(body.needs, 1000),
        area: clean(body.area, 80),
        business_type: clean(body.business_type, 80),
        stage,
        dropped_at: stage === 'dropped' ? slug(body.dropped_at) || 'unknown' : undefined,
        source: clean(body.source, 120),
        channel: clean(body.channel, 40),
        extra: Object.keys(extra).length ? extra : undefined,
        occurred_at: parseDate(body.occurred_at, now),
        received_at: now,
    };
    for (const key of Object.keys(doc)) if (doc[key] === undefined) delete doc[key];
    return { doc };
}
