// Demo data: posts ~30 days of realistic flow events through the real API, so
// the dashboard has something to show before live flows are connected.
//
//   API_URL=http://localhost:4080 API_KEY=... node setup/seed.mjs
//   API_URL=https://test.operium.pro API_KEY=... node setup/seed.mjs
//
// Every seeded event carries data.demo = true; remove them later with
//   db.events.deleteMany({ 'data.demo': true })

const { API_URL = 'http://localhost:4080', API_KEY, DAYS = '30' } = process.env;
if (!API_KEY) throw new Error('Set API_KEY.');

const WORKERS = [
    { worker: 'Lead automation', flow: 'Lead automation', event: 'lead_captured', perDay: [6, 14], success: 0.72 },
    { worker: 'Inbound flow', flow: 'Inbound flow', event: 'details_captured', perDay: [3, 9], success: 0.64 },
    { worker: 'Book demo worker', flow: 'Book demo', event: 'demo_booked', perDay: [1, 5], success: 0.81 },
    { worker: 'Send signup link', flow: 'Send signup link', event: 'signup_link_sent', perDay: [1, 4], success: 0.58 },
];
const NAMES = ['Anjali', 'Rahul', 'Fathima', 'Arjun', 'Meera', 'Nikhil', 'Sana', 'Vishnu', 'Aisha', 'Kiran', 'Divya', 'Rohan'];
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const between = ([min, max]) => min + Math.floor(Math.random() * (max - min + 1));

const events = [];
const days = Number(DAYS);
for (let d = days - 1; d >= 0; d--) {
    for (const w of WORKERS) {
        for (let i = between(w.perDay); i > 0; i--) {
            const at = new Date(Date.now() - d * 86400000);
            at.setUTCHours(3 + Math.floor(Math.random() * 13), Math.floor(Math.random() * 60), 0, 0);
            events.push({
                event: w.event,
                outcome: Math.random() < w.success ? 'success' : 'no_response',
                worker: w.worker,
                flow: w.flow,
                name: pick(NAMES),
                phone: `+9198${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`,
                occurred_at: at.toISOString(),
                data: { demo: 'true', source: pick(['ctwa', 'meta', 'referral', 'website']) },
            });
        }
    }
}

for (let i = 0; i < events.length; i += 100) {
    const res = await fetch(`${API_URL.replace(/\/$/, '')}/api/flowflex/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
        body: JSON.stringify(events.slice(i, i + 100)),
    });
    if (!res.ok) throw new Error(`Seeding failed: ${res.status} ${await res.text()}`);
}
console.log(`Seeded ${events.length} demo events over ${days} days.`);
