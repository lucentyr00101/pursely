# Payment Methods and Card Statements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tag each expense with how it was paid (a credit card, Cash, GCash, Maya or Others). Card purchases count in the budget of the month their statement closes.

**Architecture:** A pure, client-and-server module, `lib/statements.ts`, holds the statement rule. A new `cards` collection stores name, last 4 digits and cutoff day. Transactions and recurring rules gain optional `method`/`cardId` fields, and card transactions store a server-computed `statementDate`.

- Budget spend counts a transaction in the month of its `statementDate`, or in the month of its `date` when it has none.
- No backfill: every new field is additive.
- Everything else (dashboard, lists, search) stays on `date`.

**Tech Stack:** Next.js 16.4 App Router (`cacheComponents`), React 19, MongoDB native driver, zod, Tailwind v4, lucide-react, Bun.

**Spec:** `docs/superpowers/specs/2026-10-29-payment-methods-design.md`

## Global Constraints

- **Never point anything at the production database.** `.env.local` has `MONGODB_DB=expense-tracker`, which is production.
  - For check scripts, copy `.env.local` to `<scratchpad>/.env.dev` with `MONGODB_DB=expense-tracker-dev`.
  - For the browser, run the dev server with `MONGODB_DB=expense-tracker-dev bun run dev`.
  - Don't edit `.env.local`.
- There is no test suite. A task counts as verified when its check script (or browser check) passes and `bunx tsc --noEmit`, `bun run lint` and `bun run build` all exit 0.
- Run check scripts from the project root with Node, never Bun: `bunx tsx --conditions=react-server --env-file=<scratchpad>/.env.dev <scratchpad>/<name>.mts`. Scripts live in the scratchpad, not the repo, and import project files by absolute path.
- Follow CLAUDE.md:
  - Request data inside `<Suspense>`, and `getToday()` instead of `new Date()` in server components.
  - `Select`/`DatePicker`/`Modal` instead of native controls.
  - Design tokens, not raw hex. 44px tap targets. Every `hover:` paired with `active:`. Explicit `aria-label`/`htmlFor` labels.
- Only `lib/data.ts` touches collections. Every query is scoped by `ledgerId`.
- Actions:
  - Start with `editorContext()`. Viewers get "You have view-only access to this household."
  - Ids from the client pass `isId()`, otherwise return `fail(BAD_ID)`.
  - Validate with zod and return `ActionState` through `done()`/`fail()`.
- The payment method applies to **expenses only**. On income, the server drops `method`, `cardId`, `statementDate` and `statementPinned`.
- Never store a full card number, CVV, expiry or cardholder name. `last4` is exactly 4 digits.
- Card label format: `"<name> ••<last4>"`, e.g. `RCBC Black ••4444`. Fixed method labels: `Cash`, `GCash`, `Maya`, `Others`.
- Conventional commits, no `Co-Authored-By` lines. Don't commit `.vscode/` or `.superpowers/`. Work on branch `feat/payment-methods`.

## Review Focus

1. **Cutoff day 29–31 in short months.** Cutoff 31 in February must clamp to Feb 28 (29 in leap years), never roll into March. Task 1 asserts this.
2. **Editing an old purchase after the cutoff changed.** Changing only the note or amount must keep its stored `statementDate`. Task 3's check covers this.
3. **Switching a card expense to Cash or to income.** The card fields must be removed, so it counts by date again. Task 3's check covers this.
4. **Forged or foreign card id.** A card id from another ledger, or an archived card on a new purchase, is rejected with "Pick a valid card." Task 3's check covers this.
5. **Stale remembered default.** A `localStorage` default pointing to an archived or unknown card falls back to Cash. Task 4's browser check covers this.

---

### Task 1: Statement rule module

**Files:**
- Create: `lib/statements.ts` (no `server-only`; imported by client components)
- Check: `<scratchpad>/check-statements.mts`

