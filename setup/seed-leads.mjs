// Realistic demo leads for the "Incoming leads" dashboard, posted through the real API.
//
//   API_URL=https://test.operium.pro API_KEY=... node setup/seed-leads.mjs            # post
//   DRY_RUN=1 API_KEY=x node setup/seed-leads.mjs                                     # preview only
//
// Shape: about a month of WhatsApp intake, slow at first and picking up, quiet on
// Fridays, some days with nothing, two busier days after promotions, Bahrain
// business hours, casual typing, a few people who drop and come back later.
// Nothing is ever dated in the future.
//
// Each lead carries extra.demo = "true"; remove them later with
//   db.leads.deleteMany({ 'extra.demo': 'true' })

const { API_URL = 'http://localhost:4080', API_KEY, DAYS = '30', DRY_RUN } = process.env;
if (!API_KEY) throw new Error('Set API_KEY.');

const rand = Math.random;
const pick = (list) => list[Math.floor(rand() * list.length)];
const chance = (p) => rand() < p;
const weighted = (pairs) => { let r = rand() * pairs.reduce((s, [, w]) => s + w, 0); for (const [v, w] of pairs) if ((r -= w) <= 0) return v; return pairs[0][0]; };

// Flow list options, spelled exactly as in the WhatsApp list messages.
const AREAS = [['Manama', 34], ['Muharraq', 17], ['Riffa', 15], ['Isa Town / Sitra', 13], ['Other area', 9]];
const TYPES = [['Restaurant / Café', 40], ['Supermarket / Grocery', 24], ['Hotel', 14], ['Airline / Catering', 5], ['Other business', 10]];

const BUSINESS = {
    'Restaurant / Café': ['Spice Garden Restaurant', 'karak corner', 'Mama Rosa Cafe', 'Al Fanar Grill', 'Shawarma Spot', 'Tandoor Nights', 'Bluefin Seafood Restaurant', 'Cafe Latte Seef', 'Zaatar w Zeit kitchen', 'Golden Fork Restaurant', 'Biryani House Gudaibiya', 'The Breakfast Club cafe', 'Kerala Hotel & Restaurant', 'Noodle Bar Juffair', 'Al Bustan Cafeteria'],
    'Supermarket / Grocery': ['Al Noor Supermarket', 'FRESH MART', 'Riffa Family Grocery', 'Day to Day mini mart', 'Al Waha Cold Store', 'Sitra Central Market', 'Green Leaf Grocery', 'Al Hilal Cold Store', 'City Fresh Supermarket'],
    Hotel: ['Juffair Pearl Hotel', 'Seef Residence Suites', 'Bay View Hotel Apartments', 'Al Dana Hotel', 'Palm Court Hotel'],
    'Airline / Catering': ['SkyBite Catering', 'Gulf Events Catering', 'Al Majlis Catering Services'],
    'Other business': ['Al Amal Trading', 'Busy Bee Nursery', 'Crown Labour Camp mess', 'Tech Park canteen', 'St. Mary school canteen', 'Fitness Hub juice bar'],
};

const NEEDS = {
    'Restaurant / Café': ['frozen chicken 20 cartons weekly', 'need price for fries 2.5kg x 40 bags', 'Basmati rice 40kg, 10 bags every month', 'Cooking oil 18L tins, 15 per month', 'milk and laban daily delivery', 'paper cups, lids and takeaway boxes', 'Mozzarella cheese + frozen dough', 'pls send price list for spices', 'coffee beans 10kg monthly and sugar sticks', 'tomato paste, ketchup, mayo in bulk', 'Frozen shrimp and fish fillets every week', 'soft drinks cans 30 cartons'],
    'Supermarket / Grocery': ['full range of FMCG, send catalogue', 'Water 330ml, 100 cartons per month', 'rice and flour bulk monthly', 'Chips and biscuits, all brands', 'detergents and cleaning products', 'Frozen veg and frozen chicken', 'need juice and dairy distributor', 'canned food, tuna, beans'],
    Hotel: ['Minibar items - soft drinks, snacks, water', 'breakfast buffet supplies: eggs, butter, jam, cereals', 'Bottled water 500ml, 200 cartons monthly', 'coffee, tea bags and sugar for 120 rooms', 'Frozen meat and poultry weekly'],
    'Airline / Catering': ['Portion packs - butter, jam, sugar, creamer', 'frozen chicken and rice in bulk, weekly', 'Juice 200ml tetra, 500 cartons/month'],
    'Other business': ['tea, sugar, milk powder for staff', 'water and snacks for office', 'rice, oil, dal for 300 workers monthly', 'Juices and fruit for the kids', 'protein bars and drinks'],
};

