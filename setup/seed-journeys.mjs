// Realistic demo journeys for the "Lead journey" dashboard, posted through the real API
// as the same events the three Deepak flows send.
//
//   API_URL=https://test.operium.pro API_KEY=... node setup/seed-journeys.mjs
//   DRY_RUN=1 API_KEY=x node setup/seed-journeys.mjs            # preview only
//
// Every event carries demo = "true" (stored as extra.demo); remove later with
//   db.journeys.deleteMany({ 'extra.demo': 'true' }); db.journey_events.deleteMany({ 'extra.demo': 'true' })

const { API_URL = 'http://localhost:4080', API_KEY, DAYS = '30', DRY_RUN } = process.env;
if (!API_KEY) throw new Error('Set API_KEY.');

const rand = Math.random;
const pick = (list) => list[Math.floor(rand() * list.length)];
const chance = (p) => rand() < p;
const between = (a, b) => a + rand() * (b - a);
const weighted = (pairs) => { let r = rand() * pairs.reduce((s, [, w]) => s + w, 0); for (const [v, w] of pairs) if ((r -= w) <= 0) return v; return pairs[0][0]; };
const MIN = 60000;

// Spelled exactly like the flow's list rows.
const AREAS = [['Manama', 34], ['Muharraq', 17], ['Riffa', 15], ['Isa Town / Sitra', 13], ['Other area', 9]];
const TYPES = [['Restaurant / Café', 36], ['Hotel', 15], ['Airline / Catering', 5], ['Supermarket / Grocery', 26], ['Other business', 12]];
const BUSINESS = {
    'Restaurant / Café': ['Spice Garden Restaurant', 'karak corner', 'Mama Rosa Cafe', 'Al Fanar Grill', 'Shawarma Spot', 'Tandoor Nights', 'Bluefin Seafood', 'Cafe Latte Seef', 'Golden Fork Restaurant', 'Biryani House Gudaibiya', 'Kerala Hotel & Restaurant', 'Al Bustan Cafeteria'],
    Hotel: ['Juffair Pearl Hotel', 'Seef Residence Suites', 'Bay View Hotel Apartments', 'Al Dana Hotel', 'Palm Court Hotel'],
    'Airline / Catering': ['SkyBite Catering', 'Gulf Events Catering', 'Al Majlis Catering Services'],
    'Supermarket / Grocery': ['Al Noor Supermarket', 'FRESH MART', 'Riffa Family Grocery', 'Day to Day mini mart', 'Al Waha Cold Store', 'Green Leaf Grocery', 'City Fresh Supermarket'],
    'Other business': ['Al Amal Trading', 'Busy Bee Nursery', 'Crown Labour Camp mess', 'Tech Park canteen', 'Fitness Hub juice bar'],
};
const NEEDS = {
    'Restaurant / Café': ['frozen chicken 20 cartons weekly', 'fries 2.5kg x 40 bags', 'Basmati rice 40kg, 10 bags monthly', 'cooking oil 18L tins', 'milk and laban daily', 'takeaway boxes and cups', 'soft drinks cans 30 cartons'],
    Hotel: ['minibar soft drinks, snacks, water', 'breakfast buffet supplies', 'bottled water 500ml, 200 cartons monthly', 'coffee, tea and sugar for 120 rooms'],
    'Airline / Catering': ['portion packs - butter, jam, sugar', 'frozen chicken and rice weekly', 'juice 200ml tetra, 500 cartons'],
    'Supermarket / Grocery': ['full FMCG range, send catalogue', 'water 330ml, 100 cartons monthly', 'chips and biscuits, all brands', 'detergents and cleaning products', 'frozen veg and chicken'],
    'Other business': ['tea, sugar, milk powder for staff', 'rice, oil, dal for 300 workers', 'water and snacks for office'],
};
const NAMES = ['Ahmed', 'Mohammed Ali', 'Fatima', 'Hussain Abbas', 'Sayed Jaffar', 'Noor', 'Yusuf', 'Zainab Hasan', 'Abdulla', 'Maryam', 'Ali Ebrahim', 'Khalid', 'Rashid', 'Layla', 'Suresh Kumar', 'Anil', 'Biju Thomas', 'Shafeeq', 'Rahul Nair', 'Imran Khan', 'Faisal', 'Hamad', 'Mahmood', 'Sara', 'Jasim', 'Nasser', 'Habeeb', 'Ayesha'];
const HOURS = [[8, 2], [9, 5], [10, 8], [11, 9], [12, 7], [13, 5], [14, 3], [15, 3], [16, 5], [17, 7], [18, 8], [19, 9], [20, 8], [21, 6], [22, 3]];
const typed = (t) => (chance(0.25) ? t.toLowerCase() : t);
const phone = () => `973${pick(['3', '3', '3', '6', '6', '9'])}${String(Math.floor(rand() * 1e7)).padStart(7, '0')}`;
const teamOf = (type) => (['Hotel', 'Restaurant / Café', 'Airline / Catering'].includes(type) ? 'HoReCa' : 'Retail');
const FLOW = { main: 'Deepak - main flow', HoReCa: 'Deepak - sales flow', Retail: 'Deepak - sales flow 2' };