**Interfaces:**
- Consumes: `addMonths`, `startOf` from `lib/dates.ts`
- Produces (`lib/statements.ts`):
  - `export const FIXED_METHODS = ["cash", "gcash", "maya", "others"] as const`
  - `export type FixedMethod = (typeof FIXED_METHODS)[number]`
  - `export type Method = FixedMethod | "card"`
  - `export const METHOD_LABELS: Record<FixedMethod, string>` = `{ cash: "Cash", gcash: "GCash", maya: "Maya", others: "Others" }`
  - `export function isFixedMethod(value: unknown): value is FixedMethod`
  - `export function cutoffIn(month: string, cutoffDay: number): string`: day `min(cutoffDay, days in month)` of the month containing `month` (any `YYYY-MM-DD`).
  - `export function statementFor(date: string, cutoffDay: number, offset: -1 | 0 | 1 = 0): string`: the automatic statement is `cutoffIn(date)` if `date <= cutoffIn(date)`, else `cutoffIn` of the next month. `offset` then moves whole statements: `cutoffIn(addMonths(startOf(auto, "month"), offset), cutoffDay)`.
  - `export function statementChoices(date: string, cutoffDay: number): [string, string, string]`: `[offset -1, 0, +1]`
  - `export function ordinal(day: number): string`
  - `export function cardLabel(card: { name: string; last4: string }): string`

- [ ] **Step 1: Write the check script** `<scratchpad>/check-statements.mts`. It uses `node:assert/strict` `equal` and prints `statements ok`:

```ts
equal(statementFor("2026-10-29", 10), "2026-11-10");
equal(statementFor("2026-10-10", 10), "2026-10-10");
equal(statementFor("2026-10-11", 10), "2026-11-10");
equal(statementFor("2027-02-28", 31), "2027-02-28");
equal(statementFor("2027-03-01", 31), "2027-03-31");
equal(statementFor("2026-11-30", 31), "2026-11-30");
equal(statementFor("2028-02-29", 30), "2028-02-29");
equal(statementFor("2026-12-31", 10), "2027-01-10");
equal(statementFor("2026-10-29", 10, -1), "2026-10-10");
equal(statementFor("2026-10-29", 10, 1), "2026-12-10");
equal(statementFor("2027-01-31", 31, 1), "2027-02-28");
deepEqual(statementChoices("2026-10-29", 10), ["2026-10-10", "2026-11-10", "2026-12-10"]);
for (const [d, s] of [[1, "1st"], [2, "2nd"], [3, "3rd"], [4, "4th"], [11, "11th"], [12, "12th"], [13, "13th"], [21, "21st"], [22, "22nd"], [23, "23rd"], [31, "31st"]] as const) equal(ordinal(d), s);
equal(cardLabel({ name: "RCBC Black", last4: "4444" }), "RCBC Black ••4444");
ok(isFixedMethod("gcash") && !isFixedMethod("card") && !isFixedMethod({ $ne: "" }));
```

- [ ] **Step 2: Run it to see it fail.** Run `bunx tsx <scratchpad>/check-statements.mts`. Expected: it fails because `lib/statements.ts` can't be found.
- [ ] **Step 3: Implement `lib/statements.ts`** with the Interfaces above. Use the same UTC string math as `lib/dates.ts`, and add a header comment stating the rule: the cutoff day belongs to the statement that closes that day.
- [ ] **Step 4: Run the check.** Expected: `statements ok`. Then run `bunx tsc --noEmit && bun run lint`. Expected: exit 0.
- [ ] **Step 5: Commit.** `git add lib/statements.ts && git commit -m "feat: add card statement date rule"`

---

### Task 2: Cards: data, actions and Settings section

**Files:**
- Modify: `lib/data.ts` (types, collection, index in `ensureSetup`, card functions, `deleteLedgerData`, `mergeLedgerInto`)
- Modify: `app/actions.ts` (card schema, `saveCard`, `archiveCardAction`)
- Create: `components/card-manager.tsx` (client)
- Modify: `app/(app)/settings/page.tsx`
- Modify: `CLAUDE.md` (data model: new `cards` bullet)
- Check: `<scratchpad>/check-cards.mts`

**Interfaces:**
- Consumes: `cardLabel`, `ordinal` (Task 1)
- Produces (`lib/data.ts`):
  - `type CardDoc = { _id: ObjectId; ledgerId: string; name: string; last4: string; cutoffDay: number; archivedAt: Date | null; createdAt: Date; updatedAt: Date }` and `const cards = db.collection<CardDoc>("cards")`, indexed `{ ledgerId: 1 }`.
  - `export type PaymentCard = { id: string; name: string; last4: string; cutoffDay: number; archived: boolean }`. It isn't named `Card`, because `components/ui.tsx` exports a `Card` component.
  - `export type CardInput = { name: string; last4: string; cutoffDay: number }`
  - `export async function listCards(ledgerId: string, { includeArchived = false } = {}): Promise<PaymentCard[]>`: sorted by `createdAt`, then `_id`.
  - `export async function createCard(ledgerId: string, input: CardInput): Promise<string | null>`: returns an error string or null, like `createCategory`.
  - `export async function updateCard(ledgerId: string, id: string, input: CardInput, today: string): Promise<string | null>`: returns "Card not found." for a bad or foreign id. In this task it ignores `today`; Task 3 adds the re-sort.
  - `export async function archiveCard(ledgerId: string, id: string): Promise<string | null>`
