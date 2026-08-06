# Deploying DamnLease

**Live:** https://damnlease.com — production tracks the
`claude/homefinder-nyc-tracker-pst66m` branch, so every push there deploys.

**GitHub Pages will not work.** It serves static files only, and this app needs
a server: the RealtyAPI key and the Supabase service-role key must stay
server-side, and scraping runs in a scheduled route. Vercel is the natural home
(same people as Next.js, free tier is enough) — Netlify or Fly work too.

## 1. Supabase

Apply the migrations in `supabase/migrations/` in order, via the SQL editor or
`supabase db push`. Then in the dashboard:

- **Authentication → Providers → Email**: on. Leave "Confirm email" enabled.
- **Authentication → URL Configuration**: set *Site URL* to your deployed URL
  and add `https://<your-app>/auth/confirm` to *Redirect URLs*. Without this the
  confirmation link in the signup email bounces to localhost.
- **Project Settings → API Keys**: copy the `service_role` key for the env vars
  below. Treat it like a password — it bypasses every row-level security policy.

A note on email: Supabase's built-in sender is rate-limited to a handful of
messages per hour and often lands in spam. Fine for you and a few friends; if
you hand the URL out more widely, add a real SMTP provider under
**Authentication → Emails → SMTP Settings**.

## 2. Vercel

```bash
npm i -g vercel
vercel link          # once, in this directory
vercel env add NEXT_PUBLIC_SUPABASE_URL
vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY
vercel env add SUPABASE_SERVICE_ROLE_KEY
vercel env add REALTYAPI_KEY
vercel env add CRON_SECRET
vercel --prod
```

Or import the repo at vercel.com/new and paste the same five variables into
Project Settings → Environment Variables. The build needs no special config;
`vercel.json` already schedules the scraper.

## 3. Scheduled polling

`vercel.json` calls `GET /api/cron/poll` every 30 minutes. The route requires
`Authorization: Bearer $CRON_SECRET`, so set that variable before the first run
or every invocation returns 401.

Mind the request budget: a poll costs about five RealtyAPI requests in wide
mode, and the free tier allows 250 a month. Every 30 minutes would spend that in
under two days. **Change the cron to once or twice daily** unless you're on a
paid plan — edit the `schedule` in `vercel.json`:

```json
{ "crons": [{ "path": "/api/cron/poll", "schedule": "0 9,18 * * *" }] }
```

The sidebar shows usage against the limit, and polls fail with "out of credits"
rather than silently reporting no new listings.

## Redeploying

There is no "redeploy" button for a project that has never built — Vercel needs
a push to the production branch. Any commit does it; an empty one is enough:

```bash
git commit --allow-empty -m "trigger deploy" && git push
```

This matters more than it sounds: `NEXT_PUBLIC_*` variables are inlined at
**build** time, not read at runtime. Adding them in the dashboard after a build
has no effect until something triggers a new one.

## 4. First run

1. Open the deployed URL, create an account, confirm the email.
2. Setup asks which neighborhoods you want — nothing is hardcoded.
3. Hit **Check for new** to fill the database.

The first account to sign up inherits any data created in solo mode, so a search
built before auth was added isn't lost.

## Sharing it

Send someone the URL. They sign up, pick their own neighborhoods, and get their
own pipeline, notes and ranking. Listing data is shared — two people watching
Bushwick cost one scrape, not two — while everything personal is scoped to its
owner by row-level security, enforced by the database rather than the app.
