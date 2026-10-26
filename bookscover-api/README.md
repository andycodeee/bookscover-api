# Bookscover API

Backend for the AFK points game: players, points, inventory, UGC catalog items, game config, and leaderboards.
Hosted at `https://api.bookscover.store`.

## Stack and why

- **Node.js 20 + Express 4.** Small, boring, and well understood. Runs on any cheap PaaS with no build step.
- **PostgreSQL** (Neon or Supabase free tier). Data survives restarts and redeploys. Money-like operations (points, redemptions) use row locks and transactions, which SQLite cannot give you under concurrent Roblox servers.
- **zod** for validation of every input. Requests are never trusted as-is.
- **helmet** and **express-rate-limit** for basic hardening.

Deploy target: Railway (or Render/Fly.io). Free tiers on Render sleep after inactivity, which causes slow first requests for players. Railway's Hobby plan (about $5/month at the time of writing) keeps the service running. Check current pricing before you commit.

## Project layout

```
bookscover-api/
├── package.json
├── .env.example            # copy to .env for local development
├── src/
│   ├── index.js            # entrypoint: runs migrations, starts server, handles shutdown
│   ├── app.js              # Express app, rate limits, error handling
│   ├── config.js           # reads and validates environment variables
│   ├── db.js               # Postgres pool, transactions, migrations
│   ├── schema.sql          # database schema (idempotent)
│   ├── schemas.js          # zod validation schemas
│   ├── errors.js           # ApiError class
│   ├── middleware/
│   │   ├── auth.js         # admin and game API key checks (timing-safe)
│   │   ├── validate.js     # validates body / query / params
│   │   └── asyncHandler.js
│   ├── routes/
│   │   ├── public.js       # /v1/health, /v1/config, /v1/players, /v1/leaderboards
│   │   ├── game.js         # /v1/game/... (game API key): session, afk, redeem
│   │   └── admin.js        # /v1/admin/... (admin API key)
│   └── services/           # ALL business logic lives here (no HTTP code)
│       ├── players.js
│       ├── inventory.js
│       ├── items.js
│       └── config.js
├── roblox/
│   ├── ServerScriptService/
│   │   ├── BookscoverAPI.luau              # ModuleScript: HTTP client with retries
│   │   └── GameStateSync.server.luau        # Script: mirrors ProfileStore state to the API
│   └── StarterPlayerScripts/
│       └── RedeemButtonExample.client.luau  # Client example (sends item id only)
└── docs/
```

The `services/` layer does not know about HTTP. A future Discord bot or admin dashboard can `require('./src/services/...')` directly, or call this API with the admin key. Both paths use the same database rules.

## Authentication

| Key | Env var | Who holds it | Can call |
|---|---|---|---|
| Admin | `ADMIN_API_KEY` | You, your dashboard, your Discord bot | `/v1/admin/*` |
| Game | `GAME_API_KEY` | Roblox server scripts only | `/v1/game/*` |
| (none) | | Anyone | `/v1/players`, `/v1/players/{id}`, `/v1/config`, `/v1/leaderboards`, `/v1/health` |

Keys are sent as `Authorization: Bearer <key>`. Comparisons are timing-safe. Each key must be at least 32 characters, and the two must differ. Generate them with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

## Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/v1/health` | none | Uptime check. Returns 503 if the DB is down. |
| GET | `/v1/config` | none | Game config and active catalog items with prices |
| GET | `/v1/players?limit=&offset=` | none | List players (no banned players) |
| GET | `/v1/players/{id}` | none | Points, ban status, and inventory for one player |
| GET | `/v1/leaderboards?limit=` | none | Top players by points |
| POST | `/v1/game/players/{id}/state` | game | Sync server-owned points, stage, group reward, and boost snapshot |
| POST | `/v1/game/players/{id}/session` | game | Create or update a player when they join |
| POST | `/v1/game/players/{id}/afk` | game | Award AFK points based on server-measured time |
| POST | `/v1/game/players/{id}/redeem` | game | Spend points on an item. Requires `Idempotency-Key` header. |
| POST | `/v1/admin/players/{id}/points` | admin | Add a delta, e.g. `{"delta": 50, "reason": "event"}` |
| PATCH | `/v1/admin/players/{id}/points` | admin | Set absolute balance, e.g. `{"points": 0, "reason": "reset"}` |
| GET | `/v1/admin/players/{id}/inventory` | admin | View a player's items |
| POST | `/v1/admin/players/{id}/inventory` | admin | Grant an item for free, e.g. `{"itemId": "123"}` |
| POST | `/v1/admin/players/{id}/ban` | admin | `{"banned": true, "reason": "..."}` or `{"banned": false}` |
| GET | `/v1/admin/items` | admin | List all catalog items |
| POST | `/v1/admin/items` | admin | Add item: `{"id": "123", "name": "...", "price": 500, "active": true}` |
| PATCH | `/v1/admin/items/{id}` | admin | Change name, price, or active flag |
| GET | `/v1/admin/config` | admin | Read game config |
| PUT | `/v1/admin/config` | admin | Replace game config (validated) |