- Produces (`app/actions.ts`): `saveCard(_: ActionState, formData: FormData): Promise<ActionState>` (form fields `id?`, `name`, `last4`, `cutoffDay`) and `archiveCardAction(id: string): Promise<ActionState>`.
- Produces (`components/card-manager.tsx`): `export function CardManager({ cards, canEdit }: { cards: PaymentCard[]; canEdit: boolean })`.

- [ ] **Step 1: Write `<scratchpad>/check-cards.mts`.** First assert `process.env.MONGODB_DB === "expense-tracker-dev"`. Use ledger ids `"plan-check-a-" + Date.now()` and `"plan-check-b-…"`. Assert:
  - `createCard(a, { name: "RCBC Black", last4: "4444", cutoffDay: 10 })` returns `null`, and `listCards(a)` returns one card with `cutoffDay: 10` and `archived: false`.
  - `updateCard(b, thatId, …, "2026-10-29")` returns `"Card not found."`. So does `updateCard(a, "nope", …)`.
  - After `archiveCard(a, id)`: `listCards(a)` is empty, and `listCards(a, { includeArchived: true })` has the card with `archived: true`.
  - `mergeLedgerInto(a, b)` moves the card to `b`. `deleteLedgerData(b)` leaves `listCards(b, { includeArchived: true })` empty.

  Clean up both ledgers in `finally`. Print `cards ok`.
- [ ] **Step 2: Run it to see it fail.** Run the check command (see Global Constraints). Expected: it fails because `createCard` is not exported.
- [ ] **Step 3: Implement the data functions** with the Interfaces above. `deleteLedgerData` runs `cards.deleteMany({ ledgerId })`. `mergeLedgerInto` runs `cards.updateMany({ ledgerId: from }, { $set: { ledgerId: to } }, { session })`. Both stay sequential, like the code around them.
- [ ] **Step 4: Run the check.** Expected: `cards ok`.
- [ ] **Step 5: Add the actions** to `app/actions.ts`:

  ```ts
  cardSchema = z.object({
    name: z.string().trim().min(1, "Give the card a name.").max(40, "Keep the name under 40 characters."),
    last4: z.string().regex(/^\d{4}$/, "Enter the card's last 4 digits."),
    cutoffDay: z.coerce.number().int().min(1).max(31),
  })
  ```

  A failure on `cutoffDay` shows "Pick a cutoff day from 1 to 31." `saveCard` passes `await getToday()` to `updateCard`. `archiveCardAction` checks `isId`.
- [ ] **Step 6: Build `CardManager`** (`components/card-manager.tsx`), following `components/category-manager.tsx`:
  - **Rows:** a `CreditCard` icon, the name, and `••4444 · cutoff 10th` (via `ordinal`). An Edit `icon-btn` with `aria-label="Edit <name>"`, shown only when `canEdit`.
  - **Below the rows:** "+ Add card" (`btn btn-primary`, only when `canEdit`). With no cards, show "No cards yet." Then the footnote "Cash, GCash, Maya and Others are always available."
  - **Add/edit dialog** (`Modal`, titles "Add card" / "Edit card"):
    - Name (`data-autofocus`, maxLength 40) and Last 4 digits (`inputMode="numeric"`, maxLength 4, `pattern="\d{4}"`).
    - Statement cutoff day: a `Select` named `cutoffDay` with options "1st"–"31st", default "10th" for a new card. Help text: "Purchases up to and including this day go on that month's statement."
    - `FormError`, then Save.
    - When editing, a `btn-danger` "Archive card". It asks first with "Archive this card? It disappears from the Paid with list. Purchases already tagged keep it."
  - Archived cards aren't listed.
