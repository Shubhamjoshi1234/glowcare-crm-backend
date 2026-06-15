# GlowCare Backend

The backend is an npm workspace containing two independently deployable Node.js
services. No Docker setup is required.

This directory is self-contained and can be published as its own GitHub
repository. Both backend services belong in that one repository because they
share the channel/callback contract.

## Services

```text
apps/crm-api/          CRM API, Prisma models, campaign dispatch, receipts, AI, analytics
apps/channel-service/  Stub provider that accepts messages and sends delayed callbacks
packages/shared/       Channel and callback contracts shared by both services
```

The CRM owns customer, order, segment, campaign, audience snapshot,
communication, receipt, and analytics data. The channel service receives only
the communication payload needed to simulate delivery.

## Start Locally

Requirements:

- Node.js 20.19 or newer
- npm

```powershell
Copy-Item .env.example .env
npm install
npm run dev
```

This applies Prisma migrations, seeds demo data when needed, and starts:

- CRM API: `http://localhost:4000`
- Channel service: `http://localhost:5000`

Useful commands:

```bash
npm run dev:crm
npm run dev:channel
npm run db:setup
npm run db:seed
npm run build
npm run lint
npm test
npm run start:crm
npm run start:channel
```

## Configuration

| Variable | Purpose | Local default |
| --- | --- | --- |
| `PORT` | Hosting-provider port for one deployed service | unset |
| `CRM_API_PORT` | Local CRM API port | `4000` |
| `CHANNEL_SERVICE_PORT` | Local channel service port | `5000` |
| `DATABASE_URL` | Prisma database URL | `file:./dev.db` |
| `CHANNEL_SERVICE_URL` | CRM-to-channel base URL | `http://localhost:5000` |
| `CRM_CALLBACK_URL` | Channel-to-CRM receipt endpoint | local CRM callback URL |
| `FRONTEND_URL` | Browser origin allowed by CORS | `http://localhost:5173` |
| `AI_PROVIDER` | `mock` or `openai` | `mock` |
| `OPENAI_API_KEY` | Server-only OpenAI credential | empty |
| `OPENAI_MODEL` | AI model used by the CRM | `gpt-4o-mini` |
| `AI_RECIPIENT_BATCH_SIZE` | Recipients per AI request | `10` |
| `AI_RECIPIENT_CONCURRENCY` | Concurrent AI requests | `2` |
| `LOG_LEVEL` | Pino log level | `info` |

`backend/.env` is ignored by Git. Keep the OpenAI key there for local
development, or inject it through the hosting provider's secret manager:

```env
AI_PROVIDER=openai
OPENAI_API_KEY=""
OPENAI_MODEL=gpt-4o-mini
```

Never put the key in `frontend/.env`, a `VITE_` variable, source code,
screenshots, logs, or documentation. Values prefixed with `VITE_` are embedded
in the public browser bundle.

## Main APIs

| Method and path | Responsibility |
| --- | --- |
| `GET /health` | CRM liveness |
| `GET /api/system/health` | CRM, channel, and AI-mode status |
| `GET /api/dashboard` | Overview totals, funnels, and trends |
| `GET /api/customers` | Search and filter customers |
| `GET /api/customers/:id` | Customer profile, orders, and communications |
| `POST /api/customers/import` | Validated customer and order ingestion |
| `GET /api/orders` | Search and filter orders |
| `POST /api/segments/preview` | Calculate a segment without saving it |
| `POST /api/segments` | Save a segment |
| `GET /api/ai/audience-insights` | Rank audience opportunities |
| `GET /api/ai/campaign-opportunities` | Generate editable campaign ideas |
| `POST /api/ai/message-draft` | Generate an editable campaign direction |
| `POST /api/campaigns` | Create a draft campaign |
| `POST /api/campaigns/:id/send` | Snapshot, personalize, and dispatch |
| `GET /api/campaigns/:id` | Campaign, communications, receipts, and analytics |
| `POST /api/receipts/channel-callback` | Ingest channel lifecycle events |
| `GET /api/analytics/products` | Product totals and time-series comparison |

## Delivery Lifecycle

1. The CRM claims a draft campaign with a conditional database update. This
   prevents concurrent duplicate launches.
2. It snapshots the selected audience and creates one communication ID per
   shopper.
3. It generates a grounded, shopper-specific message and calls the channel
   service.
4. The channel service returns a provider message ID, then schedules simulated
   `sent`, `delivered`, engagement, failure, and conversion callbacks.
5. Callback retries reuse the same event ID. The CRM stores every unique receipt
   separately and updates the communication's latest state only when allowed by
   the lifecycle ordering rules.
6. Duplicate events do not change analytics. Late lower-ranked events remain
   auditable but cannot downgrade a communication.

Callbacks with an unknown communication ID or mismatched campaign/provider ID
are stored as unprocessed audit events and do not mutate campaign state.

## AI Behavior

OpenAI is optional. With `AI_PROVIDER=mock`, deterministic local fallbacks keep
the complete demo flow operational.

When OpenAI is enabled:

- Audience analysis receives aggregate cohort evidence, not customer contact data.
- Campaign ideation receives product performance and audience evidence.
- Send-time personalization receives only the first name and limited recent
  purchase context required to write the message.
- Generated copy is checked for unsupported claims, disallowed private metrics,
  altered commercial terms, excessive similarity, and invalid placeholders.
- Failed or rejected generations fall back per recipient instead of aborting the
  entire campaign.

## Deploy

Deploy the CRM and channel simulator as two Node services from the `backend`
directory.

CRM API:

```text
Install: npm ci
Build:   npm run build
Start:   npm run deploy:crm
```

Channel service:

```text
Install: npm ci
Build:   npm run build
Start:   npm run start:channel
```

Set `CHANNEL_SERVICE_URL` on the CRM and `CRM_CALLBACK_URL` on the channel
service so the two deployments can reach each other.

SQLite is appropriate for this single-instance demo. Use persistent storage for
deployment. For multiple CRM instances, migrate Prisma to a managed PostgreSQL
database.

## Verification

```bash
npm run lint
npm test
npm run build
```

Current intentional limitations:

- No real WhatsApp, SMS, email, or RCS provider
- No authentication or role-based access control
- No durable job queue; simulation timers live in the channel process
- No inventory, gross margin, acquisition-cost, or campaign-budget model
- No horizontal SQLite scaling