const now = Date.now();
const days = Number(DAYS);
const promoDays = new Set([Math.floor(days * 0.45), Math.floor(days * 0.8)]);
const events = [];
const add = (t, body) => { if (t <= now) events.push({ ...body, occurred_at: new Date(t).toISOString(), demo: 'true' }); return t <= now; };

for (let ago = days - 1; ago >= 0; ago--) {
    const d = new Date(now - ago * 86400000);
    const dayStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    const weekday = new Date(dayStart).getUTCDay();
    let expected = 1 + ((days - ago) / days) * 3.5;
    if (weekday === 5) expected *= 0.25;
    else if (weekday === 6) expected *= 0.6;
    if (promoDays.has(ago)) expected += 5;
    if (!promoDays.has(ago) && chance(0.14)) expected = 0;
    for (let n = Math.max(0, Math.round(expected + (rand() - 0.5) * 2.5)); n > 0; n--) {
        let t = dayStart + (weighted(HOURS) - 3) * 60 * MIN + Math.floor(rand() * 60) * MIN;
        const p = phone();
        const name = pick(NAMES);
        if (!add(t, { phone: p, event: 'intake_started', name, flow: FLOW.main })) continue;

        const type = weighted(TYPES);
        const business = typed(pick(BUSINESS[type]));
        const r = rand();
        if (r < 0.12) { add(t + 15 * MIN, { phone: p, event: 'dropped', dropped_at: 'business_name', flow: FLOW.main }); continue; }
        if (r < 0.21) { add(t + between(17, 25) * MIN, { phone: p, event: 'dropped', dropped_at: 'product_needs', business, flow: FLOW.main }); continue; }
        if (r < 0.27) continue; // stopped at the area / business type list

        const team = teamOf(type);
        t += between(2, 9) * MIN;
        if (!add(t, { phone: p, event: 'handed_over', name, business, needs: typed(pick(NEEDS[type])), area: weighted(AREAS), category: type, flow: FLOW.main })) continue;
        t += between(0.2, 1) * MIN;
        if (!add(t, { phone: p, event: 'sales_started', team, flow: FLOW[team] })) continue;

        if (chance(0.27)) { add(t + 24 * 60 * MIN, { phone: p, event: 'customer_no_reply', team, flow: FLOW[team] }); continue; }
        t += (chance(0.6) ? between(3, 45) : between(45, 360)) * MIN;
        if (!add(t, { phone: p, event: 'customer_replied', team, flow: FLOW[team] })) continue;

        // HoReCa salesperson is quick; Retail is slower and misses more.
        const missRate = team === 'HoReCa' ? 0.12 : 0.3;
        if (chance(missRate)) add(t + 120 * MIN, { phone: p, event: 'agent_no_reply', team, flow: FLOW[team] });
        else add(t + (team === 'HoReCa' ? between(2, 40) : between(8, 110)) * MIN, { phone: p, event: 'agent_replied', team, flow: FLOW[team] });
    }
}
events.sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));

const starts = events.filter((e) => e.event === 'intake_started').length;
const tally = events.reduce((m, e) => ({ ...m, [e.event]: (m[e.event] || 0) + 1 }), {});
console.log(`${starts} journeys, ${events.length} events`, tally);
if (DRY_RUN) process.exit(0);

for (const e of events) {
    const res = await fetch(`${API_URL.replace(/\/$/, '')}/api/flowflex/journey`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY }, body: JSON.stringify(e) });
    if (!res.ok) throw new Error(`Seeding failed: ${res.status} ${await res.text()}`);
}
console.log(`Posted ${events.length} journey events to ${API_URL}.`);
