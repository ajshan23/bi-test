# Operium Insights

A small demo BI stack: FlowFlex flows post events to an API, events land in
MongoDB, and Metabase shows them on a dashboard.

```
Flow (API node) --POST /api/flowflex/events--> api --> MongoDB <-- Metabase (read-only)
```

| Service | What it is |
|---|---|
| `api` | Node/Express. Accepts flow events with an API key and stores them. |
| `mongo` | MongoDB 7. Users: `api` (read/write), `metabase` (read only). |
| `metabase` | Metabase v0.64.6, settings kept in Postgres (`metabase-db`). |
| `metabase-setup` | One-shot: creates the admin, connects Mongo, builds the **Flow events** dashboard and its public link. |
| `caddy` | HTTPS for the domain (production only, `--profile proxy`). |

Images are Debian-based (`node:22-bookworm-slim`, `postgres:16-bookworm`):
the Alpine variants segfaulted on our Docker Desktop.

## API

All routes live under `/api/flowflex/` (Metabase owns every other `/api/*` path).

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/api/flowflex/health` | none | `{ "ok": true }` when Mongo is reachable |
| `POST` | `/api/flowflex/events` | `x-api-key` | Store one event, or an array of up to 100 |
| `GET` | `/api/flowflex/events?limit=20&outcome=no_response` | `x-api-key` | Latest events (filters: `event`, `outcome`, `worker`) |

| `POST` | `/api/flowflex/leads` | `x-api-key` | Store one incoming lead (one per conversation) |
| `GET` | `/api/flowflex/leads?limit=20&stage=dropped` | `x-api-key` | Latest leads (filters: `stage`, `area`, `business_type`, `phone`) |

### Leads (Incoming leads dashboard)

```json
{
  "phone": "{{tg.from}}",
  "name": "{{tg.name}}",
  "business": "{{wtn_1.response.message}}",
  "needs": "{{wtn_2.response.message}}",
  "area": "{{lmn_1.response.title}}",
  "business_type": "{{lmn_2.response.title}}",
  "stage": "completed",
  "source": "Prime FMCG WhatsApp intake",
  "channel": "whatsapp"
}
```

- `phone` is required. `stage` is `completed` or `dropped`; a dropped lead also sends `dropped_at` (`business_name`, `product_needs`).
- Unanswered questions arrive as unresolved `{{...}}` text or empty strings and are stored as missing.
- Extra fields are kept under `extra`. Demo leads: `API_URL=… API_KEY=… node setup/seed-leads.mjs` (tagged `extra.demo = "true"`).

### Events (Flow events dashboard)

Event body (only `event` is required):

```json
{
  "event": "lead_captured",
  "outcome": "no_response",
  "worker": "Lead automation",
  "flow": "Lead automation",
  "phone": "{{phone}}",
  "name": "{{name}}",
  "occurred_at": "2026-11-11T10:00:00Z",
  "course": "{{course}}",
  "score": "{{score}}"
}
```

- `outcome` also accepts `path` or `status`; it is stored lower-case snake_case (`"No Response"` → `no_response`).
- Any other field (like `course`, `score`) is kept under `data`. Number- and true/false-looking strings become numbers/booleans so Metabase can sum them; phone numbers stay text.
- `occurred_at` is optional (ISO or unix time); it defaults to when the event arrived.

### In the flow

On the **success** and **no response** branches, add an **API** node:

- Method `POST`, URL `https://test.operium.pro/api/flowflex/events`
- Header `x-api-key: <API_KEY from .env>`
- Body mode JSON, with the body above (`outcome` set to `success` or `no_response` per branch)

## Run locally

```bash
cp .env.example .env        # then fill every change-me (openssl rand -hex 24)
export COMPOSE_FILE=docker-compose.yml:docker-compose.local.yml
docker compose up -d --build
docker compose logs -f metabase-setup   # prints the public dashboard link when done
```

- Metabase: http://localhost:3030 (admin = `MB_ADMIN_EMAIL` / `MB_ADMIN_PASSWORD`)
- API: http://localhost:4080/api/flowflex/health

Demo data (30 days of sample events, each tagged `data.demo = true`):

```bash
API_URL=http://localhost:4080 API_KEY=<key> node setup/seed.mjs
```

Remove demo data later (in the mongo container, as root):

```bash
docker compose exec mongo mongosh -u root -p <MONGO_ROOT_PASSWORD> --quiet insights --eval "db.events.deleteMany({'data.demo': true})"
```

## Deploy to test.operium.pro

1. Point an **A record** for `test.operium.pro` at the server; open ports 80 and 443.
2. On the server: copy this folder, create `.env` from `.env.example` with fresh secrets, and set
   `DOMAIN=test.operium.pro` and `MB_SITE_URL=https://test.operium.pro`.
3. Start with the proxy profile (Caddy gets the TLS certificate automatically):

   ```bash
   docker compose --profile proxy up -d --build
   docker compose logs -f metabase-setup
   ```

4. Check `https://test.operium.pro/api/flowflex/health`, then sign in to Metabase at `https://test.operium.pro`.

### Behind an existing Traefik (flowflex-dev-v2)

That server's Traefik already owns 80/443 (network `proxy`, entrypoint `websecure`, resolver `le`).
Skip `--profile proxy` and use the Traefik override instead:

```bash
export COMPOSE_FILE=docker-compose.yml:docker-compose.traefik.yml
docker compose up -d --build
docker compose logs -f metabase-setup
```

`/api/flowflex/*` routes to `api:4000` and everything else on the host to `metabase:3000`.

## Notes

- `metabase-setup` is safe to re-run: it keeps an existing admin, connection and dashboard (matched by name). Edit the dashboard in Metabase afterwards; the script won't overwrite it.
- Mongo is not published on any port; only the `api` and `metabase` containers reach it.
- Back up the `mongo-data` and `metabase-db` volumes if the demo turns into something real.