- [ ] **Step 7: Add the Settings section.** In `app/(app)/settings/page.tsx`, add `<Suspense fallback={<Skeleton className="h-40" />}><CardsSection /></Suspense>` after the Currency card. `CardsSection` is async: it gets the ledger and `listCards`, then renders `<Card title="Cards" description="Credit cards you pay with. Purchases count in the month their statement closes."><CardManager cards={...} canEdit={ledger.role !== "viewer"} /></Card>`.
- [ ] **Step 8: Update CLAUDE.md.** In the data model section, add a `cards` bullet: `{ ledgerId, name, last4, cutoffDay, archivedAt }`, archived and never deleted, moved by `mergeLedgerInto`, deleted by `deleteLedgerData`. Under the Testing section's cleanup list, add `cards`.
- [ ] **Step 9: Verify.** Run `bunx tsc --noEmit && bun run lint && bun run build`. Expected: exit 0. Then check in the browser against the dev database:
  - Create a test session (CLAUDE.md "Testing signed-in pages").
  - On `/settings`, add "RCBC Black" with last 4 `4444` and cutoff 10th, then edit it to 11th. The row shows `••4444 · cutoff 11th`.
  - Entering `44a4` shows "Enter the card's last 4 digits."
  - Archive the card. It disappears.
- [ ] **Step 10: Commit.** `git add lib/data.ts app/actions.ts components/card-manager.tsx "app/(app)/settings/page.tsx" CLAUDE.md && git commit -m "feat: manage credit cards in settings"`

---

### Task 3: Payment method and statement on transactions; budgets by statement month

**Files:**
- Modify: `lib/data.ts` (`TransactionDoc`, `Transaction`, `TransactionInput`, `toTransaction`, `createTransaction`, `updateTransaction`, `getBudgetStatus`, `updateCard` re-sort, index)
- Modify: `app/actions.ts` (`txSchema`, `saveTransaction`)
- Modify: `CLAUDE.md` (transactions fields and the budget-month rule)
- Check: `<scratchpad>/check-transactions.mts`

**Interfaces:**
- Consumes: `statementFor`, `statementChoices`, `isFixedMethod`, `Method` (Task 1); `cards`, `CardDoc`, `updateCard` (Task 2)
- Produces (`lib/data.ts`):
  - `TransactionDoc` gains `method?: Method; cardId?: ObjectId; statementDate?: Date; statementPinned?: true`.
  - `Transaction` gains `method: Method | null; cardId: string | null; statementDate: string | null; statementPinned: boolean`.
  - `TransactionInput` gains `method: Method | null; cardId: string | null; statement: string | null`. `statement` is the chosen statement date, or null for automatic.
  - Index: `transactions.createIndex({ ledgerId: 1, statementDate: 1 }, { partialFilterExpression: { statementDate: { $type: "date" } } })`.
- Produces (`app/actions.ts`):
  - `function parsePaidWith(formData: FormData): { method: Method | null; cardId: string | null } | ActionState`
  - `saveTransaction` reads the form fields `paidWith` (`""`, a `FixedMethod`, or a card id) and `statement` (`""` or `YYYY-MM-DD`).

- [ ] **Step 1: Write `<scratchpad>/check-transactions.mts`.** Same dev-database guard and ledgers as Task 2. Pick an expense category id from `listCategories(a)`. Card A is "RCBC Black" with cutoff 10. Assert, in order:
  1. A card purchase on `2026-10-29` gets `statementDate === "2026-11-10"` and `statementPinned === false`. `getBudgetStatus(a, "2026-10-01", "2026-10-31")` excludes it. `getBudgetStatus(a, "2026-11-01", "2026-11-30")` includes it.
  2. A cash purchase on `2026-10-28` (`method: "cash"`) has `statementDate === null` and counts in October.
  3. A purchase with `statement: "2026-12-10"` stores that date, pinned. One with `statement: "2027-03-10"` returns "Pick a valid statement."
  4. **Re-sort, the RCBC case.**
     - Setup: purchase P1 on `2026-10-11` (statement `2026-11-10`), pinned purchase P2 on `2026-10-12` (statement `2026-12-10`), and P3 on `2026-09-20` (statement `2026-10-10`).
     - Action: `updateCard(a, A, { …, cutoffDay: 11 }, "2026-10-29")`.
     - Expected: P1 becomes `2026-10-11`, P2 stays `2026-12-10`, P3 stays `2026-10-10`.
  5. **Re-sort, the boundary case.**
     - Setup: card B with cutoff 30, and a purchase on `2026-10-31` (statement `2026-11-30`).
     - Action: `updateCard(a, B, { …, cutoffDay: 31 }, "2026-11-01")`.
     - Expected: the purchase stays `2026-11-30`.
  6. **Note edit doesn't move it.** `updateTransaction` on P3 with only a new note and `statement: "2026-10-10"` keeps `2026-10-10`.
  7. **Switching clears the card.** Changing P1 to `method: "cash"` clears `cardId` and `statementDate`, and it counts by date again. Changing another card purchase to `type: "income"` clears all four fields.
  8. **Foreign and archived cards.**
     - `createTransaction(b, …, cardId: A)` returns "Pick a valid card."
     - After `archiveCard(a, A)`, a new purchase on A returns "Pick a valid card."
     - `updateTransaction` on an existing A purchase, with an unchanged card and date and its stored statement, returns `null`.

  Clean up in `finally`. Print `transactions ok`.
