# Wispex Work Copilot

A mobile-first PWA that helps a Data Prep Officer in customs clearance and international logistics
**prioritise work, manage deadlines and verify before submitting**. It is a planning and
decision-support assistant, not an autonomous customs decision-maker.

> **PROGRESS → VERIFY → REFER → ESCALATE → DOCUMENT → IMPROVE**
> Accuracy → Reliability → Independence → Trust. Never speed at the expense of accuracy.

The employee stays responsible for every decision and submission. The app only recommends, and it
always shows *why*.

---

## Status: MVP 1 to MVP 5 are complete

The spec asks for feature-by-feature delivery. MVP 1 (Work Management), MVP 2 (Performance), MVP 3
(Document Intelligence), MVP 4 (AI Copilot) and MVP 5 (Advanced Automation) are implemented and tested. Integrations that need
configuration are labelled **Integration Required**. There are no buttons that pretend to work.

| Area | Status |
|---|---|
| Authentication (email + password, httpOnly session cookie, CSRF protection, rate limiting) | ✅ Done |
| Dashboard with deadline alerts, workload risk and “Needs attention” | ✅ Done |
| Task Inbox (search with debounce, filters, sort, server-side pagination) | ✅ Done |
| Priority engine (backend, configurable weights, reasons + factor breakdown) | ✅ Done |
| ETA + deadline engine (SAFE / WATCH / URGENT / CRITICAL / OVERDUE, early warning, timezone aware) | ✅ Done |
| Live countdowns | ✅ Done |
| Daily planner (dynamic queue, projected times, at-risk detection, shift aware, overnight shifts) | ✅ Done |
| “What should I work on now?” with explanation and missing-document follow-up | ✅ Done |
| Task status workflow with verification gate before completion | ✅ Done |
| Guidance status model 🟢 🟡 🟠 🔴 ⚫ | ✅ Done |
| Focus mode | ✅ Done |
| Google Calendar (OAuth 2.0, idempotent create / update / delete, sync status) | ✅ Built, **Integration Required** (needs your Google OAuth client) |
| `.ics` calendar export with reminders (works without any integration) | ✅ Done |
| In-app + browser deadline notifications (configurable, de-duplicated) | ✅ Done |
| Personal audit trail (append-only) | ✅ Done |
| PWA (manifest, icons, service worker, offline page) | ✅ Done |
| Demo mode with fictional data | ✅ Done |
| Account + data deletion | ✅ Done |
| **MVP 2:** Report an Error workflow (11 steps, ordered, never deletable) | ✅ Done |
| **MVP 2:** Error analytics (rate, categories, severity, root causes, correction time, 8-week trend) | ✅ Done |
| **MVP 2:** Recurring-error detection with suggestions (never changes anything automatically) | ✅ Done |
| **MVP 2:** Daily log / end-of-shift review and weekly review (calculated numbers + your reflection) | ✅ Done |
| **MVP 2:** Learning tracker, feedback log, skill matrix with level history | ✅ Done |
| **MVP 2:** Personal Reliability Indicators (evidence per indicator, no overall score) | ✅ Done |
| **MVP 2:** 30 / 60 / 90 day development plan with goals and recorded evidence per phase | ✅ Done |
| **MVP 3:** Upload (PDF/JPG/PNG, type from file bytes, SHA-256 duplicate detection, progress + cancel, batch) | ✅ Done |
| **MVP 3:** Encrypted local storage + Supabase Storage adapter | ✅ Done |
| **MVP 3:** Claude document reading (vision/PDF, structured JSON output, background processing) | ✅ Built, **Integration Required** (needs `AI_PROVIDER=anthropic` + API key + user confirmation) |
| **MVP 3:** Per-field confidence, deterministic validation rules, manual review queue | ✅ Done |
| **MVP 3:** Cross-document comparison and discrepancy workflow (linked to task issues) | ✅ Done |
| **MVP 3:** Document versions (never "newest wins") with change view | ✅ Done |
| **MVP 3:** Configurable final checklist required before completing a task | ✅ Done |
| **MVP 4:** Personal knowledge base with local search (notes, learning notes, answered questions, resolved errors) | ✅ Done |
| **MVP 4:** Search by meaning (local embedding model, hybrid with keywords, keyword fallback) | ✅ Done |
| **MVP 4:** Answers only from retrieved sources, with citations ("No reliable source found" otherwise) | ✅ Done, AI answer is **Integration Required** (sources are always shown) |
| **MVP 4:** “I'm not sure” assistant: knowledge first, escalation recommendation, precise question draft | ✅ Done |
| **MVP 4:** Clarifications and escalations linked to task issues, answers saved as knowledge | ✅ Done |
| **MVP 4:** Communication drafts (6 types), copy and send yourself, optional AI rewording that keeps every fact | ✅ Done |
| **MVP 4:** Error analysis and adaptive personal checklist (added only after confirmation) | ✅ Done |
| **MVP 5:** Workload forecast per working day (deadlines, personal estimate accuracy, typical load, shift) | ✅ Done |
| **MVP 5:** Pattern detection and process improvement suggestions (dismiss or add to learning) | ✅ Done |
| **MVP 5:** Patterns per named client, only after explicit permission | ✅ Done |
| **MVP 5:** Advanced analytics (weekly throughput, on-time rate, estimate vs actual, issues, weekday load) | ✅ Done |
| **MVP 5:** Approved email sending (SMTP) of reviewed drafts, approval per message | ✅ Built, **Integration Required** (needs `EMAIL_PROVIDER=smtp` + server) |
| **MVP 5:** Approved team channel posting (Slack / Google Chat incoming webhook), approval per message | ✅ Built, **Integration Required** (needs `TEAM_WEBHOOK_URL`) |

