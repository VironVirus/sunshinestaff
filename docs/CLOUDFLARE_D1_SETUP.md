# Cloudflare D1 hybrid archive setup

This portal uses a hybrid data model:

- Firebase Authentication remains the login provider.
- Firestore remains the live operational database and permission source.
- Cloudflare D1 stores dated archive copies and immutable revisions.
- A fully backed-up Night Duty date range is read from D1, reducing repeated Firestore range reads.
- If D1 is unavailable, the app falls back to Firestore. A failed D1 copy never cancels a successful Firebase save.

The Worker accepts Firebase ID tokens only. It verifies the token signature, issuer, audience and expiry, then reads the signed-in staff member's own Firestore profile to enforce the same approved/active manager and department permissions used by the portal.

## 1. Create or sign in to Cloudflare

1. Go to <https://dash.cloudflare.com/sign-up> and create a free account if needed.
2. Open a terminal in this project.
3. Install the Worker dependencies:

   ```bash
   cd "workers/archive"
   npm install
   ```

4. Sign in to Wrangler:

   ```bash
   npx wrangler login
   npx wrangler whoami
   ```

Wrangler opens Cloudflare in a browser. Approve the request and return to the terminal.

## 2. Create the D1 database

From `workers/archive`, run:

```bash
npx wrangler d1 create sunshine-hotel-archive
```

Copy the `database_id` returned by Cloudflare. Open `workers/archive/wrangler.jsonc` and add it to the existing D1 binding:

```jsonc
"d1_databases": [
  {
    "binding": "ARCHIVE_DB",
    "database_name": "sunshine-hotel-archive",
    "database_id": "PASTE_THE_DATABASE_ID_HERE",
    "migrations_dir": "migrations"
  }
]
```

Do not change the binding name `ARCHIVE_DB`.

## 3. Confirm the Firebase project and website origins

In `workers/archive/wrangler.jsonc`, verify:

```jsonc
"vars": {
  "FIREBASE_PROJECT_ID": "sunshine-staff-portal",
  "ALLOWED_ORIGINS": "https://sunshinestaff.consolish.com,http://localhost:3000,http://127.0.0.1:3000"
}
```

- `FIREBASE_PROJECT_ID` must exactly match the Firebase project used by Hostinger.
- Keep the production website address in `ALLOWED_ORIGINS`.
- Add another origin only when the portal is genuinely hosted at that address.
- These values are identifiers, not passwords. There is no Cloudflare API key in the browser.

After changing the Wrangler configuration, regenerate its binding types:

```bash
npm run types
npm run typecheck
```

## 4. Create the archive tables

Apply the supplied migration to the remote D1 database:

```bash
npm run migrate:remote
```

Confirm when Wrangler asks. This creates:

- `archive_records` for the latest copy of each report.
- `archive_revisions` for immutable change history.
- `archive_coverage` to record date ranges already checked against Firestore.
- Date indexes that prevent expensive full-table scans.

To inspect the result:

```bash
npx wrangler d1 execute sunshine-hotel-archive --remote --command "SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name"
```

## 5. Validate and deploy the Worker

```bash
npm run deploy:dry
npm run deploy
```

Wrangler prints an address similar to:

```text
https://sunshine-hotel-archive.YOUR-SUBDOMAIN.workers.dev
```

Copy the complete HTTPS address. The Worker runs separately from Hostinger; Hostinger continues serving the Next.js website.

## 6. Connect Hostinger to the Worker

In Hostinger, open the website's environment variables and add:

```text
NEXT_PUBLIC_CLOUDFLARE_ARCHIVE_URL=https://sunshine-hotel-archive.YOUR-SUBDOMAIN.workers.dev
```

Important:

- Do not add a trailing slash.
- This URL is public configuration, not a secret.
- Keep every existing `NEXT_PUBLIC_FIREBASE_*` variable unchanged.
- Rebuild and redeploy the Hostinger application after adding it. Next.js embeds `NEXT_PUBLIC_*` variables during the build.

## 7. Back up existing Night Duty reports

1. Sign in as the Night Duty manager, Night Duty supervisor or Super Admin.
2. Open **Night Duty > Archive**.
3. Select a range of up to 120 days.
4. Click **Pull full report**.
5. Click **Back up this range to D1**.
6. Repeat for older 120-day blocks until all historical dates have been checked.

After a range is fully covered, later range reports use D1 first and avoid the Firestore range query. Individual report lookup still checks Firestore first because Firestore is the live authoritative copy; if it is absent there, the D1 copy is used.

New Night Duty, dated In-house and Room Property Status saves are automatically copied to D1. Every changed version is appended to `archive_revisions`. Retrying an identical save does not create another revision.

To recall an older Night Duty version, select its activity date in the Archive section and click **View D1 revisions**. Each revision can be printed or downloaded read-only; it cannot silently overwrite the current Firebase report.

## 8. Verify data and monitor usage

In Cloudflare Dashboard:

1. Open **Storage & Databases > D1**.
2. Select `sunshine-hotel-archive`.
3. Open **Metrics** to monitor rows read, rows written and storage.
4. Open **Workers & Pages > sunshine-hotel-archive > Observability** for errors and request logs.

Useful terminal commands:

```bash
npm run tail
npx wrangler d1 info sunshine-hotel-archive
npx wrangler d1 execute sunshine-hotel-archive --remote --command "SELECT record_type, COUNT(*) AS records FROM archive_records GROUP BY record_type"
npx wrangler d1 execute sunshine-hotel-archive --remote --command "SELECT record_type, COUNT(*) AS revisions FROM archive_revisions GROUP BY record_type"
```

The Worker performs one Firestore profile read per archive request to keep role changes effective immediately. Bulk backfill sends reports in groups, so it does not perform one authorization read for every report.

## 9. Make a portable backup

D1 is an additional archive, not the only backup. Export it periodically:

```bash
mkdir -p backups
npx wrangler d1 export sunshine-hotel-archive --remote --output "backups/sunshine-hotel-archive.sql"
```

Store the SQL export somewhere private and encrypted. It contains hotel operational and financial information and must not be committed to Git.

## Troubleshooting

### Cloudflare D1 is not active yet

The Hostinger build does not have `NEXT_PUBLIC_CLOUDFLARE_ARCHIVE_URL`, or it was added after the last build. Add it and rebuild.

### This website origin is not allowed

Add the exact Hostinger website origin to `ALLOWED_ORIGINS` in `wrangler.jsonc`, then run `npm run deploy` again. Include only the scheme and hostname, without a path or trailing slash.

### Staff profile could not be authorized

Confirm all of the following:

- The Worker `FIREBASE_PROJECT_ID` matches Hostinger's Firebase project ID.
- The deployed `firestore.rules` permits a signed-in user to get their own `users/{uid}` document.
- The user document ID equals the Firebase Authentication UID.
- `approvalStatus` is `approved` and `employmentStatus` is `active`.
- The staff member is a manager/supervisor or Super Admin.

### The department cannot archive that report type

- Night Duty reports: Night Duty manager/supervisor or Super Admin.
- In-house reports: Front Office manager/supervisor or Super Admin.
- Room Property Status: Housekeeping manager/supervisor or Super Admin.

### D1 reports `no such table`

Run `npm run migrate:remote` from `workers/archive`, then redeploy.

### A Firebase save succeeded but D1 backup is pending

The Firebase copy is safe. Check Worker logs with `npm run tail`, correct the Worker/configuration problem and save again. For Night Duty history, use **Back up this range to D1** after the Worker is healthy.