- [ ] **Step 2: Run it to see it fail.** Expected: a type or assertion failure on the first `statementDate` read.
- [ ] **Step 3: Resolve the payment** with `async function resolvePayment(ledgerId: string, input: TransactionInput, existing: Pick<TransactionDoc, "date" | "cardId" | "statementDate" | "statementPinned"> | null): Promise<{ set: Partial<TransactionDoc>; unset: string[] } | string>` in `lib/data.ts`. Rules:
   - **Income, or no method:** unset all four fields.
   - **Fixed method:** set `method`, unset the other three.
   - **Card:** load `cards.findOne({ _id, ledgerId })` and return "Pick a valid card." when:
     - the card is missing, or
     - it's archived, unless `existing?.cardId` equals it.
   - **Card, date and card unchanged** from `existing`, with `input.statement` equal to the stored statement (or null): keep the stored `statementDate` and `statementPinned`.
   - **Otherwise:** `choices = statementChoices(date, card.cutoffDay)`, and the statement is `input.statement ?? choices[1]`. If it isn't one of `choices`, return "Pick a valid statement." Store it, with `statementPinned: true` only when it differs from `choices[1]`.

  Use it in `createTransaction` and `updateTransaction`, keeping the `recurringId` unset-on-move logic. `toTransaction` maps the new fields.
- [ ] **Step 4: Change the budget spend `$match` in `getBudgetStatus`** to:

  ```ts
  { ledgerId, type: "expense", $or: [
    { statementDate: { $gte: toUtc(monthStart), $lte: toUtc(monthEnd) } },
    { statementDate: null, date: { $gte: toUtc(monthStart), $lte: toUtc(monthEnd) } },
  ] }
  ```
- [ ] **Step 5: Add the re-sort to `updateCard`.** When `cutoffDay` changes:
  - Find `{ ledgerId, cardId, statementDate: { $gte: toUtc(today) }, statementPinned: { $ne: true } }`.
  - For each, compute `next = statementFor(toIso(date), newCutoff)`.
  - Skip it when `startOf(next, "month") < startOf(today, "month")` or `next` equals the current statement.
  - Write the rest in one `bulkWrite`.
- [ ] **Step 6: Wire the action.** In `app/actions.ts`, add `function parsePaidWith(formData: FormData): { method: Method | null; cardId: string | null } | ActionState`. It maps `paidWith` like this:
  - `""` becomes `method: null`.
  - `isFixedMethod` becomes that method.
  - `isId` becomes `method: "card"` with that `cardId`.
  - Anything else returns `fail(BAD_ID)`.

  `saveTransaction` uses it. `statement` is `""`→null, or must pass `isIsoDate`, else "Pick a valid statement." Pass the parsed fields into the data calls. Leave the repeat branch unchanged; Task 5 adds the method there.
- [ ] **Step 7: Run the check.** Expected: `transactions ok`.
- [ ] **Step 8: Update CLAUDE.md.** In the data model's `transactions` bullet, add the optional `method`, `cardId`, `statementDate` and `statementPinned` fields. Explain that budget spend counts a transaction in its `statementDate` month, else its `date` month, and that cutoff edits re-sort only open, unpinned statements and never into a past month.
- [ ] **Step 9: Verify.** Run `bunx tsc --noEmit && bun run lint && bun run build`. Expected: exit 0.
- [ ] **Step 10: Commit.** `git add lib/data.ts app/actions.ts CLAUDE.md && git commit -m "feat: count card purchases in their statement month"`