---

## Architecture

```text
Browser (mobile / desktop)
      │  same origin, httpOnly cookie
      ▼
Next.js 15 PWA  ── /api/* rewrite ──►  FastAPI
(TypeScript, Tailwind, SWR)             │
                                        ├── Priority engine   (services/priority_service.py)
                                        ├── Deadline rules    (rules/deadline_rules.py)
                                        ├── Daily planner     (services/planner_service.py)
                                        ├── Calendar service  (services/calendar_service.py → integrations/google_calendar.py)
                                        ├── Audit log         (services/audit_service.py)
                                        ▼
                                  PostgreSQL (Supabase) · SQLite for local dev
```

Why the API is proxied through Next.js: the session cookie stays first-party (`SameSite=Lax`,
`HttpOnly`), the browser never sees API secrets, and CORS stays closed.

Business logic (priority, deadlines, planning, completion rules) lives in the backend. The frontend only
displays it. Only the ticking of countdowns is computed in the browser.

```text
backend/app
├── api/           auth, tasks, planner (+ notifications), settings, calendar, audit, demo,
│                  errors, reviews, learning, growth
├── core/          config (env vars), database, security (hashing, JWT, CSRF, rate limit, encryption)
├── models/        users, user_settings, clients, shipments, tasks, calendar_*, audit_logs
├── rules/         deadline_rules.py (deterministic)
├── services/      priority, planner, task, calendar, audit, settings, error, review, growth
├── integrations/  google_calendar.py (OAuth + REST, swappable)
└── demo/          fictional seed data

frontend
├── app/(app)/     dashboard, tasks, planner, focus, documents, assistant, calendar, settings, activity,
│                  reviews, errors, learning, growth, more, …
├── app/login/
├── components/    ui, navigation, task, forms, assistant
├── features/      task-management, daily-planner, performance (data hooks)
├── lib/           api client, hooks, time/timezone utils, labels
└── public/        sw.js, offline.html, icons
```

### How priority is calculated

Each factor adds up to a configurable maximum. The total is scaled to 0–100.