Config fields: `afkPointsPerMinute`, `minAwardSeconds`, `maxAwardSeconds`, `redemptionsEnabled`.

Errors use one shape: `{"error": {"code": "...", "message": "..."}}`. Common codes: `unauthorized` (401), `banned` (403), `player_not_found` / `item_not_found` / `item_unavailable` (404), `already_owned` (409), `insufficient_points` (402), `validation_error` (400), `rate_limited` (429).

### Roblox game integration and source of truth

- **Roblox ProfileStore remains authoritative for this experience.** Points still accrue in the existing server scripts; the API receives server-authenticated snapshots and powers player lookup, stage display, and the API leaderboard. It does not award a second set of AFK points.
- **State sync is idempotent.** A retry sends an absolute snapshot, so it cannot add points twice. The API logs only the balance difference in `point_ledger` with reason `game_sync`.
- The snapshot contains the player's points, stage, whether their group reward was claimed, active points multiplier, and active boosts. UGC purchases, redeem codes, Developer Products, and boosts continue to be granted by the existing Roblox server scripts; point changes appear in the API at the next sync (every 45 seconds).
- The separate API `/afk` and `/redeem` routes are legacy API-managed economy endpoints. Do not install the old `GameServerController` alongside this game's scripts: it creates a second point/redeem flow that this experience does not use.

## Local development

Requirements: Node.js 20+, and a Postgres database. The easiest option is a free Neon database (see deployment below).

```bash
npm install
cp .env.example .env     # then edit .env with your DATABASE_URL and two keys
npm run dev
```

Check it:

```bash
curl http://localhost:3000/v1/health
curl http://localhost:3000/v1/config
curl -H "Authorization: Bearer $ADMIN_API_KEY" http://localhost:3000/v1/admin/items
```

Create an item and give a player points:

```bash
# add a catalog item (use a real Roblox asset id)
curl -X POST http://localhost:3000/v1/admin/items \
  -H "Authorization: Bearer $ADMIN_API_KEY" -H "Content-Type: application/json" \
  -d '{"id":"123456789","name":"Cool Hat","price":500,"active":true}'

# simulate a player joining, then give points
curl -X POST http://localhost:3000/v1/game/players/42/session \
  -H "Authorization: Bearer $GAME_API_KEY" -H "Content-Type: application/json" \
  -d '{"username":"TestPlayer"}'
curl -X POST http://localhost:3000/v1/admin/players/42/points \
  -H "Authorization: Bearer $ADMIN_API_KEY" -H "Content-Type: application/json" \
  -d '{"delta":1000,"reason":"testing"}'

# redeem
curl -X POST http://localhost:3000/v1/game/players/42/redeem \
  -H "Authorization: Bearer $GAME_API_KEY" -H "Content-Type: application/json" \
  -H "Idempotency-Key: test-redeem-0001" -d '{"itemId":"123456789"}'
```

## Push to GitHub

```bash
cd bookscover-api
git init -b main
git add .
git commit -m "Initial Bookscover API"
# Create an empty repo named bookscover-api at github.com/new (no README, no .gitignore), then:
git remote add origin git@github.com:YOUR_USERNAME/bookscover-api.git
git push -u origin main
```

`.env` is in `.gitignore`. Never commit real keys. If you ever do, rotate both keys immediately.

## Deployment

### 1. Database (Neon, free)

1. Sign up at neon.tech and create a project named `bookscover`.
2. Copy the connection string from the dashboard. It looks like `postgres://user:pass@ep-xxx.region.aws.neon.tech/neondb?sslmode=require`. Keep it for step 3.

Tables are created automatically on the first boot of the API.

### 2. Generate production keys

Run the command below twice and save the two outputs somewhere safe (a password manager):

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

### 3. Host on Railway

1. Sign up at railway.app and connect your GitHub account.
2. Click **New Project → Deploy from GitHub repo**, and select `bookscover-api`.
3. Railway detects Node automatically and runs `npm install` then `npm start`.
4. Open the service, go to **Variables**, and add:
   - `DATABASE_URL` = the Neon connection string
   - `ADMIN_API_KEY` = first generated key
   - `GAME_API_KEY` = second generated key
   - `NODE_ENV` = `production`
   - `TRUST_PROXY` = `1`