---

### Task 4: "Paid with" field and statement line in the transaction form

**Files:**
- Create: `components/paid-with.tsx` (client)
- Modify: `components/transaction-form.tsx`, `components/add-transaction-button.tsx`, `components/transaction-list.tsx` (props pass-through only here)
- Modify: `app/(app)/dashboard/page.tsx`, `app/(app)/transactions/page.tsx`, `app/(app)/transactions/search/page.tsx` (load `listCards(ledgerId, { includeArchived: true })` and pass `cards`)

**Interfaces:**
- Consumes: `PaymentCard`, `Transaction` fields (Tasks 2–3); `FIXED_METHODS`, `METHOD_LABELS`, `cardLabel`, `statementChoices`, `ordinal` (Task 1)
- Produces (`components/paid-with.tsx`):
  - `export const PAID_WITH_KEY = "pursely.paidWith"`
  - `export function paidWithOptions(cards: PaymentCard[], keep?: string | null): SelectOption[]`: active cards in order (label `cardLabel`, `CreditCard` icon), then Cash (`Banknote`), GCash (`Smartphone`), Maya (`Wallet`), Others (`CircleEllipsis`). An archived card is included only when its id equals `keep`.
  - `export function rememberedPaidWith(cards: PaymentCard[]): string`: reads `PAID_WITH_KEY` in try/catch. Returns the value if it is a fixed method or an active card id, else `"cash"`.
  - `export function PaidWithField({ id, cards, date, defaultValue, defaultStatement, showStatement }: { id: string; cards: PaymentCard[]; date: string; defaultValue: string; defaultStatement?: string | null; showStatement: boolean })`. It renders the labelled `Select` named `paidWith` (placeholder "Not set", not required), and, when `showStatement` and a card are picked, the statement line plus a hidden `statement` input.
- `TransactionForm`, `AddTransactionButton` and `TransactionList` gain the prop `cards: PaymentCard[]`.

- [ ] **Step 1: Build `PaidWithField`.**
  - **Statement line:** a `rounded-lg bg-accent-soft px-3 py-2.5 text-sm` row reading `{formatDate(s, { month: "short", day: "numeric" })} statement · counts in {formatDate(s, { month: "long" })} budget`, with a `Change` text button (min 44px tall).
  - **Change** reveals a three-way segmented group (`role="radiogroup"`, each option `role="radio"` and `aria-checked`, styled like `TypeToggle`). The options are `statementChoices(date, card.cutoffDay)`, each labelled with the short date over the month name. Under them: "Picked automatically from {card.name}'s cutoff ({ordinal(card.cutoffDay)}). Change it if your statement shows otherwise."
  - **Starting statement:** `defaultStatement` when given, else automatic. If `defaultStatement` isn't one of the three choices, the line shows it and no segment is selected.
  - Changing the card or the date resets to automatic.
  - The hidden `statement` input holds the shown statement date.
- [ ] **Step 2: Add the field to `TransactionForm`.**
  - Make the date controlled (`DatePicker value/onChange`) so the line follows it.
  - Render `PaidWithField` after `CategorySelect`, only when `type === "expense"`.
  - **Defaults:**
    - New transaction: `rememberedPaidWith(cards)`, read in an effect so the server render doesn't touch `localStorage`.
    - Edit: `transaction.cardId ?? transaction.method ?? ""`, with `defaultStatement = transaction.statementDate`.
  - On `state.ok` for a new transaction, write the submitted `paidWith` to `PAID_WITH_KEY` in try/catch.
- [ ] **Step 3: Pass `cards` through.** Thread `cards` through `AddTransactionButton` and `TransactionList`. On the three pages, add `listCards(ledger.ledgerId, { includeArchived: true })` to the existing `Promise.all` and pass it down.
- [ ] **Step 4: Verify.** Run `bunx tsc --noEmit && bun run lint && bun run build`. Expected: exit 0. Then check in the browser against the dev database, after adding card "RCBC Black ••4444" with cutoff 10th:
  - Add an expense dated today with that card. The line reads "<statement> statement · counts in <Month> budget". It matches `statementFor`: for a date of Oct 29, "Nov 10 statement · counts in November budget".
  - Change to the next statement and save. Reopen it: the next statement is still shown.
  - Switch the type to Income. "Paid with" disappears.
  - Add another expense. The default is RCBC Black, the last one used.
  - Archive the card, then add an expense. The default falls back to Cash (Review Focus 5). Editing the earlier purchase still shows "RCBC Black ••4444".
  - Take screenshots at a phone width (390px) and on desktop. The bottom-sheet `Select` and the statement line fit with no horizontal scroll.