| Factor | Default max | Notes |
|---|---|---|
| Deadline proximity | 40 | Uses *slack* = time remaining − estimated processing time |
| ETA proximity | 15 | ETA passed, within 4h, within 12h … |
| Open issues | 15 | Issues you recorded (mismatch, low confidence, …) |
| Missing documents | 10 | Share of required documents not received |
| Client priority | 10 | Only if *you* set it. Not an official SLA |
| Processing time | 5 | Long tasks should start earlier |
| Task age | 5 | Open for more than 24h / 48h |

Levels: Critical ≥ 70, High ≥ 50, Medium ≥ 30. A task inside the critical deadline window is always
Critical, and Critical always sorts above High. Every task shows its reasons and a factor breakdown.
All weights and deadline thresholds are **personal settings, never presented as company policy**.

### MVP 2: performance and growth

- **Report an Error** follows the spec's 11 steps. The status can only move forward in order:
  `REPORTED → NOTIFIED → CORRECTING → RESOLVED`, and each step requires its record (who was notified,
  the correction, the resolution). Reporting requires the "stop and verify" confirmation. There is no
  delete endpoint: an error report can be corrected or resolved, never hidden.
- **Recurring patterns**: 3 or more errors on the same field (or category) within 14 days produce a
  suggestion such as *"You have encountered three weight-related errors in the last 14 days. Consider
  adding an explicit weight verification step to your personal checklist."* Nothing changes unless the
  user chooses to add it as a learning item. Official SOP is never modified.
- **Reviews** count completed tasks, on-time rate, errors, discrepancies (issues now carry timestamps),
  escalations, average processing time, learning completed and feedback applied, for a local day or
  week. Today's review adds pending/critical work and tomorrow's priorities from the planner.
