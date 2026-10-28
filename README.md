# GMS Hardware — Customer Credit Management System

A complete credit (debtors) management system for GMS Hardware: customers grouped by area, credit types,
limits and credit periods, automatic overdue interest, SMS / WhatsApp / Email messaging, a live dashboard,
11 reports and confidential owner reports.

Runs on **Vercel** (website) with a **Supabase** Postgres database (data storage), and can also run on a shop PC.
The code is split into a **backend** (Node.js + Express API) and a **frontend** (the web app, served and built
by Vite); see [Project layout](#project-layout).

## Set up Supabase

1. Create a project at [supabase.com](https://supabase.com) and keep the database password. The shop's project is
   in **Tokyo** (`ap-northeast-1`), and `vercel.json` runs the API in Vercel's Tokyo region (`hnd1`) next to it.
   If you create a project in another region, set `regions` in `vercel.json` to the nearest Vercel region.
2. Click **Connect** and copy the **Transaction pooler** connection string (port 6543), with your database
   password in place of `[YOUR-PASSWORD]`. This is your `DATABASE_URL`.
   Don't use the **Direct connection** (`db.<project>.supabase.co`): it needs IPv6, which Vercel doesn't have.
3. Optional, for a fully verified connection: *Database settings → SSL Configuration → Download certificate*,
   and put the certificate in `DATABASE_CA_CERT` (see `backend/.env.example`). Without it the connection is
   still encrypted.

The app creates its tables, default settings and logins by itself the first time it starts. It also turns on
row level security for all of them, so Supabase's public Data API cannot read or change them; the app itself
is not affected.

Instead of copying the connection string you can connect Supabase through Vercel's Supabase integration: it sets
`POSTGRES_URL`, which the app uses when `DATABASE_URL` is not set.

## Run on this PC

Requirements: Node.js 24.

```bash
npm install                                # first time only (installs the backend and the frontend)
copy backend\.env.example backend\.env     # then put your Supabase DATABASE_URL in backend\.env
npm run demo                               # optional: sample areas, 42 customers, 10 months of history (empty database only)
npm start                                  # → http://localhost:3000 (the API itself runs on http://localhost:4000)
```

On Windows you can double-click **start.bat**. While changing the code, use `npm run dev` instead of `npm start`:
the API then restarts by itself whenever a backend file changes.

First login: `owner / owner123` (full access) or `staff / staff123`. **Change both passwords** (click your
name at the bottom-left), or add your own users in *Users & Security*.

## Deploy to Vercel

1. Push this folder to a GitHub repository (`backend/.env` is git-ignored, so the password stays private).
2. In Vercel: **Add New → Project → Import** the repository. Leave the framework and build settings empty:
   `vercel.json` sets them for each service.
3. Under **Environment Variables** add:
   - `DATABASE_URL`: the Supabase connection string (same as in `backend/.env`)
   - `APP_TIMEZONE`: `Asia/Colombo`
   - `CRON_SECRET`: any long random text
4. Click **Deploy**. Every later `git push` redeploys automatically.

`vercel.json` deploys the repository as one Vercel project with two [services](https://vercel.com/docs/services)
on the same domain:

- **frontend** (`frontend/`, Vite): the website, for every path except `/api/...`.
- **backend** (`backend/`, Express): `backend/src/app.js` as a Vercel Function, for every `/api/...` request.

The frontend only calls the backend from the browser through `/api/...`, so the services need no bindings.
Functions run in Vercel's Tokyo region (`hnd1`, next to the Supabase database), and Vercel Cron calls `/api/cron` for
the daily job (interest, due reminders, overdue notices) at 01:00 Sri Lanka time. Managers can also run it any
time from *Overdue & Follow-up → Run interest & reminders*.

## Move existing data from Neon (one time)

1. Create the Supabase project as above and leave it empty.
2. In `backend/.env`, set `DATABASE_URL` to the Supabase connection string and add `SOURCE_DATABASE_URL` with
   the Neon connection string (from Vercel → Settings → Environment Variables, or the Neon console).
3. Run `npm run copy-db`. It copies every user, setting, template, area, credit type, customer, entry, message
   and audit record in one go, then prints the row counts and entry totals of both databases, which should
   match. It refuses to run if the Supabase database already has customers or entries.
4. In Vercel, replace `DATABASE_URL` with the Supabase connection string and redeploy.
5. Remove `SOURCE_DATABASE_URL` from `backend/.env`.

Do steps 3 and 4 when nobody is using the app, so no new entries go into Neon after the copy. Everyone signs in
again afterwards with their usual username and password.

## How credit works

| Concept | Behaviour |
|---|---|
| **Area** | Every customer belongs to an area (town / route), with a collector and collection day. Lists, reports and bulk messages can be filtered by area. |
| **Credit type** | e.g. Regular, Contractor, Wholesale, Cheque. Each has a default credit limit, credit period and optional own interest rate. |
| **Credit limit / period** | Set per customer (pre-filled from the credit type). A credit sale that would exceed the limit, or for a customer who is already overdue, needs manager/owner approval. Blocked customers cannot take credit. |
| **Due date** | Bill date + the customer's credit period (can be changed per bill). |
| **Overdue interest** | Once a bill passes its due date, **1%** of its unpaid amount is added as an interest entry, and another 1% every **30 days** it stays unpaid. Rate, cycle and grace days are in *Settings → Interest & credit*; a credit type can have its own rate; interest can be switched off per customer. |
| **Payments** | Applied automatically to the oldest open bills first (FIFO). Overpayments stay as advance credit. |
| **Voids** | Managers/owner can void any entry with a reason; balances are recalculated and the void appears in owner reports and the audit trail. |

## Messaging

Configure in *Settings*:

- **SMS**: Notify.lk, Text.lk, or any HTTP SMS gateway (URL template with `{to}` and `{message}`).
- **WhatsApp**: *Click-to-chat* works immediately with no setup (opens WhatsApp with the message ready);
  or the *WhatsApp Business Cloud API* to send automatically.
- **Email**: any SMTP server (e.g. Gmail with an app password).

Automatic messages: new credit bill, payment receipt, due-date reminder, overdue notices (repeating), and
interest charged. All templates are editable with placeholders like `{name}`, `{balance}`, `{overdue}`, `{due_date}`.

## Reports

Aging · Area-wise summary · Collections · Credit sales · Interest · Overdue customers · Credit limit usage ·
Customer statement · Day book · Customer directory by area · Credit type summary. Every report can be filtered,
printed / saved as PDF, and exported to Excel (CSV).

**Owner reports** (owner only): collection efficiency, days-sales-outstanding, overdue share, bad-debt risk,
12-month trends, area performance, credit-risk watch-list, top customers, staff performance, voids, messaging
stats and the full audit trail.

## Roles

- **Owner**: everything, incl. owner reports, settings, users, deleting customers and backups.
- **Manager**: edit customers, void entries, adjustments, approve over-limit credit, areas, credit types, templates.
- **Staff**: add customers (on their credit type's standard terms), record credit sales & payments, send messages, view reports.

## Data & backup

All data lives in the Supabase database (the dashboard's *Table Editor* shows it). *Settings → Backup* (owner)
downloads a JSON copy of every table. Supabase also keeps backups, depending on your plan (*Database → Backups*).

## Project layout

```
backend/                 the API: Node.js + Express + PostgreSQL (own package.json and .env)
  src/app.js             API routes, reports, owner analytics
  src/db.js              Postgres pool, schema, seed data
  src/ledger.js          balances, FIFO allocation, interest engine
  src/messaging.js       SMS / WhatsApp / Email + automation
  src/server.js          local API server (port 4000)
  src/demo.js            sample data loader
  src/copy-db.js         one-time copy from another database, e.g. Neon (npm run copy-db)
frontend/                the web app: plain HTML, CSS and JavaScript (own package.json)
  index.html             page shell
  public/css, public/js  styles, app shell and one script per screen
  public/vendor          Chart.js
  vite.config.js         dev server on port 3000; forwards /api to the backend
vercel.json              Vercel: the two services, their public paths, region and daily cron
package.json             npm workspaces and the start / dev / build / demo scripts
```

The frontend talks to the backend only through `/api/...` requests, so each side can be changed on its own.