- [ ] **Step 5: Commit.** `git add components "app/(app)" && git commit -m "feat: pick payment method and statement when adding expenses"`

---

### Task 5: Payment method on recurring rules

**Files:**
- Modify: `lib/data.ts` (`RecurringDoc`, `Recurring`, `RecurringInput`, `toRecurring`, `createRecurring`, `updateRecurring`, `generateDueRecurring`)
- Modify: `app/actions.ts` (`recurringSchema` handling in `saveRecurring`; the repeat branch of `saveTransaction`)
- Modify: `components/recurring-manager.tsx` (`RecurringForm`, `AddRecurringButton`, `RecurringList` props) and `app/(app)/transactions/recurring/page.tsx`
- Modify: `CLAUDE.md` (the `recurring` bullet)
- Check: `<scratchpad>/check-recurring.mts`

**Interfaces:**
- Consumes: `PaidWithField`, `rememberedPaidWith` (Task 4); `parsePaidWith` in `app/actions.ts` (Task 3).
- Produces:
  - `RecurringDoc` gains `method?: Method; cardId?: ObjectId`.
  - `Recurring` gains `method: Method | null; cardId: string | null`.
  - `RecurringInput` gains `method: Method | null; cardId: string | null`.

- [ ] **Step 1: Write `<scratchpad>/check-recurring.mts`.** Same dev-database guard as before. Setup: card cutoff 10, then `createRecurring` for an expense of `249900` monthly from `2026-10-15` to `2027-01-15` on that card. Assert:
  - After `generateDueRecurring(a, "2026-11-20")`, there are two transactions:
    - `2026-10-15` with statement `2026-11-10`
    - `2026-11-15` with statement `2026-12-10`
  - Both have `method: "card"` and the card id.
  - A recurring **income** rule created with `method: "gcash"` stores no method.
  - `createRecurring` with a foreign card id returns "Pick a valid card."

  Print `recurring ok`.
- [ ] **Step 2: Run it to see it fail.**
- [ ] **Step 3: Implement the data side.**
  - Validate cards in `createRecurring`/`updateRecurring` the same way as transactions: same ledger, and not archived unless unchanged. Income drops the method.
  - In `generateDueRecurring`, load the cards for all due rules with one `cards.find({ _id: { $in } })`. Set `method`, `cardId` and `statementDate: toUtc(statementFor(d, cutoffDay))` on each generated transaction.
  - A rule whose card was deleted from the database generates with no method.
- [ ] **Step 4: Run the check.** Expected: `recurring ok`.
- [ ] **Step 5: Wire the action.** `saveRecurring` and the repeat branch of `saveTransaction` pass `parsePaidWith` results.
- [ ] **Step 6: Add the field to `RecurringForm`.** Render `<PaidWithField showStatement={false} …>` after the category, for expense rules only.
  - New rule: default `rememberedPaidWith(cards)`. Don't write the key.
  - Edit: default `rule.cardId ?? rule.method ?? ""`.
  - Thread `cards` from the recurring page (`listCards(…, { includeArchived: true })`) through `AddRecurringButton` and `RecurringList`.
- [ ] **Step 7: Update CLAUDE.md.** In the `recurring` bullet, note the optional `method`/`cardId`, and that generated card transactions get `statementDate` from the card's cutoff at generation time.
- [ ] **Step 8: Verify.** Run `bunx tsc --noEmit && bun run lint && bun run build`. Expected: exit 0. In the browser: create a monthly expense rule on the card, starting today. Reload `/transactions`: the generated entry is there with the card.
- [ ] **Step 9: Commit.** `git add lib/data.ts app/actions.ts components/recurring-manager.tsx "app/(app)/transactions/recurring/page.tsx" CLAUDE.md && git commit -m "feat: payment method on recurring rules"`

---

### Task 6: Method tag in the transactions list, and CSV columns

**Files:**
- Modify: `components/transaction-list.tsx`
- Modify: `lib/data.ts` (`exportRows`)
- Modify: `app/api/export/route.ts` (`COLUMNS`)