- **Personal Reliability Indicators** show the evidence behind each value (e.g. "54 of 60 tasks with a
  deadline were completed before it"). "Questions asked clearly" counts questions recorded through the
  MVP 4 assistant that were linked to a task and included evidence. Escalating when needed is never counted against the user.
- **30 / 60 / 90**: Understanding, Consistency, Independence and reliability. Default goals can be
  ticked with written evidence, and each phase shows the work actually recorded in that period.

### MVP 3: document intelligence

```text
UPLOAD → FILE VALIDATION → ENCRYPTED STORAGE → (if permitted) CLAUDE: CLASSIFY + EXTRACT
→ CONFIDENCE SCORING → DETERMINISTIC RULES → CROSS-DOCUMENT CHECK → DISCREPANCIES → HUMAN REVIEW
```

- **Nothing is sent to an AI provider unless** the server has one configured (`AI_PROVIDER=anthropic`)
  **and** the user confirmed in Settings that their organization permits it. Demo accounts never send
  uploads to AI. Without AI, documents are stored and the same fields are entered by hand.
- **Claude adapter** (`app/ai/claude_provider.py`): `claude-opus-5` by default (`AI_MODEL`), the PDF or
  image is sent as a document/image block, and the answer is constrained to a JSON schema
  (`output_config.format`). Server-side `fallbacks: "default"` handles safety-classifier refusals;
  a remaining refusal, truncation or malformed output never becomes data: the document goes to review.
  The prompt tells the model to treat document text as data and ignore instructions inside it.
- The rest of the app only talks to the `AIProvider` interface (`app/ai/provider.py`), so the vendor or
  model can change. `AI_PROVIDER=fake` is a deterministic stand-in for development and tests and is
  refused in production.
- **Deterministic rules** (`app/rules/document_rules.py`) check required fields per document type,
  numbers, dates, ISO currency codes, weight units and net ≤ gross. Fields below your confidence
  threshold or failing a rule go to the **review queue**. A person confirms or corrects each value; values
  a person verified are never overwritten by a later AI reading.
- **Cross-document check** (`app/rules/discrepancy_rules.py`) compares quantity, net/gross weight (with
  unit conversion and an optional personal tolerance), invoice number, description, consignee and
  shipment reference across Invoice, Packing List and BL/AWB. Each potential mismatch shows both values,
  the difference, confidence, impact and a neutral recommended action. **It never says which document is
  correct.** Mismatches are added to the linked task as issues (which blocks completion) and closing one
  requires a written note.
- **Versions**: when a second version of a document type arrives for a shipment, no version is active
  until the user chooses one. Changes between versions are shown field by field.
- **Fictional sample PDFs** can be downloaded on the upload page to try the whole flow.

### MVP 4: AI copilot

```text
QUESTION → LOCAL HYBRID SEARCH (keywords + meaning, on the server) → SOURCES → (if permitted) CLAUDE ANSWERS FROM THOSE SOURCES
→ CITATIONS CHECKED → ANSWER + SOURCES, or "No reliable source found. Please verify with the appropriate person."
```

- **Knowledge base** (`/knowledge`): training notes, SOP references, document explanations, terminology,
  resolved questions, lessons, common mistakes, procedures and senior notes. A note is marked
  *confirmed* only when the user checked it against an official source or with a senior.
- **Search never leaves the server** (`app/services/knowledge_service.py`). It also covers learning notes,
  answered questions and resolved errors, shown in the knowledge-first order: training, SOP, personal
  notes, resolved cases, senior notes.
- **Search by meaning** (`app/ai/embeddings.py`): a small embedding model (`all-MiniLM-L6-v2`, about
  90 MB, ONNX via fastembed, no GPU) runs inside the API process, so no knowledge text is sent anywhere
  and no AI permission is needed. A source counts if it covers at least half of the question's words
  **or** is close enough in meaning (cosine similarity ≥ 0.30, and near the best match). Ranking is
  meaning similarity plus a bonus for shared words. Vectors are cached per source and recomputed only
  when the text changes. Results found only by meaning are labelled *Similar meaning*.
  The model loads in the background. Until it is ready, or if it cannot load, search uses keywords only
  and the page says so. Example: "Is the heavier figure with the boxes?" finds the note "Gross weight
  includes packaging", while "What time is lunch?" still returns *No reliable source found*.
- **AI answers** use `answer_knowledge_question` on the `AIProvider`. Claude gets only the retrieved
  sources, must cite them, and must say when they are not enough. An answer that cites a source that was
  not provided, or none at all, is discarded. Without permission the user sees the sources only.
- **“I'm not sure”** (`/assistant/unsure`) collects task, field, issue, evidence and impact, searches
  knowledge first and gives a conservative recommendation (`app/rules/escalation_rules.py`): *verify
  first*, *ask a precise question*, or *consider escalating* only when uncertainty meets a close deadline
  or a stated compliance or financial impact. The question follows
  Context → Specific issue → Evidence → Deadline → Question and is editable.
- **Clarifications**: recording a question or escalation adds an open issue to the task (so it cannot be
  completed silently). Recording the answer closes it, adds it to the task notes and can save it to the
  knowledge base.
- **Communication drafts** (`/assistant/drafts`): clarification, missing documents, discrepancy,
  escalation, correction and status update, built from the user's own records (no AI needed). The app
  never sends anything: the user copies the text, sends it and can mark it as "sent by me".
- **AI rewording** is optional and separate from document AI permission. After rewording, every number,
  reference, date and time is compared with the original. If anything changed, the original is kept.
- **Error analysis** summarises the last 30 days. Recurring patterns become checklist suggestions that
  are added to the personal final checklist only after the user reviews (and can edit) them.

### MVP 5: advanced automation

All of it is calculated from the user's own records with simple rules that are shown on screen.
Nothing changes tasks, settings or assignments (`app/services/analytics_service.py`).

- **Workload forecast** (`/insights`, Workload): for the next 5 working days, expected work is the larger
  of the tasks already due that day and a typical day of that weekday (last 8 weeks), compared with the
  shift. Task estimates are scaled by how long the user's tasks really take (median of actual ÷
  estimate, per transport mode, from at least 5 tasks). Overdue work lands on today. Tasks without a
  deadline are counted separately. Advice mentions asking for support early; work is never reassigned.
