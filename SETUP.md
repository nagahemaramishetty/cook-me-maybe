# Cook Me Maybe: Setup Guide

Track your vegetables and get a push notification every morning, starting 4 days before
each one goes bad, until you mark it **Cooked ✓**.

**Cost: $0.** Everything below runs on free tiers.

## What you need (free accounts)

| Account | What it's for |
|---|---|
| [GitHub](https://github.com) | Stores your code |
| [Supabase](https://supabase.com) | Login, database, and the daily reminder job |
| [Vercel](https://vercel.com) | Hosts the website (sign up with GitHub) |
| Node.js on your laptop ([nodejs.org](https://nodejs.org), LTS) | Generating keys and running the app locally |

Total time: about 30–45 minutes.

---

## Step 1: Create the Supabase project

1. Go to supabase.com, then **New project**. Pick any name (e.g. `cook-me-maybe`), set a database password, and choose the region closest to you (US East).
2. When it finishes, open **Project Settings → API Keys** (or click **Connect** at the top) and copy:
   - **Project URL**, like `https://abcd1234.supabase.co`
   - **anon / publishable key**. This one is safe to put in the website.
   - Don't copy the *service_role / secret* key anywhere. The reminder function gets it automatically.

## Step 2: Create the tables

1. Supabase, then **SQL Editor → New query**.
2. Paste everything from `supabase/1_schema.sql` and click **Run**. You should see "Success".

## Step 3: Simplify login (recommended)

Supabase's free email sender only allows a few emails per hour, so for a personal app:
**Authentication → Sign In / Providers → Email**, then turn **off** "Confirm email" and save.

## Step 4: Generate your push notification keys (VAPID)

In a terminal, inside this project folder:

```bash
npm install
npx web-push generate-vapid-keys
```

Save both the **Public Key** and the **Private Key**. Keep the private key secret.

Also make up a **CRON_SECRET**: any long random string, e.g. `veggie-7f3k29xq81mz`.

## Step 5: Deploy the daily reminder function

1. Supabase, then **Edge Functions → Deploy a new function → Via Editor**.
2. Name it exactly `send-reminders`.
3. Delete the sample code, paste everything from `supabase/functions/send-reminders/index.ts`, and click **Deploy**.
4. Open the function's **Details / Settings** and turn **off** "Enforce JWT verification" (or "Verify JWT"). The function uses its own `CRON_SECRET` check instead.
5. Go to **Edge Functions → Secrets** and add:

| Name | Value |
|---|---|
| `VAPID_PUBLIC_KEY` | public key from Step 4 |
| `VAPID_PRIVATE_KEY` | private key from Step 4 |
| `VAPID_SUBJECT` | `mailto:` followed by your email |
| `CRON_SECRET` | your made-up secret |
| `TIME_ZONE` | `America/New_York` |

(`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided automatically, so don't add them.)

## Step 6: Schedule it every morning

1. Open `supabase/2_schedule.sql` and replace `YOUR-PROJECT-ID` and `YOUR-CRON-SECRET`.
2. Paste it into **SQL Editor** and click **Run**.

It runs daily at 13:00 UTC, which is **9 AM** Charlotte time in summer and 8 AM in winter.

## Step 7: Put the code on GitHub

```bash
git init
git add .
git commit -m "Cook Me Maybe"
```

Then create an empty repo on github.com (e.g. `cook-me-maybe`) and follow its "push an existing repository" commands.

`.env` is git-ignored, so your keys won't be uploaded.

## Step 8: Deploy the website on Vercel

1. vercel.com, then **Add New → Project**, and import your `cook-me-maybe` repo. Vercel detects **Vite** automatically.
2. Before clicking Deploy, open **Environment Variables** and add:

| Name | Value |
|---|---|
| `VITE_SUPABASE_URL` | Project URL from Step 1 |
| `VITE_SUPABASE_ANON_KEY` | anon / publishable key from Step 1 |
| `VITE_VAPID_PUBLIC_KEY` | public VAPID key from Step 4 |

3. Click **Deploy**. You'll get a link like `https://cook-me-maybe-xyz.vercel.app`.
4. Back in Supabase, go to **Authentication → URL Configuration** and set **Site URL** to that link.

## Step 9: Install it on your phone

1. Open your Vercel link on your phone.
2. Add it to your home screen:
   - **iPhone (Safari):** Share, then **Add to Home Screen**. This is required, because iPhones only allow notifications from home-screen apps.
   - **Android (Chrome):** menu, then **Install app** or **Add to Home screen**.
3. Open the app from the home screen icon, sign up, and tap **Turn on** under Reminders, then **Allow**.

## Step 10: Test a reminder right now (don't wait until morning)

1. In the app, add an item that goes bad in 2 days.
2. In Supabase **SQL Editor**, run this with your values filled in:

```sql
select net.http_post(
  url     := 'https://YOUR-PROJECT-ID.supabase.co/functions/v1/send-reminders',
  headers := jsonb_build_object('Content-Type','application/json','x-cron-secret','YOUR-CRON-SECRET'),
  body    := '{}'::jsonb
);
```

You should get a notification within a few seconds. To see the function's result, check
**Edge Functions → send-reminders → Logs**.

---

## Running it on your laptop (optional)

```bash
cp .env.example .env      # then fill in the 3 values
npm run dev               # opens http://localhost:5173
```

Notifications also work on `localhost` in Chrome.

## How it works

- **Saving an item** stores the name and expiry date in your Supabase `items` table. Row-level security means only you can see your items.
- **Turn on reminders** registers your phone's push address in `push_subscriptions`.
- **Every morning** pg_cron calls the `send-reminders` function. It finds uncooked items that go bad within 4 days, including today, and sends one notification listing them all.
- **Cooked ✓** stops reminders for that item.

## Troubleshooting

- **No notification?** Check that reminders show "on" in the app, that the item isn't marked cooked, and that it goes bad within 4 days. Then check the function logs.
- **401 in the logs:** the `x-cron-secret` doesn't match the `CRON_SECRET` secret, or JWT verification is still on.
- **iPhone shows "can't receive notifications":** open the app from the home-screen icon, not from Safari.
- **App says "Almost there":** the Vercel environment variables are missing. Add them and redeploy.
- **Supabase paused your project:** free projects pause after about a week with no activity. Open the dashboard and click **Restore**. Using the app keeps it active.