**Interfaces:**
- Consumes: `Transaction` fields (Task 3), `PaymentCard` and `listCards` (Task 2), `cardLabel` and `METHOD_LABELS` (Task 1)
- Produces: `exportRows` rows gain `paid_with: string` and `statement: string`. `COLUMNS` becomes `["date", "type", "category", "subcategory", "amount", "paid_with", "statement", "note"]`.

- [ ] **Step 1: Add the tag to the list.** In `TransactionList`, render a tag on the secondary line, before the note: `text-xs rounded bg-sunken px-1.5 py-0.5 text-muted`.
  - Fixed methods show `METHOD_LABELS[method]`.
  - Cards show `` `${cardLabel(card)} · ${formatDate(statementDate, { month: "short" })} stmt` `` with a small `CreditCard` icon (`aria-hidden`).
  - An unknown card id shows "Card".
  - No method means no tag. Keep the note's `truncate`.
- [ ] **Step 2: Add the CSV columns.** In `exportRows`, load `listCards(ledgerId, { includeArchived: true })` alongside the categories:
  - `paid_with` is the card label, the fixed label, or `""`.
  - `statement` is `statementDate ?? ""`.
- [ ] **Step 3: Verify.** Run `bunx tsc --noEmit && bun run lint && bun run build`. Expected: exit 0.
  - In the browser: `/transactions` shows "RCBC Black ••4444 · Nov stmt" on the card purchase and "GCash" on a GCash one.
  - `curl` `/api/export?from=2026-10-01&to=2026-11-30` with the test cookie. The header row is `"date","type","category","subcategory","amount","paid_with","statement","note"` (each cell quoted), and the card row's `paid_with` is `RCBC Black ••4444`.
- [ ] **Step 4: Commit.** `git add components/transaction-list.tsx lib/data.ts app/api/export/route.ts && git commit -m "feat: show payment method in list and CSV export"`

---

### Task 7: Next-month budget peek and Gemini note

**Files:**
- Modify: `app/(app)/budgets/page.tsx`
- Modify: `lib/gemini.ts` (`SYSTEM`)

**Interfaces:**
- Consumes: `getBudgetStatus` (statement-aware since Task 3), `addMonths`, `formatDate`

- [ ] **Step 1: Let the Budgets page step one month forward.**
  - Allow `month <= addMonths(thisMonth, 1)` (was `<= thisMonth`). Compute `upcoming = month > thisMonth`.
  - Disable the forward link when `next > addMonths(thisMonth, 1)`.
  - In upcoming mode:
    - Call `getBudgetStatus(…, { past: false })`.
    - Hide the "Budgets can total up to" line (set `limit` null).
    - Render the read-only amount branch that `past` uses (not `BudgetForm`). Keep `ended={false}` on meters.
    - Use the Categories card description `Card purchases already counted for ${formatDate(month, { month: "long" })}. Budgets carry over from ${formatDate(thisMonth, { month: "long" })}; change them there.`, with the current-month name linking to `/budgets`.
  - Append " Card purchases count in the month their statement closes." to the `PageHeader` description.
- [ ] **Step 2: Add the Gemini note.** In `lib/gemini.ts`, insert into `SYSTEM` after the first paragraph, verbatim:

  ```
  Budget spending counts credit card purchases in the month their card statement closes, not the day
  they were made, so early in a month a budget can already include card purchases from late last month.
  Don't judge budget pace as if spending builds up evenly through the month.
  ```
- [ ] **Step 3: Verify.** Run `bunx tsc --noEmit && bun run lint && bun run build`. Expected: exit 0. In the browser against the dev database, with an Oct 29 card purchase (cutoff 10th):
  - `/budgets` → forward goes to November, which shows the purchase under its category, with no inputs.
  - Forward is disabled on November.
  - `/budgets?month=2026-12` falls back to the current month.
  - Back on October, the budget inputs work.
- [ ] **Step 4: Commit.** `git add "app/(app)/budgets/page.tsx" lib/gemini.ts && git commit -m "feat: peek at next month's budget and explain statement months to Gemini"`

---

### Wrap-up

- [ ] Delete the test users and their data from `expense-tracker-dev`: users, sessions, transactions, categories, budgets, settings, households, invites, `userLedgers`, cards.
- [ ] Final check: `bunx tsc --noEmit && bun run lint && bun run build` on the branch, then `git status` shows a clean tree, apart from `.vscode/`.
