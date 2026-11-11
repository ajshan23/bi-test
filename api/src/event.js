// Turns whatever a flow's API node posts into one tidy event document.
//
// Flow variables arrive as strings ("12", "true"), so values inside `data` are
// coerced to numbers/booleans where they clearly are one; that lets Metabase
// sum and average them.

export const MAX_BATCH = 100;

const KNOWN = new Set(['event', 'outcome', 'path', 'status', 'worker', 'flow', 'channel', 'org', 'phone', 'name', 'contact', 'occurred_at', 'data']);

const text = (value, max = 200) => {
    if (value === undefined || value === null) return undefined;
    const s = String(value).trim();
    return s ? s.slice(0, max) : undefined;
};

export function coerce(value) {
    if (typeof value !== 'string') return value;
    const s = value.trim();
    if (s === 'true') return true;
    if (s === 'false') return false;
    // Plain decimals only: keeps phone numbers with + and ids with leading zeros as text.
    if (/^-?(0|[1-9]\d{0,14})(\.\d+)?$/.test(s)) return Number(s);
    return value;
}

const coerceObject = (obj) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, v && typeof v === 'object' && !Array.isArray(v) ? coerceObject(v) : coerce(v)]));

function parseDate(value, now) {
    if (value === undefined || value === null || value === '') return now;
    const n = Number(value);
    // Accept ISO strings and unix seconds/milliseconds.
    const date = Number.isFinite(n) ? new Date(n < 1e12 ? n * 1000 : n) : new Date(String(value));
    return Number.isFinite(date.getTime()) ? date : now;
}

/** Returns { doc } or { error } for one posted event. */
export function normalizeEvent(body, now = new Date()) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'Each event must be a JSON object.' };
    const event = text(body.event, 100);
    if (!event) return { error: 'Field "event" is required, e.g. "lead_captured".' };

    // Unknown top-level fields are kept, under data.
    const extra = Object.fromEntries(Object.entries(body).filter(([k]) => !KNOWN.has(k)));
    const nested = body.data && typeof body.data === 'object' && !Array.isArray(body.data) ? body.data : {};
    const data = coerceObject({ ...extra, ...nested });

    const contact = body.contact && typeof body.contact === 'object' ? body.contact : {};
    const doc = {
        event,
        outcome: text(body.outcome ?? body.path ?? body.status, 50)?.toLowerCase().replace(/[\s-]+/g, '_'),
        worker: text(body.worker),
        flow: text(body.flow),
        channel: text(body.channel, 50),
        org: text(body.org),
        contact: { phone: text(body.phone ?? contact.phone, 30), name: text(body.name ?? contact.name) },
        data,
        occurred_at: parseDate(body.occurred_at, now),
        received_at: now,
    };
    // Drop empty fields so Metabase doesn't show columns of nulls.
    for (const key of Object.keys(doc)) if (doc[key] === undefined) delete doc[key];
    for (const key of Object.keys(doc.contact)) if (doc.contact[key] === undefined) delete doc.contact[key];
    if (!Object.keys(doc.contact).length) delete doc.contact;
    return { doc };
}
