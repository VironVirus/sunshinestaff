# Sunshine Hotel Staff Portal

Next.js staff portal for Sunshine Hotel with Firebase authentication, Firestore-backed live updates, and a Netlify-ready deployment setup.

## What is included

- Role-based staff onboarding with department and job level selection.
- Self-registered accounts remain pending until an authorized administrator or HR lead approves them.
- Shared dashboard with staff of the week, staff of the month, birthdays, hotel news, and announcements.
- Front Office live updates for in-house guests, available rooms, breakfast entitlement, room complaints, and events/bookings.
- Read-only operational view for Food and Beverages.
- Read and print daily report access for the Night Duty manager.
- Housekeeping and Maintenance managers can mark rooms out of order and update room issue notes.
- HR can update staff details, surcharges, leave eligibility, roles, promotion or demotion, suspension, and sacked status.
- Out-of-order rooms are automatically removed from Front Office room assignment choices.
- Department mapping for:
  - Food and Beverages
  - Front Office
  - IT
  - Maintenance
  - Store
  - Accounts
  - Audit
  - Human Resource
  - Kitchen
  - Security
  - Housekeeping
  - Night Duty

## Local setup

1. Install dependencies:

```bash
npm install
```

2. Copy `.env.example` to `.env.local`.
3. Add your Firebase web app keys:

```bash
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=
NEXT_PUBLIC_USE_FIREBASE_EMULATORS=false
```

4. Run the built-in config check:

```bash
npm run firebase:check
```

5. In Firebase:
   - Enable Email/Password authentication.
   - Create a Firestore database.
   - Publish the rules from `firestore.rules`.
   - Publish the indexes from `firestore.indexes.json`.
   - For a brand-new project, register the first administrator account, then use the Firebase Console to set its profile to `approvalStatus: "approved"`, `employmentStatus: "active"`, `isSuperAdmin: true`, and `accessLevel: "super_admin"`. Public sign-up never grants administrator access.
6. Start the app:

```bash
npm run dev
```

## Firebase CLI helpers

The project now includes helper scripts so you can work against your Firebase project without
remembering the full CLI commands.

```bash
npm run firebase:check
npm run firebase:rules
npm run firebase:indexes
npm run firebase:emulators
```

The Firebase CLI is a development dependency. You may also install it globally if preferred:

```bash
npm install -g firebase-tools
firebase login
```

## Firebase project files

- `firebase.json`
  - Maps Firestore rules and indexes.
  - Defines local emulator ports for Auth and Firestore.
- `firestore.indexes.json`
  - Keeps Firestore indexes under version control.
- `.firebaserc.example`
  - Sample Firebase project alias file.
- `.env.local`
  - Your local Firebase web app credentials.

## Firestore shape

- `users/{uid}`
  - profile, department, role level, privileges, `isSuperAdmin`
- `portal/frontOffice`
  - `inHouse`, `availableRooms`, `breakfastEntitled`, `notes`, update metadata
- `portal/highlights`
  - `staffOfWeek`, `staffOfMonth`
- `portal/birthdays`
  - `items`
- `portal/siteContent`
  - shared dashboard copy

## Netlify deployment

1. Push this project to a Git provider.
2. Create a new Netlify site from the repository.
3. In Netlify `Site configuration -> Environment variables`, add:
   - `NEXT_PUBLIC_FIREBASE_API_KEY`
   - `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
   - `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
   - `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`
   - `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`
   - `NEXT_PUBLIC_FIREBASE_APP_ID`
   - `NEXT_PUBLIC_USE_FIREBASE_EMULATORS=false`
4. Netlify will use `netlify.toml` with:
   - Node `22.22.3`
   - `@netlify/plugin-nextjs`
   - build command `npm run build`
   - publish directory `.next`
5. Before going live, publish the latest Firestore rules from `firestore.rules` in Firebase Console.
6. If your Netlify UI already has `Publish directory` set to `/`, `.`, or the repo root, either clear it or leave it alone and let `netlify.toml` override it on the next deploy.

## Next build-out ideas

- Add department-specific modules for Maintenance, Housekeeping, Accounts, Audit, and HR.
- Add staff profile editing and approval workflows.
- Add printable daily handover archives for Night Duty.