- **Patterns** (`/insights`, Patterns): estimate gaps per transport mode, how often documents are missing,
  the most common discrepancy type, errors near the end of the shift and the busiest weekday. No
  conclusion is drawn from fewer than 5 tasks. Each pattern shows its evidence and a suggestion that can
  be dismissed or added to the learning tracker.
- **Per-client patterns** (late documents, frequent discrepancies, deadlines harder to meet per named
  client) appear only after the user confirms in Settings that their organization permits it.
- **Approved sending**: a saved draft can be sent by email (organization SMTP server) or posted to the team
  channel (incoming webhook), only when the server is configured, the user confirmed the policy in
  Settings, and the user reviews and approves that specific message. A draft is sent at most once
  (database lock), a failed delivery leaves it as a draft, and the audit log keeps only the number of
  recipients and their domains. Demo accounts can never send. Without configuration the UI shows
  **Integration Required** and the copy-and-send-yourself flow stays available.
- Personal WhatsApp is never automated. An official messaging API (e.g. WhatsApp Business) is not included.

### Safeguards that are enforced, not just displayed

- A task cannot be completed while required documents are missing or issues are open.
- Completing requires an explicit “I verified…” confirmation.
- Resolving an issue requires writing down how it was resolved (added to the notes with a timestamp).
- Escalating or holding requires a note (who / why).
- Error reports follow the workflow in order and cannot be deleted.
- Completing a task requires every item of the personal final checklist (editable in Settings).
- Documents go to an AI provider only with server configuration **and** the user's explicit confirmation.
- Notes and draft text go to an AI provider only with a separate explicit confirmation. Demo accounts never use AI.
- AI answers must cite retrieved sources, and AI rewording must keep every number and reference.
- The app never decides which document is correct.
- Work is never reassigned automatically. Messages are never sent automatically: sending from the app
  needs server configuration, a policy confirmation and the user's approval of each message.
- Per-client patterns need an explicit policy confirmation.

---

## Running locally

Requirements: Python 3.11+, Node 20+.

```bash
# 1. Backend
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
cp .env.example .env            # set JWT_SECRET at minimum
uvicorn app.main:app --reload --port 8000

# 2. Frontend (new terminal)
cd frontend
cp .env.example .env.local      # BACKEND_URL=http://localhost:8000
npm install
npm run dev
```

Open http://localhost:3000 and choose **Try the demo (fictional data)**, or create an account.
API docs (development only): http://localhost:8000/api/docs

To test the PWA install flow and the service worker, use a production build: `npm run build && npm start`.

### Running the tests

```bash
cd backend && pytest -q                 # 134 tests (+1 real-model test with WISPEX_EMBEDDING_MODEL_PATH): rules, priority, planner, auth, authorization, tasks, calendar
                                        # (mocked Google), error workflow, reviews, learning, growth, documents,
                                        # knowledge search (keyword + meaning), assistant, drafts, escalation rules,
                                        # forecast, patterns, approved sending (fake SMTP / mocked webhook),
                                        # Claude adapter (stub client), Supabase adapter (mocked HTTP)
cd frontend && npm test                 # unit tests (countdown, timezone conversion)
cd frontend && npm run lint && npm run typecheck

# End-to-end (mobile + desktop viewports). Start the backend with AI_PROVIDER=fake and
# DEMO_RATE_LIMIT_PER_MINUTE=200 (the suite opens more than 30 demo sessions a minute), and
# `npm run build && npm start` first. The email test runs only when the backend has an SMTP server,
# e.g. a local sink: `python -m smtpd -n -c DebuggingServer 127.0.0.1:1025` (Python 3.11) with
# EMAIL_PROVIDER=smtp SMTP_HOST=127.0.0.1 SMTP_PORT=1025 SMTP_STARTTLS=false EMAIL_FROM=wispex@example.com.
cd frontend && npx playwright test
```

