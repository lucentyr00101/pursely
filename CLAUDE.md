# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

The app is **Pursely** (package `pursely`; formerly Ledgerly / expense-tracker), a personal and household expense tracker deployed on Vercel.

Read `AGENTS.md` first: this is Next.js 16.4 with breaking changes from older versions. Check `node_modules/next/dist/docs/` before using a Next.js API. `next dev` rewrites the marked blocks in `AGENTS.md` (`experimental.agentFeedback` is on in `next.config.ts`), so commit those changes rather than reverting them.

## Commands

Package manager is Bun (`bun.lock`); don't commit a `package-lock.json`.

```bash
bun install
bun run dev          # dev server on :3000
bun run build        # production build; also catches Cache Components errors (see below)
bun run lint         # eslint
bunx tsc --noEmit    # typecheck
bunx next typegen    # regenerate PageProps/LayoutProps route types after adding a route
```

There is no test suite. Verify changes with typecheck, lint, `bun run build`, and the running app (see "Testing signed-in pages").

If the dev server keeps serving old CSS after `app/globals.css` changes, the Turbopack disk cache is stale: stop the server, `rm -rf .next/dev`, restart.

## Environment

`.env.local` (gitignored): `MONGODB_URI` (no database in the URI), `MONGODB_DB` (default `expense-tracker`), `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`. Optional: `GEMINI_API_KEY` (free Google AI Studio key; the dashboard's AI overview card is hidden without it) and `GEMINI_MODEL` (tried first, before the built-in `gemini-3.5-flash-lite` then `gemini-3.1-flash-lite` fallbacks).

`BETTER_AUTH_URL` must be the deployment's own origin. It sets the Google OAuth `redirect_uri`, so leaving it as `http://localhost:3000` on Vercel sends users back to localhost after Google sign-in. If it is unset, `lib/auth.ts` falls back to `VERCEL_PROJECT_PRODUCTION_URL` and trusts the Vercel deployment URLs. Google's console needs `<origin>/api/auth/callback/google` as an authorized redirect URI.

Functions run in Vercel region `hkg1` (`vercel.json`), close to the database, except `app/api/insight/route.ts`, which runs in `sin1` because Gemini blocks Hong Kong. Cold starts matter: `ensureSetup()` runs on each one, so keep its database round trips batched.

## Architecture

**Stack:** Next.js App Router with `cacheComponents: true`, React 19, Tailwind v4, Better Auth (Google only) on the native `mongodb` driver (no Mongoose), Recharts, zod, lucide-react. Installable as a PWA (`app/manifest.ts`, start URL `/dashboard`).

**Routes:** `app/page.tsx` is the public sign-in landing. `app/(app)/` holds the signed-in pages (dashboard, transactions, categories, budgets, settings) under a layout with side nav (lg+), bottom nav and header (below lg), and pull-to-refresh. `app/(legal)/` holds the public `/privacy` and `/terms` pages, which Google's OAuth consent screen links to; keep them out of the `proxy.ts` matcher.

**Cache Components rules (most common build failure):**
- Any read of `cookies()`, `headers()` or `searchParams`, including `getUser()`, must sit inside a `<Suspense>` boundary. Pages follow one pattern: a sync `default export` renders a header plus `<Suspense fallback={<Skeleton/>}>`, and an inner async component awaits the data. The `searchParams` promise is passed down unawaited.
- Reading the clock (`new Date()`) during render needs `await connection()` first. `getToday()` in `lib/session.ts` does this; use it rather than `new Date()` in server components.
- Data is not cached (`use cache` isn't used). Server Actions call `refresh()` from `next/cache` after a mutation.

**Layers:**
- `lib/db.ts`: MongoClient singleton on `globalThis` (in production too, so page and route bundles share one pool). `maxIdleTimeMS: 5000` plus `attachDatabasePool` from `@vercel/functions` let Vercel suspend instances without stale connections. `connectDb()` must run before database work: if the first lazy connect fails, the driver otherwise throws "Topology is closed" until a redeploy. `getSession()` and the auth route call it.
- `lib/auth.ts` holds the Better Auth server config (60-day sessions so the installed app rarely signs out, 5-minute cookie cache), `lib/auth-client.ts` the client one, and `app/api/auth/[...all]/route.ts` the auth handler, which wraps `GET`/`POST` with `connectDb()`.
- `proxy.ts` (Next 16's renamed middleware) only does optimistic cookie-presence redirects between `/` and the app routes. Add new protected routes to its `matcher`. Real authorization happens in the data layer.
- `lib/session.ts`: `getSession()` (connects the database, then reads Better Auth's session; use it instead of calling `auth.api.getSession` directly), `getUser()` (React `cache`, redirects to `/`), `getLedger()` (user plus `{ ledgerId, role, householdId }`, redirects), `getLedgerContext()` (returns null; for actions and route handlers; replaces the removed `getUserId()`), `getToday()` (uses the viewer's timezone from the `tz` cookie, which `components/timezone-cookie.tsx` sets).
- `lib/data.ts`: the server-only data access layer and the only place that touches collections. Every query is scoped by `ledgerId` (the household's ledger, or the user's own id when solo), and writes record the `createdBy` user. Returns plain serializable objects (ids as hex strings).
- `lib/household.ts`: households, invites and membership. `resolveLedger(userId)` maps a user to their ledger and role (owner, editor, viewer) on every request, so removals and role changes apply immediately, even to stale pages. Pages take a `canEdit` prop and hide add/edit controls for viewers; the server check is what counts.
- `app/actions.ts`: Server Actions. They re-authenticate with `getLedgerContext()`, refuse viewers ("You have view-only access to this household."), validate with zod, call `lib/data.ts`, and return `ActionState` `{ ok, error? }` for `useActionState`. `app/api/export/route.ts` produces the CSV export.
- Server Action arguments come from the client and aren't type-checked at runtime. Check every id argument with `isId()` (24-hex `idSchema`) before it reaches a query, or an object like `{"$ne": ""}` becomes a Mongo operator. Functions in `lib/household.ts` also guard `typeof id === "string"`.

**Data model (MongoDB collections):**
- `categories`: `ledgerId: null` marks system categories, seeded idempotently by `ensureSetup()` from `lib/category-defs.ts` (upsert on a stable `key`). Two levels only: `parentId` points to a top-level category. User categories are archived (`archivedAt`), never deleted, so old transactions keep their category.
- `transactions`: `amount` is integer **cents**, `date` is **UTC midnight** of the calendar day, and both `categoryId` (top level) and `subcategoryId` are stored. Picking a subcategory in the UI sends its id, and `resolveCategory` splits it into parent and sub. Expenses may carry `method` (`card`, `cash`, `gcash`, `maya`, `others`; missing means not set); a card purchase also stores `cardId`, `statementDate` (UTC midnight of its statement's cutoff, from `statementFor` in `lib/statements.ts`) and `statementPinned` when moved to the previous or next statement by hand. Budget spend counts a transaction in its `statementDate` month, else its `date` month; everything else (dashboard, lists) stays on `date`. Changing a card's cutoff re-sorts only its unpinned purchases on statements that haven't closed (`statementDate` today or later), and never into a month before the current one. Editing only the note or amount keeps the stored statement.
- `ledgerId` (not `userId`) scopes `categories`, `transactions` and `budgets`. `transactions` also carry `createdBy`, shown as the author avatar. Legacy `userId` docs are renamed to `ledgerId` (with `createdBy` set) by the migration at the top of `ensureSetup()`, which `resolveLedger` runs on first use. This deploy is **roll-forward only**: never roll back past it (old code would show every custom category to everyone and can crash on its unique budget index); fix forward instead.
- `recurring`: repeating transaction rules (`every` N `unit`s from `startDate`, optional `endDate`, `pausedAt`). Occurrence k is `occurrence(startDate, unit, every, k)` from `lib/recurring.ts`, always counted from the start so month-end dates clamp and recover. `getLedger()` calls `generateDueRecurring()` on every page load to insert due occurrences (capped at 100 per rule per request) and advance `nextIndex`/`nextDate`. Generated transactions carry `recurringId`; a unique partial index on `{recurringId, date}` makes concurrent generation safe, and editing a generated transaction's date drops its `recurringId`. Expense rules may carry `method` and `cardId`, copied to each generated transaction; a card entry gets its `statementDate` from the card's cutoff at generation time, and a rule whose card no longer exists generates with no method. Editing a rule re-anchors it at the chosen next date. Archiving a category pauses its rules; resuming skips missed occurrences. Rules move with `mergeLedgerInto` and are deleted by `deleteLedgerData`.
- `budgets`: monthly amounts per top-level expense category with history. Each entry applies `from` its month (`YYYY-MM-01`) until a later entry for the category; `from: null` (or missing, on pre-history budgets) means every month, and `amount: null` ends the budget. `budgetsFor()` resolves a month. Only the current month can change (the action derives it from `getToday()`), so past months are a record. Next month is a read-only peek that shows card purchases on statements closing then. The unique index is `{ledgerId, categoryId, from}`. Archiving a category keeps its budgets, and past months still show it.
- `settings`: `_id` is the ledgerId; holds `currency` (display only, no conversion) and `methodColors` (colors of Cash, GCash, Maya and Others; any missing one uses `DEFAULT_METHOD_COLORS`).
- `cards`: the ledger's credit cards, `{ ledgerId, name, last4, cutoffDay, color, archivedAt }`, managed in Settings. `color` is missing on older cards, which read as `DEFAULT_CARD_COLOR`. Never store more than the last 4 digits. Archived, never deleted, so purchases keep their card. Moved by `mergeLedgerInto`, deleted by `deleteLedgerData`.
- `insights`: `_id` is the ledgerId; the last Gemini monthly overview (`overview`, `steps`, `nextMonth`, `createdAt`; older `summary`/`tips` docs read as none). `lib/gemini.ts` sends totals, budgets and recurring rules (salary, payments, months left), named by category and never by note, over REST. Generated on demand by `POST /api/insight` (`app/api/insight/route.ts`), a route handler rather than a Server Action because the Gemini API refuses requests from Hong Kong: `vercel.json` pins that one function to `sin1` while everything else stays in `hkg1`. It checks the `Origin` header itself, since route handlers get no built-in CSRF check. A ledger can generate at most once per 10 minutes per ledger to protect the free-tier quota. Deleted by `deleteLedgerData` and, for both ledgers, by `mergeLedgerInto`.
- `households`: `{ ledgerId, ownerId, members: [{ userId, role, joinedAt }] }`. One household per user (unique index on `members.userId`). Its ledger id is the owner's ledger at first invite. An owner alone in their household who leaves dissolves it and keeps the ledger.
- `invites`: `{ householdId, email, role, invitedBy }`, for registered emails only. Accepting offers merge (move the invitee's data into the household) or replace (delete it). A member who leaves or is removed gets a fresh empty ledger.
- `userLedgers`: `_id` is the userId; pins a user to a ledger other than their own id: the fresh one for a departed member, or the household ledger for a remaining owner whose ledger isn't their own id.
- Better Auth owns `user`, `session`, `account` and `verification`.

**Dates and ranges (`lib/dates.ts`, shared client/server):** calendar dates are `YYYY-MM-DD` strings, and all math is in UTC so the server's timezone never matters. `resolveRange()` turns dashboard URL params (`preset` = today|week|month|year|last|custom, `n`, `unit`, `offset`, `from`, `to`, `group`) into a concrete range and bar size, widening the grouping when it would produce more than 400 bars. Weeks start Monday. Aggregation buckets come from Mongo `$dateTrunc` with `timezone: "UTC"`, `startOfWeek: "monday"`, and empty buckets are filled by `buckets()`.

**UI:**
- Design tokens are CSS variables in `app/globals.css`, mapped to Tailwind colors in `@theme inline` (`bg-surface`, `text-muted`, `bg-primary`, `text-expense`…). The theme is light only (warm gold & plum). Reusable classes `.glass`, `.field`, `.label`, `.btn`, `.btn-primary`, `.btn-ghost`, `.btn-danger` and `.icon-btn` are defined there. Use tokens, not raw hex.
- `design-system/pursely/MASTER.md` records the palette and the reasons behind it. Chart series colors (`--series-expense`, `--series-income`) were checked for colorblind separation, so re-validate before changing them.
- Payment method colors come from `METHOD_COLORS` in `lib/statements.ts`, not the category palette, because tags are solid and some category colors can't reach 4.5:1 with white or dark text. Pair text with `onMethodColor`, draw icons with `MethodIcon`, and draw tags with `MethodTag`.
- Contrast and touch minimums: text meets 4.5:1 (`text-subtle` is the lightest allowed), input outlines use `border-line-field` for 3:1 (`--border-strong` is decorative only), and tap targets are at least 44px (`h-11`, `size-11`, `min-h-11`). Pair every `hover:` style with the same `active:` style, since touch screens never hover and the iOS tap highlight is turned off.
- Phone and PWA layout: `viewportFit: "cover"` is set, so fixed or edge-hugging UI must pad with `env(safe-area-inset-*)`. Below lg the add-transaction button floats above the bottom nav, and `<main>` has `pb-40` to clear both. The header stops being sticky at `max-height: 500px` (landscape phones). `components/pull-to-refresh.tsx` only runs in standalone display mode, where `overscroll-behavior-y: none` disables native bounce.
- Don't use native `<select>` or `input[type="date"]`. Use `Select` (`components/select.tsx`) and `DatePicker` (`components/date-picker.tsx`): controlled (`value`/`onChange`) or uncontrolled (`defaultValue`), with `name` and `required` working in forms. Both are `popover="auto"` elements (top layer, so they work inside `<dialog>`), placed by `usePopover` in `components/popover.tsx` and styled by `.popover` in `globals.css`, which becomes a bottom sheet below `sm`. Pass layout classes (width, flex) as `className`, and `size="sm"` for compact toolbars. `categoryOptions()` in `components/transaction-form.tsx` builds category options.
- Dialogs use `components/modal.tsx` (native `<dialog>`). Put `data-autofocus` on the field that should get focus. React's `autoFocus` doesn't work because it runs before `showModal()`.
- Give `Select`, `DatePicker` and other form controls an explicit `aria-label` or `htmlFor` label. A wrapping `<label>` pulls the selected option's text into the accessible name.

## Testing signed-in pages

Google sign-in can't be automated. Point `MONGODB_DB` at a non-production database (e.g. `expense-tracker-dev`) and check it first. To render authenticated pages locally, create a test session through Better Auth's internal adapter in a `.mts` script run on Node with `bunx tsx --conditions=react-server --env-file=<env file>` (`server-only` throws without that condition). Don't run it with `bun`: the `bson` package throws `NotImplementedError: node:v8 isBuildingSnapshot` under Bun 1.3. To use the dev database, copy `.env.local` with `MONGODB_DB` changed, and start the dev server with `MONGODB_DB=expense-tracker-dev bun run dev`; variables already set in the shell win over `.env.local`. A script outside the project must import packages such as `mongodb` by their absolute `node_modules` path.

1. Get `(await auth.$context).internalAdapter`.
2. Call `createUser` and `createSession`.
3. Set the cookie `better-auth.session_token` to `encodeURIComponent(token + "." + base64(HMAC-SHA256(BETTER_AUTH_SECRET, token)))`.
4. Drive the browser with `playwright-cli` (`goto`, `screenshot`). `cookie-set` can fail with "Invalid cookie fields": `goto` the origin, then `eval "document.cookie='better-auth.session_token=<value>; path=/'"`. Use one named session (`-s=a`, `-s=b`) per user so each keeps its own cookie.
5. Delete the test users and their data afterwards (users, sessions, transactions, categories, budgets, settings, cards, households, invites, `userLedgers`).

## Git

Conventional commits (`feat:`, `fix:`, `style:`, …). Don't add `Co-Authored-By` lines. `.vscode/` is the user's local editor config and should not be committed.
