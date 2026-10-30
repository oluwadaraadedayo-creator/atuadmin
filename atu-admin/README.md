# A Thousand Units Admin

A separate admin app for A Thousand Units. It is its own website with its own address. It does not live inside Supabase and it does not share a web address with your public site.

## What it can do

People: verify artists, make someone an artist or a fan, feature or hide an artist in Meet the Makers, suspend or reinstate an artist.
Reports: review copyright reports, take a release down or dismiss the report.
Releases: take down or restore any release.
Orders: search orders (with buyer emails) and mark an order refunded after you have refunded it in Paystack.
Categories: open or close categories.
Activity: a record of everything done here.

## What it can not do, on purpose

Create or change other administrators (that is only done with SQL in Supabase). Move money (refunds are done in Paystack). Read or edit database tables freely. Every action is a fixed, checked request to the server.

## How it keeps you safe

The browser never reads your tables. It only signs in to Supabase, then sends one kind of request to `/api/admin` on this same site.
The server accepts a request only if all three are true: the person is signed in, they passed two-factor sign-in on this session, and their profile role is `admin`.
The admin role can only be set by running SQL in Supabase.
Every change is written to an activity log, including what the value was before. Opening the orders page (buyer emails) is logged too.
The page is served with strict security headers (see `vercel.json`) and signs you out after 20 minutes of no activity.

## Set it up (about 20 minutes)

1. In the Supabase SQL Editor, run `sql/007_admin.sql` once. Run 002 to 006 first if you have not.
2. Make yourself an administrator. In the SQL Editor run this with your own email:

```
update public.profiles set role = 'admin'
where id = (select id from auth.users where email = 'you@example.com');
```

3. In Supabase, make sure multi-factor authentication (authenticator app, TOTP) is switched on for the project. Look in the Authentication settings. The admin app cannot enrol you without it.
4. On GitHub, create a new PRIVATE repository, for example `atu-admin`, and upload everything in this folder except `node_modules`, `dist` and any `.env` file.
5. Deploy it on Vercel as its own new project from that repository. Add these Environment Variables in Vercel:
   - `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`: the same public values your main site uses.
   - `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`: the project URL and the secret service role key. These two are server only. Never put the secret key in a `VITE_` variable and never commit it.
6. Open your new Vercel address, sign in with your admin account, and scan the QR code with an authenticator app. From then on you sign in with your password and a 6 digit code.

## Why Vercel and not GitHub Pages

Every GitHub Pages project under your account shares one web address, so your public site and an admin page there would share the same browser storage. A flaw in the public site could then reach an admin session. A separate Vercel project gets its own address, and it can also run the server code this admin needs.

## After it works

Delete `admin.html` from your public repository. It lets any signed-in browser read and edit tables directly, which is much riskier than this app. You can also drop the old `admins` table once nothing uses it.

## If you lose your phone

Remove your authenticator from your user in the Supabase dashboard (Authentication, Users), then sign in again and enrol a new one. If you can not find that option, deleting your rows from `auth.mfa_factors` in the SQL Editor does the same thing. Check the table name in your project first.

## Run it on your own computer

```
npm install
cp .env.example .env     # then fill it in
npm run dev
```

The `/api/admin` function only runs on Vercel. To test it locally, use `npx vercel dev`.

## Known limits

Single admin role: every administrator can do everything. Refunds only update your records. Lists show 25 rows per page. The activity log has no automatic clean-up.
