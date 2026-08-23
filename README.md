# CiviqueX

**A distributed, privacy-preserving evidence network that turns fragmented real-world observations into verified, correlated, risk-prioritized incidents — and independently verifies whether the physical-world problem was actually resolved.**

CiviqueX is a Road Safety Evidence & Accountability Platform. It is deliberately **not** another citizen-traffic-complaint app (Bengaluru's Public Eye/ASTraM, red-light camera systems, and generic civic-issue portals already do that well — see [Differentiation](#differentiation) below). Its job starts where those systems stop: correlating independent observations into one incident graph, decomposing evidence confidence instead of asserting a verdict, gating computer vision through geospatial/temporal/regulatory context, and — the part almost nothing does — **never trusting an authority's "resolved" status without independently re-observing the physical world.**

This build runs in **DEMO MODE** — deterministic, offline demo data, zero paid API keys — against a real hosted Postgres database (so it can also run on Vercel, whose serverless functions have no persistent local disk for SQLite to live on).

---

## Quick start

```bash
npm install
cp .env.example .env
# edit .env: set DATABASE_URL to a real Postgres connection string
# (free in ~1 minute at https://neon.tech, or Vercel dashboard → Storage → Postgres)
npm run db:reset          # applies the schema, seeds demo data
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Deploying to Vercel

1. Push this repo to GitHub, then import it in Vercel.
2. In the Vercel project's environment variables, set `DATABASE_URL` (your Neon/Vercel Postgres connection string) and `AUTH_SECRET` (a real random value — `openssl rand -base64 32`).
3. Add a Blob store: Vercel dashboard → Storage → Create → Blob → connect it to the project. This sets `BLOB_READ_WRITE_TOKEN` automatically, which switches evidence media uploads from local disk to Blob storage (required — Vercel's filesystem can't persist uploads).
4. Deploy, then run `npm run db:reset` once against the production `DATABASE_URL` (e.g. from your machine with that URL in `.env`) to seed the demo dataset.

Demo logins (password for all: `Password123!`):

| Email | Role |
|---|---|
| `citizen1@demo.civiquex.app` | Citizen |
| `citizen2@demo.civiquex.app` | Citizen |
| `authority.zone9@demo.civiquex.app` | Authority — Greater Chennai Corporation, Zone 9 |
| `authority.traffic@demo.civiquex.app` | Authority — Chennai Traffic Police |
| `admin@demo.civiquex.app` | Admin |

The public dashboards (Overview, Live Map, Hotspots, Analytics) are viewable without signing in; reporting an incident, viewing evidence media, and the authority queue require a session.

### Tests

```bash
npm test          # engine unit tests (Vitest) — correlation, confidence, rules, risk, resolution, hotspot, authority, contract matching
npm run test:e2e  # critical-flow + AI Road Patrol E2E tests (Playwright) — starts the dev server if not already running
```

The AI Road Patrol tests use a fake camera device and hit the real, public Nominatim API and Google's TensorFlow.js model CDN — they need network access and take 30-90s (real model download + real inference).

### Reset the demo data at any time

```bash
npm run db:reset
```

This is safe to run repeatedly — it wipes and re-seeds a deterministic dataset.

---

## Why this, when CCTV / Public Eye / Google Maps / traffic enforcement already exist?

Fixed CCTV is excellent at continuously watching known camera locations. It says nothing about the other 95% of a city's roads, and it does nothing to verify that a "resolved" complaint was actually resolved. Citizen-reporting apps (Public Eye, ASTraM) already collect photo/video violation reports — that part is not novel and is intentionally not this product's core loop.

CiviqueX's defensible core is the combination of:

1. **Incident Graph** — independent, asynchronous, heterogeneous observations (a citizen phone, a dashcam, an authorized sensor — no shared continuous camera, no requirement for a plate read) are correlated into one incident using time/space/trajectory/scene/appearance signals, not treated as separate complaints.
2. **Decomposed Evidence Confidence** — never a single opaque score. Visual, location, temporal, rule, scene, and corroboration confidence are shown separately, with the verdict always labeled "potential violation," "requires verification," or "evidence insufficient" — never a legal fact.
3. **Context/Rule Engine** — computer vision never independently decides legality. The same parked-vehicle detection is gated through road class, time window, and proximity rules before it can become a "potential violation."
4. **Resolution Verification Engine** — an authority's self-reported "resolved" is a claim, not ground truth. The platform always re-derives state from a fresh observation and will auto-reopen an incident the authority claimed was closed.
5. **Recurring Incident / Hotspot Engine** — repeated incidents at one location become one tracked hotspot with its own risk trajectory, not N duplicate complaints.
6. **Authority Resolution + Feedback Learning** — jurisdiction routing is auditable (every decision returns its full reasoning trail) and *learns* from redirect history ("wrong department") without becoming a black box.

See [`docs/differentiation.md`](docs/differentiation.md) for the full prior-art research and the resulting scope cuts (helmet detection, pothole/construction reporting, and single-photo violation capture were deliberately excluded as non-novel).

---

## AI Road Patrol — real, live AI detection with proof

`/patrol` is the flagship real-time flow, modeled on real citizen pothole-hunting tools (e.g. the Bengaluru engineer's Potholes Detector, covered by [Gizbot](https://www.gizbot.com/apps/features/bengaluru-engineer-uses-ai-hunt-potholes-expose-contractors-behind-bad-roads-how-it-works-128011.html)). Everything in its "AI analysis proof" panel is genuine, live output — nothing is simulated:

- **Real object detection**: [`@tensorflow-models/coco-ssd`](https://github.com/tensorflow/tfjs-models/tree/master/coco-ssd), an actual pretrained neural network, runs live in your browser (`lib/client/useRoadPatrolDetector.ts`). The weights are downloaded once from Google's official TensorFlow.js model storage, then every subsequent frame is a real local inference — no API call per photo, nothing sent anywhere until you explicitly capture a candidate.
- **Real road-surface anomaly heuristic**: a genuine Sobel edge-magnitude scan over the actual captured pixels (`lib/client/roadAnomaly.ts`), not a trained classifier — flagged transparently as a heuristic, not a diagnosis.
- **Real, continuous GPS**: `navigator.geolocation.watchPosition`.
- **Real reverse geocoding**: OpenStreetMap's Nominatim (`lib/services/geocode.ts`), proxied server-side with a proper User-Agent and a ~1 req/sec throttle per that service's usage policy — free, public, and meant for exactly this, not scraped.
- **Contract Registry matching**: the location-match / warranty / keyword scoring engine from the Bengaluru tool's approach (`lib/engines/contractMatch.ts`), matched against a real GPS point. The registry itself is demo data — no verified open API for government road-contract records exists to pull from live, and this project does not fabricate one (see [Differentiation](#differentiation)).

Confirming a candidate feeds its real detections into the same Incident Graph / Evidence Confidence / Rule / Risk / Authority-routing pipeline as every other observation (`visionOverride` in `lib/services/observationPipeline.ts`) — a Road Patrol detection becomes a first-class, fully-audited incident, not a side feature.

---

## Architecture

**Single-stack Next.js/TypeScript**, chosen over a split FastAPI+Postgres/PostGIS stack so the entire application runs from one `npm install && npm run dev` — see the note in `docs/differentiation.md` and the scope conversation captured in this repo's history for why. The adapter interfaces (`DataProvider`/`AuthorityProvider`/`MapProvider`/`RuleProvider` equivalents — see `lib/services/*`) are written so a Postgres/PostGIS + FastAPI backend could be swapped in without changing call sites.

```
app/                      Next.js App Router — pages (dashboard route group) + API routes
  (auth)/login/
  (dashboard)/             overview, incidents, map, evidence, hotspots, resolution, authorities, analytics, settings, report
  api/                     REST endpoints (see API section)
components/
  ui/                      shadcn-style primitives (Radix + Tailwind + CVA)
  domain/                  product components: city map, evidence timeline, confidence breakdown, risk/status badges
  layout/                  header, sidebar, mobile nav, page shell
lib/
  engines/                 the differentiated logic — pure, unit-tested, framework-free
    correlation.ts          Incident Graph
    confidence.ts           Evidence Confidence Engine
    rules.ts                 Context/Rule Engine
    risk.ts                  Risk Intelligence
    resolution.ts            Resolution Verification Engine
    hotspot.ts                Recurring Incident Engine
    authority.ts              Authority Resolution Engine + feedback learning
  ai/vision.ts             DEMO vision inference stub (deterministic, clearly labeled, swappable)
  services/                Prisma-backed orchestration around the engines
  realtime/bus.ts          in-process pub/sub, exposed over SSE at /api/stream
  auth.ts                  session (JWT cookie) + RBAC helpers
  geo.ts                   geospatial helpers (haversine, point-in-polygon) — PostGIS stand-in
prisma/
  schema.prisma            full relational schema (Postgres; see note below)
  seed.ts                  deterministic demo dataset, built by calling the real pipeline
tests/
  engines/*.test.ts        Vitest unit tests for every engine
  e2e/*.spec.ts            Playwright critical-flow tests
```

### Database

Hosted PostgreSQL via Prisma (Neon, Vercel Postgres, Supabase, etc. — any standard `postgres://` connection string works). Lifecycle/role/type columns are kept as plain strings rather than Prisma `enum` blocks so the schema stays engine-portable, with the allowed values enforced in `lib/types.ts` and each route's Zod schema; geometries are GeoJSON text columns with spatial queries done in `lib/geo.ts` rather than PostGIS `ST_*` functions.

Evidence media (uploaded photos/videos) is stored in Vercel Blob when `BLOB_READ_WRITE_TOKEN` is set, or on local disk under `storage/uploads` otherwise — either way, the app only ever links to the session-gated, access-logged `/api/media/[filename]` proxy route (see `lib/api/media.ts`), never the raw storage location.

Tables: `users`, `observations`, `incidents`, `incident_observations` (the incident-graph edge table), `evidence`, `evidence_access_logs`, `vehicles`, `locations`, `road_segments`, `rules`, `authorities`, `authority_boundaries`, `routing_feedback` (the auditable authority-learning log), `submissions`, `submission_events`, `resolution_checks`, `hotspots`, `risk_scores`, `audit_logs`, `notifications`.

### Real-time layer

Server-Sent Events at `/api/stream` (the single-stack stand-in for WebSockets/Redis pub-sub). Every pipeline step — a new observation, a correlation decision, a risk recompute, a resolution check, a hotspot crossing its recurrence threshold — emits an event that the dashboard/map subscribe to and update live, no polling. A background **DEMO STREAM** (`lib/services/demoStream.ts`, gated by `ENABLE_DEMO_STREAM`) periodically feeds synthetic observations through the *real* pipeline so the realtime behavior is visible without a live sensor feed; every event it produces is tagged `demo: true` end to end and the UI never presents it as live government data.

### AI pipeline

`lib/ai/vision.ts` is a **deterministic, seeded inference stub** — not a trained model. It is not benchmarked and is not claimed to be accurate; every result carries `model`/`modelVersion`/`generatedAt`/`inputRef` and the UI renders a permanent "demo model" badge next to any AI output. It exists so the rest of the pipeline (correlation, confidence, rule gating, resolution comparison) has a stable, testable contract. Swapping in a real object-detection/scene-understanding model means implementing the same `VisionResult` contract against a real inference endpoint — no other module changes.

### Data mode

`DATA_MODE=demo` (default) uses the deterministic offline dataset seeded by `prisma/seed.ts`. Map tiles are real, live OpenStreetMap tiles (safe to call — no key, no fabrication). No government API is fabricated anywhere: `Authority.submissionMethod` is `"assisted_manual"` for every seeded authority (reflecting that no verified public complaint API was found for these departments), and the UI reports **"External submission unavailable"** rather than pretending a channel exists whenever routing can't resolve one. `DATA_MODE=live` is wired as a switch, but no live provider is implemented in this build — flipping it without adding one is intentionally a no-op that still falls back to the "unavailable" path, per the project's non-negotiable rule against fabricated integrations.

---

## API

All routes are under `/api`, return `{ ok: true, data }` or `{ ok: false, error, details? }`, validate input with Zod, and never leak stack traces. Selected endpoints:

| Method & path | Purpose |
|---|---|
| `POST /api/auth/login` / `logout` / `GET session` | Cookie-based session auth |
| `POST /api/observations` | Upload evidence (base64 JSON body — see note below) → runs the full pipeline (vision → correlate → rule → confidence → risk → route → hotspot) |
| `GET /api/observations` | List recent observations |
| `POST /api/patrol/detections` | AI Road Patrol: save a captured frame + real detections, reverse-geocode, and contract-match it |
| `GET /api/patrol/detections` | List recent patrol candidates |
| `POST /api/patrol/detections/:id/confirm` / `dismiss` | Turn a candidate into a real incident via the pipeline, or discard it |
| `GET /api/geocode/reverse?lat&lng` | Real, live OpenStreetMap Nominatim reverse geocoding (server-proxied, rate-limited) |
| `GET /api/contracts` | Road-contract registry (demo data) |
| `GET /api/incidents` | Filterable incident list (status, risk, type, authority, recurring, confidence, date range, bbox) |
| `GET /api/incidents/:id` | Full incident graph: observations, correlation factors, confidence breakdown, resolution checks, submissions, risk history, audit log |
| `POST /api/incidents/:id/submit` | Submit to the resolved authority (errors cleanly if none is available) |
| `POST /api/incidents/:id/verify` | Authority response: acknowledge / redirect / report action / close — feeds the routing feedback log |
| `POST /api/incidents/:id/resolution-check` | Independent AI re-verification ("Verify again") |
| `GET /api/hotspots` | Recurring-hotspot rollups |
| `GET /api/authorities` | Authority registry |
| `GET /api/authorities/resolve?lat&lng&incidentType` | Jurisdiction resolution with full decision trail |
| `GET /api/risk-map` | Map-ready incident + hotspot points |
| `GET /api/analytics` | Dashboard aggregates |
| `GET /api/stream` | SSE realtime feed |

**Why media uploads are JSON, not multipart**: Next.js 14.2's Route Handler `request.formData()` throws `TypeError: Failed to parse body as FormData` on this Node 22 / Windows dev-server combination — reproducibly, even in a bare-bones handler with no application logic. Rather than fight a framework-level parser bug, media-uploading endpoints accept a base64 `mediaBase64`/`mediaType` JSON body instead (`lib/api/media.ts`, `lib/client/api.ts`'s `blobToBase64`); this is a normal, well-supported pattern and avoids the bug entirely, at the cost of ~33% larger payloads for a single-photo/short-video capture — an acceptable trade at this scale.

---

## Security & privacy notes (demo scope)

- Passwords are bcrypt-hashed; sessions are httpOnly JWT cookies.
- Evidence media is served only to authenticated users, from a route that access-logs every view (`EvidenceAccessLog`).
- Vehicle identity defaults to a fingerprint hash, not a plate; a plate is only ever stored as a SHA-256 hash, never raw text.
- Faces are marked blurred (`Evidence.facesBlurred`) and evidence has a retention window (180 days in this demo).
- Input is validated with Zod on every mutating route; RBAC (`requireRole`) gates authority-only actions.
- `npm audit` reports some moderate/high findings in **dev-only** tooling (Vite/esbuild dev-server, eslint-config-next's transitive `glob`) — these do not affect the served app and are typical for a fast-moving Next 14 toolchain; run `npm audit fix` if you want to chase them, at the cost of breaking changes to `vitest`/`eslint-config-next`.
- This is a demo build, not a hardened production deployment — see `docs/differentiation.md` for what would need a real security review before any pilot.

---

## What's intentionally not built

Construction-violation reporting and helmet detection as a core feature are deliberately excluded — they're either out of scope for a road-safety evidence network or already well-served by existing enforcement systems (see differentiation doc §1-8). Pothole/road-surface damage was added back in as the AI Road Patrol flow (§9) at explicit user request, modeled on a specific real-world tool, and is differentiated by feeding into the same engines as everything else rather than existing as a standalone feature — see [AI Road Patrol](#ai-road-patrol--real-live-ai-detection-with-proof) above. No fabricated government API integrations exist anywhere in this codebase.
