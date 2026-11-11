// A lead's whole journey across the intake flow and the salesperson flows.
//
// Every BI node in the flows posts one event: { phone, event, ...answers }.
// We keep the raw event (journey_events) and fold it into ONE document per
// journey (journeys), matched by phone: `intake_started` opens a new journey,
// every other event updates the newest journey for that phone (or opens one if
// the intake start was never seen).
//
// Stages only move forward, so a late or repeated event can't undo progress.

export const EVENTS = {
    intake_started: { rank: 1, stage: 'in_intake', at: 'started_at' },
    dropped: { rank: 2, stage: 'dropped', at: 'dropped_time' },
    handed_over: { rank: 3, stage: 'handed_over', at: 'handed_over_at' },
    sales_started: { rank: 4, stage: 'intro_sent', at: 'intro_sent_at' },
    customer_no_reply: { rank: 5, stage: 'customer_no_reply', at: 'customer_no_reply_at' },
    customer_replied: { rank: 6, stage: 'waiting_for_salesperson', at: 'customer_replied_at' },
    agent_no_reply: { rank: 7, stage: 'salesperson_missed', at: 'salesperson_missed_at' },
    agent_replied: { rank: 8, stage: 'salesperson_replied', at: 'salesperson_replied_at' },
};

// Business types the intake list sends to the HoReCa salesperson (lead.horeca);
// everything else goes to Retail (lead.retail).
const HORECA = new Set(['hotel', 'restaurant / café', 'restaurant / cafe', 'airline / catering']);
export const teamFor = (category) => (category ? (HORECA.has(category.toLowerCase()) ? 'HoReCa' : 'Retail') : undefined);

const FIELDS = ['name', 'business', 'needs', 'area', 'category', 'team', 'dropped_at', 'source', 'flow'];
const KNOWN = new Set(['phone', 'event', 'occurred_at', ...FIELDS]);

const clean = (value, max = 300) => {
    if (value === undefined || value === null) return undefined;
    const s = String(value).trim();
    if (!s || /^\{\{.*\}\}$/.test(s)) return undefined; // unanswered question → unresolved variable
    return s.slice(0, max);
};
const slug = (value) => clean(value, 60)?.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

function parseDate(value, now) {
    if (value === undefined || value === null || value === '') return now;
    const n = Number(value);
    const date = Number.isFinite(n) ? new Date(n < 1e12 ? n * 1000 : n) : new Date(String(value));
    return Number.isFinite(date.getTime()) ? date : now;
}

/** Returns { doc } (the raw event) or { error }. */
export function normalizeJourneyEvent(body, now = new Date()) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'The event must be a JSON object.' };
    const phone = clean(body.phone, 30)?.replace(/^\+/, '');
    if (!phone) return { error: 'Field "phone" is required ({{tg.from}} in the main flow, {{tg.phone}} in the sales flows).' };
    const event = slug(body.event);
    if (!EVENTS[event]) return { error: `Field "event" must be one of: ${Object.keys(EVENTS).join(', ')}.` };

    const doc = { phone, event, occurred_at: parseDate(body.occurred_at, now), received_at: now };
    for (const key of FIELDS) {
        const value = key === 'dropped_at' ? slug(body[key]) : clean(body[key], key === 'needs' ? 1000 : 200);
        if (value !== undefined) doc[key] = value;
    }
    if (!doc.team) doc.team = teamFor(doc.category);
    if (!doc.team) delete doc.team;
    const extra = Object.fromEntries(Object.entries(body).filter(([k]) => !KNOWN.has(k)).map(([k, v]) => [k, clean(v)]).filter(([, v]) => v !== undefined));
    if (Object.keys(extra).length) doc.extra = extra;
    return { doc };
}

/**
 * Aggregation-pipeline update that folds one event into the journey document.
 * Values go through $literal so text like "$5 order" is never read as a field path.
 */
export function journeyUpdate(evt) {
    const { rank, stage, at } = EVENTS[evt.event];
    const when = evt.occurred_at;
    const set = {
        phone: { $literal: evt.phone },
        started_at: { $ifNull: ['$started_at', when] },
        [at]: { $ifNull: [`$${at}`, when] },
        stage: { $cond: [{ $gt: [rank, { $ifNull: ['$stage_rank', 0] }] }, stage, '$stage'] },
        stage_rank: { $max: [rank, { $ifNull: ['$stage_rank', 0] }] },
        updated_at: when,
        events: { $concatArrays: [{ $ifNull: ['$events', []] }, [{ $literal: { event: evt.event, at: when, ...(evt.flow ? { flow: evt.flow } : {}) } }]] },
    };
    for (const key of FIELDS) if (evt[key] !== undefined && key !== 'flow') set[key] = { $literal: evt[key] };
    if (evt.extra) set.extra = { $mergeObjects: [{ $ifNull: ['$extra', {}] }, { $literal: evt.extra }] };
    if (evt.event === 'agent_replied') {
        set.salesperson_reply_minutes = {
            $cond: [{ $ifNull: ['$customer_replied_at', false] }, { $round: [{ $divide: [{ $subtract: [when, '$customer_replied_at'] }, 60000] }, 1] }, null],
        };
    }
    return [{ $set: set }];
}