5. Go to **Settings → Healthcheck Path** and set it to `/v1/health`.
6. Go to **Settings → Networking**. Click **Generate Domain** first and confirm `https://<something>.up.railway.app/v1/health` returns `{"ok":true,...}` before continuing.

### 4. Point api.bookscover.store at Railway

1. In Railway, **Settings → Networking → Custom Domain**, type `api.bookscover.store`. Railway shows a **CNAME target** such as `abc123.up.railway.app`. Copy it.
2. Open the DNS settings for `bookscover.store`. This is wherever your domain's nameservers point: your registrar, or Cloudflare if you use it.
3. Create this record:

   | Type | Name | Value / Target | TTL | Proxy |
   |---|---|---|---|---|
   | CNAME | `api` | the Railway target from step 1 | Auto | Off (DNS only, grey cloud in Cloudflare) |

4. Wait a few minutes. Check with `dig api.bookscover.store CNAME +short`.
5. Railway issues the TLS certificate automatically. When the custom domain shows a green check, test:

```bash
curl https://api.bookscover.store/v1/health
```

If Railway shows the domain as "pending" for longer than 15 minutes, a DNS record is usually wrong or still propagating. Check the record's name is exactly `api` and not `api.bookscover.store`.

### 5. Uptime monitoring

Create a free UptimeRobot monitor (HTTP(s), `https://api.bookscover.store/v1/health`, every 5 minutes). It alerts you when the API or database is down and keeps the service warm.

### 6. Roblox setup

1. In Roblox Studio: **Home → Game Settings → Security → Allow HTTP Requests**: turn it on. Without this, `HttpService` calls fail.
2. Create the folders and scripts:
   - `ServerScriptService/BookscoverAPI` (ModuleScript) from `roblox/ServerScriptService/BookscoverAPI.luau`
  - `ServerScriptService/GameStateSync` (Script) from `roblox/ServerScriptService/GameStateSync.server.luau`
3. In the server-only `BookscoverAPI` ModuleScript, replace `PASTE_YOUR_GAME_API_KEY_HERE` with your **GAME_API_KEY**. With the placeholder, syncing is disabled safely and gameplay continues; the key must never be placed in a client script or replicated container.
4. Publish the game and verify `/v1/players/{your-user-id}` returns your current points and stage after a sync.

Do not place the game key in any script under `ReplicatedStorage`, `StarterPlayer`, `StarterGui`, or any LocalScript. Clients can read those.

## How the Roblox game calls the API

`GameStateSync` waits for the existing `ProfileStore` profile, then sends a snapshot every 45 seconds using a secret held only in `ServerScriptService`. The snapshot mirrors the current points, stage, claimed group reward, multiplier, and active boosts. A backend ban is enforced on the next sync. If HTTP or the API is unavailable, the game keeps running and ProfileStore remains unaffected; the API logs a warning and tries again on its next interval.

Your actual UGC shop purchases Roblox catalog items for Robux, and the game grants the group reward, redeem codes, Developer Product rewards, and boosts with its existing Roblox scripts. Those systems are not replaced with the API's optional points-redemption inventory.

## Operations

- **Rotate a key:** generate a new key, set it in Railway Variables, redeploy, then update the Roblox module and republish. Rotating the game key does not affect admin access, and the reverse is also true.
- **Disable API-managed item redemptions:** `PUT /v1/admin/config` with `"redemptionsEnabled": false`. This does not disable the Roblox UGC shop.
- **Ban a player:** `POST /v1/admin/players/{id}/ban` with `{"banned": true, "reason": "..."}`. The game kicks them at the next state sync (up to 45 seconds later).
- **Change a player's game points:** use the existing in-game admin/reward mechanism. The API admin points endpoints modify the API mirror only; the next ProfileStore sync will restore the game balance in the mirror.
- **Audit points:** query the `point_ledger` table directly in the Neon SQL editor, filtered by `player_id`.
- **Shutdown:** the server closes connections cleanly on SIGTERM, so redeploys do not drop in-flight redemptions.

## Extending later (Discord bot, admin dashboard)

- **Discord bot:** run it as a separate process that calls the admin endpoints with the admin key. For lower latency, import `src/services/*` directly from a shared package.
- **Admin dashboard:** same approach. Keep the admin key on your server side and never ship it to a browser.
- Put any new business rule in `src/services/`, not in a route file. Then every interface gets it.
