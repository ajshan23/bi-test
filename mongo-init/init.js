// Runs once, on the first start of an empty Mongo volume.
// Two least-privilege users on the "insights" database:
//   api      - writes flow events
//   metabase - reads them for dashboards
const insights = db.getSiblingDB('insights');

insights.createUser({ user: 'api', pwd: process.env.MONGO_API_PASSWORD, roles: [{ role: 'readWrite', db: 'insights' }] });
insights.createUser({ user: 'metabase', pwd: process.env.MONGO_METABASE_PASSWORD, roles: [{ role: 'read', db: 'insights' }] });

// Create the collection up front so Metabase sees it before the first event.
insights.createCollection('events');
insights.events.createIndex({ occurred_at: -1 });
insights.events.createIndex({ event: 1, occurred_at: -1 });
insights.events.createIndex({ outcome: 1, occurred_at: -1 });
insights.events.createIndex({ worker: 1, occurred_at: -1 });
