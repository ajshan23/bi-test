// Demo leads for the "Incoming leads" dashboard, posted through the real API.
//
//   API_URL=http://localhost:4080 API_KEY=... node setup/seed-leads.mjs
//
// Each lead carries extra.demo = "true"; remove them later with
//   db.leads.deleteMany({ 'extra.demo': 'true' })

const { API_URL = 'http://localhost:4080', API_KEY, DAYS = '30' } = process.env;
if (!API_KEY) throw new Error('Set API_KEY.');

const AREAS = [['Manama', 34], ['Muharraq', 18], ['Riffa', 16], ['Isa Town / Sitra', 14], ['Other area', 18]];
const TYPES = [['Restaurant / Café', 38], ['Hotel', 20], ['Supermarket / Grocery', 22], ['Airline / Catering', 8], ['Other business', 12]];
const NEEDS = ['Frozen chicken and fries, weekly', 'Soft drinks and water, 50 cartons a month', 'Dairy: milk, cheese, butter twice a week', 'Rice, flour, oil — monthly bulk', 'Cleaning supplies for 3 branches', 'Beverages and snacks for the minibar', 'Frozen seafood, every 10 days', 'Coffee, tea and sugar for the café'];
const BUSINESS = ['Al Noor', 'Gulf Star', 'Seef Bites', 'Pearl', 'Juffair Grill', 'Golden Spoon', 'Amwaj', 'Riffa Fresh', 'Bahrain Bay', 'Spice Route'];
const SUFFIX = { 'Restaurant / Café': 'Restaurant', Hotel: 'Hotel', 'Supermarket / Grocery': 'Supermarket', 'Airline / Catering': 'Catering', 'Other business': 'Trading' };
const NAMES = ['Ahmed', 'Fatima', 'Ali', 'Mariam', 'Hussain', 'Noor', 'Yusuf', 'Zainab', 'Rashid', 'Layla', 'Suresh', 'Priya'];

const pick = (list) => list[Math.floor(Math.random() * list.length)];
const weighted = (pairs) => { let r = Math.random() * pairs.reduce((s, [, w]) => s + w, 0); for (const [v, w] of pairs) if ((r -= w) <= 0) return v; return pairs[0][0]; };

const leads = [];
for (let d = Number(DAYS) - 1; d >= 0; d--) {
    for (let i = 3 + Math.floor(Math.random() * 9); i > 0; i--) {
        const at = new Date(Date.now() - d * 86400000);
        at.setUTCHours(4 + Math.floor(Math.random() * 12), Math.floor(Math.random() * 60), 0, 0);
        const type = weighted(TYPES);
        const lead = {
            phone: `9733${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`,
            name: pick(NAMES),
            source: 'Prime FMCG WhatsApp intake',
            channel: 'whatsapp',
            occurred_at: at.toISOString(),
            demo: 'true',
        };
        const r = Math.random();
        if (r < 0.12) Object.assign(lead, { stage: 'dropped', dropped_at: 'business_name' });
        else if (r < 0.25) Object.assign(lead, { stage: 'dropped', dropped_at: 'product_needs', business: `${pick(BUSINESS)} ${SUFFIX[type]}` });
        else Object.assign(lead, { stage: 'completed', business: `${pick(BUSINESS)} ${SUFFIX[type]}`, needs: pick(NEEDS), area: weighted(AREAS), business_type: type });
        leads.push(lead);
    }
}

for (const lead of leads) {
    const res = await fetch(`${API_URL.replace(/\/$/, '')}/api/flowflex/leads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
        body: JSON.stringify(lead),
    });
    if (!res.ok) throw new Error(`Seeding failed: ${res.status} ${await res.text()}`);
}
console.log(`Seeded ${leads.length} demo leads over ${DAYS} days.`);