const NAMES = ['Ahmed', 'Mohammed Ali', 'Fatima', 'Hussain Abbas', 'Sayed Jaffar', 'Noor', 'Yusuf', 'Zainab Hasan', 'Abdulla', 'Maryam', 'Ali Ebrahim', 'Khalid', 'Rashid', 'Layla', 'Suresh Kumar', 'Anil', 'Priya', 'Biju Thomas', 'Shafeeq', 'Rahul Nair', 'Joseph', 'Imran Khan', 'Faisal', 'Ammar', 'Hamad', 'Mahmood', 'Salman', 'Sara', 'Jasim', 'Ravi', 'Nasser', 'Habeeb', 'Ayesha', 'Abu Ahmed', '~', 'Manager', 'Sales'];

// Casual typing: sometimes lower-case, sometimes trimmed.
const typed = (text) => (chance(0.25) ? text.toLowerCase() : text);
const phone = () => {
    if (chance(0.06)) return `966 5${String(Math.floor(rand() * 1e8)).padStart(8, '0')}`.replace(' ', '');
    return `973${pick(['3', '3', '3', '6', '6', '9'])}${String(Math.floor(rand() * 1e7)).padStart(7, '0')}`;
};

// Bahrain local hour (UTC+3), weighted to late morning and evening.
const HOURS = [[8, 2], [9, 5], [10, 8], [11, 9], [12, 7], [13, 5], [14, 3], [15, 3], [16, 5], [17, 7], [18, 8], [19, 9], [20, 8], [21, 6], [22, 3]];
function timeOn(dayStart) {
    const at = new Date(dayStart);
    at.setUTCHours(weighted(HOURS) - 3, Math.floor(rand() * 60), Math.floor(rand() * 60), 0);
    return at;
}

const now = new Date();
const days = Number(DAYS);
const promoDays = new Set([Math.floor(days * 0.45), Math.floor(days * 0.8)]); // days-ago with a broadcast push
const leads = [];
const comebacks = []; // dropped people who return a few days later

for (let ago = days - 1; ago >= 0; ago--) {
    const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - ago));
    const weekday = dayStart.getUTCDay(); // 5 = Friday, 6 = Saturday
    const progress = (days - ago) / days; // 0 → 1 over the month
    let expected = 1 + progress * 3.5; // ~1/day at the start, ~4.5/day by the end
    if (weekday === 5) expected *= 0.25;
    else if (weekday === 6) expected *= 0.6;
    if (promoDays.has(ago)) expected += 5;
    if (!promoDays.has(ago) && chance(0.14)) expected = 0; // nothing came in that day
    let count = Math.max(0, Math.round(expected + (rand() - 0.5) * 2.5));

    const todays = [];
    for (; count > 0; count--) {
        const at = timeOn(dayStart);
        if (at > now) continue;
        const type = weighted(TYPES);
        const lead = { phone: phone(), name: pick(NAMES), source: 'Prime FMCG WhatsApp intake', channel: 'whatsapp', occurred_at: at.toISOString(), demo: 'true' };
        const r = rand();
        if (r < 0.13) Object.assign(lead, { stage: 'dropped', dropped_at: 'business_name' });
        else if (r < 0.27) Object.assign(lead, { stage: 'dropped', dropped_at: 'product_needs', business: typed(pick(BUSINESS[type])) });
        else Object.assign(lead, { stage: 'completed', business: typed(pick(BUSINESS[type])), needs: typed(pick(NEEDS[type])), area: weighted(AREAS), business_type: type });
        if (lead.stage === 'dropped' && chance(0.35)) comebacks.push({ lead, type, dueAgo: ago - 1 - Math.floor(rand() * 4) });
        todays.push(lead);
    }
    // People who dropped earlier and finished the chat this day.
    for (const c of comebacks.filter((x) => x.dueAgo === ago)) {
        const at = timeOn(dayStart);
        if (at > now) continue;
        todays.push({ phone: c.lead.phone, name: c.lead.name, source: c.lead.source, channel: 'whatsapp', occurred_at: at.toISOString(), demo: 'true', stage: 'completed', business: c.lead.business || typed(pick(BUSINESS[c.type])), needs: typed(pick(NEEDS[c.type])), area: weighted(AREAS), business_type: c.type });
    }
    leads.push(...todays.sort((a, b) => a.occurred_at.localeCompare(b.occurred_at)));
}

const byDay = {};
for (const l of leads) byDay[l.occurred_at.slice(0, 10)] = (byDay[l.occurred_at.slice(0, 10)] || 0) + 1;
const completed = leads.filter((l) => l.stage === 'completed').length;
console.log(`${leads.length} leads, ${completed} completed, ${leads.length - completed} dropped, ${days - Object.keys(byDay).length} empty days`);
console.log(Object.entries(byDay).map(([d, n]) => `${d.slice(5)}:${n}`).join(' '));
if (DRY_RUN) process.exit(0);

for (const lead of leads) {
    const res = await fetch(`${API_URL.replace(/\/$/, '')}/api/flowflex/leads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
        body: JSON.stringify(lead),
    });
    if (!res.ok) throw new Error(`Seeding failed: ${res.status} ${await res.text()}`);
}
console.log(`Posted ${leads.length} demo leads to ${API_URL}.`);