CI (`.github/workflows/ci.yml`) runs lint, type checks, unit tests and the production build on every push.

---

## Configuration

All secrets come from environment variables. See `backend/.env.example` and `frontend/.env.example`.
Nothing secret is ever sent to the browser.

| Variable | Where | Purpose |
|---|---|---|
| `DATABASE_URL` | backend | `postgresql+psycopg://…` for Supabase. Defaults to local SQLite |
| `JWT_SECRET` | backend | Session signing key. **Required in production** |
| `COOKIE_SECURE` | backend | `true` in staging / production (HTTPS) |
| `ENCRYPTION_KEY` | backend | Fernet key for OAuth tokens at rest. **Required in production** |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` | backend | Enables Google Calendar sync |
| `FRONTEND_URL` | backend | Where the OAuth callback redirects back to |
| `DEMO_MODE_ENABLED` | backend | Set `false` in production if demo accounts are not wanted |
| `AI_PROVIDER` / `AI_API_KEY` / `AI_MODEL` | backend | `anthropic` enables Claude document reading and assistant answers. Key falls back to `ANTHROPIC_API_KEY` |
| `STORAGE_BACKEND` / `STORAGE_DIR` | backend | `local` (encrypted files) or `supabase` |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_BUCKET` | backend | Private Supabase Storage bucket (server side only) |
| `SEMANTIC_SEARCH` / `EMBEDDING_MODEL` / `EMBEDDING_MODEL_PATH` / `EMBEDDING_CACHE_DIR` | backend | Local search by meaning (`local` or `off`). Model downloads on first use, or pre-download with `python -m app.ai.embeddings download` |
| `EMAIL_PROVIDER` / `SMTP_HOST` / `SMTP_PORT` / `SMTP_USERNAME` / `SMTP_PASSWORD` / `SMTP_STARTTLS` / `EMAIL_FROM` | backend | `smtp` enables approved email sending through the organization's mail server |
| `TEAM_WEBHOOK_URL` / `TEAM_CHANNEL_NAME` | backend | HTTPS incoming webhook of the team channel (Slack or Google Chat format) |
| `DEMO_RATE_LIMIT_PER_MINUTE` | backend | Demo sessions per minute per address (default 30) |
| `BACKEND_URL` | frontend (server only) | Where Next.js forwards `/api/*` |

The default timezone is `Asia/Jakarta`. Each user can change timezone and shift in Settings.

### Enabling Google Calendar

1. Only after your organization authorizes it: create an OAuth client (type *Web application*) in Google Cloud.
2. Add the redirect URI `https://<your-frontend>/api/calendar/google/callback`.
3. Set the three `GOOGLE_*` variables on the backend and restart.
4. In the app: **Calendar → Connect Google Calendar**.

Only the `calendar.events` scope is requested. Events are created with a deterministic ID per task, so
retries never create duplicates. Changing a deadline marks the event *out of date* until you update it.
Without Google, every reminder can be downloaded as an `.ics` file (with the same reminders).

---

## Deployment

| Part | Suggested |
|---|---|
| Frontend | Vercel (`BACKEND_URL` = backend URL) |
| Backend | Render / Railway / Cloud Run (`uvicorn app.main:app --host 0.0.0.0 --port $PORT`) |
| Database | Supabase PostgreSQL |

Use separate development, staging and production environments. Never develop against production data.

**Vercel checklist.** Vercel runs only the Next.js frontend. The FastAPI backend must be deployed
separately, and the frontend forwards every `/api/*` request to it:

1. Vercel project: *Root Directory* `frontend`.
2. Vercel → Settings → Environment Variables: `BACKEND_URL=https://<your-backend>` (then redeploy).
   Without it sign-in, the demo and all data fail ("The server is not reachable right now").
3. Backend: `FRONTEND_URL=https://<your-app>.vercel.app`, `COOKIE_SECURE=true`, and a persistent
   `DATABASE_URL` (Supabase PostgreSQL). SQLite on most hosts is wiped on every restart.

### Enabling "Continue with Google"

1. Google Cloud Console → APIs & Services → Credentials → *Create OAuth client ID* → Web application.
2. Authorized redirect URI: `https://<your-app>.vercel.app/api/auth/google/callback`
   (for local development also `http://localhost:3000/api/auth/google/callback`).
3. OAuth consent screen: scopes `openid`, `email`, `profile` only.
4. Backend env: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `FRONTEND_URL` (the redirect URI is derived
   from it, or set `GOOGLE_LOGIN_REDIRECT_URI`). The login page shows the button only when this is set.

The flow is OpenID Connect with PKCE, a one-time `state` and `nonce` in a short signed cookie, and only
verified Google email addresses. A Google sign-in never attaches itself to an existing password account
with the same email (someone could have registered that address without owning it): the user is asked
to sign in with the password instead.

Production checklist: `APP_ENV=production`, strong `JWT_SECRET`, `ENCRYPTION_KEY`, `COOKIE_SECURE=true`,
HTTPS everywhere, `DEMO_MODE_ENABLED=false` if not needed. In production the API docs are disabled and
the app refuses to start with development secrets.

---

## Security and privacy

- Passwords: PBKDF2-SHA256 (390k iterations, per-user salt).
- Sessions: signed JWT in an `HttpOnly`, `SameSite=Lax` cookie (`Secure` in production).
- CSRF: every state-changing request must carry a custom header that cross-site pages cannot add.
- Authorization: every query is scoped to the signed-in user. Another user's task returns 404.
- OAuth: one-time `state` bound to the signed-in user. Tokens are encrypted at rest (Fernet).
- Rate limiting on sign-in, registration and demo creation.
- Security headers on both apps (CSP, `X-Frame-Options: DENY`, `nosniff`, HSTS in production).
  API responses are `Cache-Control: no-store`.
- The service worker caches only static assets and the offline page. **API data is never cached.**
  When offline, the app says so and disables actions that change data instead of pretending to sync.
- The audit log stores actions and statuses only, never document content.
- Friendly error messages to users. Technical details stay in server logs.
- Demo mode uses fictional clients and shipments only. Demo accounts are deleted after 24 hours.
- Users can delete their account and all related data from Settings.

> ⚠️ Do not upload or enter confidential company or client information unless your organization's
> policy explicitly permits this application (and any AI provider) to process it.

## Known limitations and next steps

- The workload forecast only knows work that already exists and the user's own history. It cannot
  know about urgent work that has not arrived yet, and it is only as good as the recorded times.
- Email sending uses plain SMTP with STARTTLS. There is no inbox synchronisation, and delivery runs
  inside the request (no queue).

- Database tables are created at startup (`create_all`). New tables (like MVP 2's) are added
  automatically, but changed columns are not. Add Alembic migrations before the first production
  schema change.
- The rate limiter is in-memory (single instance). Use Redis when running several instances.
- Document processing runs in FastAPI background tasks inside the API process. That is fine for one
  server; for several servers or heavy volume, move it to a queue worker (e.g. RQ + Redis).
- Malware scanning of uploads is not included. Files are never executed or rendered by the server and are
  always downloaded as attachments, but add a scanner before accepting files from untrusted sources.
- Search by meaning uses a small English model, chosen because it is light and could be tested here.
  It handles paraphrases but not every case (for example "who receives the shipment" does not find a note
  about the consignee). For Indonesian notes, set `EMBEDDING_MODEL=sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2`
  (about 220 MB). Its similarity threshold (0.40) is an estimate: check it with your own notes first.
- The embedding model adds about 180 MB of memory to the API process (measured: 85 MB to 264 MB). On very small servers set
  `SEMANTIC_SEARCH=off` to keep keyword search only.
- The Claude integration is covered by tests with a stub client. It has not been run against the live
  API in this repository's CI, because that needs a real key and sends data to a provider.
