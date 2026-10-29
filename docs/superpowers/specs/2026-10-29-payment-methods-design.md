# Payment methods and card statements: design

Date: 2026-10-29

## Intent

The owner pays most expenses with credit cards (two UnionBank cards, Gold and Rewards, plus BPI Amore and RCBC Black) and the rest with cash, GCash or Maya. Today every transaction counts in its own calendar month, in budgets too. A card purchase isn't paid that month, though. It lands on the card's next statement, and the owner pays that statement with the salary at the end of the month the statement closes.

Their example: a card's statement cutoff is the 10th. Purchases from Sep 11 to Oct 10 are on the October statement and get paid with October's end-of-month salary, even though the bank's due date is in early November. Purchases from Oct 11 to Nov 10 are paid with November's salary. A purchase on Oct 29 today counts in October's budget. It should count in November's.

Success: the owner tags each expense with what paid for it. Card purchases count against the budget of the month their statement closes. Cash, GCash, Maya and others count in the month they happen, as they do today. The dashboard still shows spending on the day the card was swiped.

## Goals

- **Cards.** A ledger can hold any number of credit cards, each with a **name**, the **last 4 digits** and a **statement cutoff day** (1–31). Cards are managed in a new "Cards" section on the Settings page. Owners and editors can add, edit and archive cards. Viewers only see them.
- **Payment method on expenses.** Each expense can carry one payment method: one of the ledger's cards, **Cash**, **GCash**, **Maya** or **Others**. The last four are a fixed list that is always available.
- **Statement month for budgets.** A card purchase counts in the budget of the month that contains its statement's cutoff date. Every other expense, and any expense with no method, counts in the month of its date.
- **Peek at next month's budget (owner's choice).** A card purchase after the cutoff counts in next month, so the Budgets page can step **one month forward**, read-only. It shows that month's spend so far, mostly card purchases already counted there, against the budgets that carry over. Budgets are still set only in the current month.
- **Dashboard stays on swipe date.** Dashboard totals, charts, the transactions list, search and daily totals keep using the transaction's own date. Only budget "spent" figures use the statement month. That covers the Budgets page, the dashboard's budget card (current month only) and the budget data sent to Gemini, all of which use `getBudgetStatus()`.
- **Cutoff changes.** The owner says cutoffs sometimes move by a day (RCBC Black might have gone from the 10th to the 11th; they aren't sure). Two tools handle that:
  - Editing a card's cutoff day re-sorts that card's purchases on **open** statements only, meaning statements whose cutoff date is today or later. Purchases on closed statements never move, and past budget months never change (see Behaviour details).
  - When a card is picked, the transaction form shows where the purchase lands, e.g. "Nov 10 statement · counts in November budget", with a **Change** control. Change offers the previous, automatic and next statement, for one-off shifts by the bank. A manually moved purchase stays where it was put, and later cutoff edits don't re-sort it.
- **Installments.** The owner logs card installments (0% for N months) as recurring rules. Recurring rules get the same payment method field. Each transaction a rule generates gets its statement from the card's cutoff at generation time.
- **Show it.** The transactions list shows each transaction's method as a small tag. Card tags include the statement month, e.g. "RCBC Black ••4444 · Nov stmt". The CSV export gets the method and statement too.

## Non-goals

- Logging card bill payments. The owner logs purchases only, never the payment of a bill, so nothing gets counted twice. The app must not add a "pay bill" flow that would invite double counting.
- Due dates, payment reminders, credit limits, balances, available credit, interest or statement reconciliation.
- A per-card statement page or running statement totals. Future idea, not now.
- Custom e-wallets or debit cards beyond the fixed Cash, GCash, Maya and Others.
- Bank or e-wallet logos. They are trademarks, so use generic icons.
- A payment method on income. Income has no "Paid with" field, and that includes recurring income such as salary.
- Special installment UI. Installments stay ordinary monthly recurring rules with an end date.

## Anti-goals (a failure even if it "works")

- **Storing sensitive card data.** Never store a full card number, CVV, expiry or cardholder name. The last 4 digits are the most the app keeps.
- **Rewriting history.** Editing a cutoff must never move a purchase out of a closed statement or change a past month's budget figures.
- **Moving the dashboard.** Card purchases must not shift dashboard totals or charts to the statement month. The owner wants those on the swipe date.
- **Trusting the client's month.** The statement must be computed and validated on the server. The client's preview is a convenience only.
- **Leaking cards across ledgers.** Cards are scoped by `ledgerId` like everything else, and a transaction can only reference a card from its own ledger.

## The statement rule

Given a purchase date `d` and a cutoff day `c`:

- Let `cut(month)` be day `min(c, days in month)` of that month. This clamps a cutoff of 29–31 to the last day of short months.
- If `d` is on or before `cut(d's month)`, the statement date is `cut(d's month)`. Otherwise it is `cut(next month)`.
- The **budget month** is the month of the statement date.
- The cutoff day itself belongs to the statement that closes that day. Oct 10 with cutoff 10 goes on the Oct 10 statement and counts in October. This matches the owner's "Sep 11 up until Oct 10" example and how banks define the statement date.

Examples with cutoff 10: Oct 29 → Nov 10 statement → November. Oct 10 → Oct 10 statement → October. Oct 11 → Nov 10 statement → November.
Example with cutoff 31: Feb 28 → Feb 28 statement → February. Mar 1 → Mar 31 statement → March.

"Open" statement: one whose statement date is on or after today, where today is the viewer's calendar day from `getToday()`.

The rule is pure date math on `YYYY-MM-DD` strings in UTC. It belongs in a module shared by client and server, next to or inside `lib/dates.ts`, so the form preview and the server agree.

## Data model (decided)

The fields are **additive**, so code from before this change keeps working against new data. That matters because `CLAUDE.md` makes earlier deploys roll-forward only, and the developer's local `.env.local` points at the production database.

- New collection **`cards`**: `{ _id, ledgerId, name, last4, cutoffDay, archivedAt: Date | null, createdAt, updatedAt }`.
- **`transactions`** gain optional fields:
  - `method`: `"card" | "cash" | "gcash" | "maya" | "others"`. Missing means "not set".
  - `cardId`: ObjectId, present only when `method` is `"card"`.
  - `statementDate`: Date at UTC midnight of the statement's cutoff date. Present only when `method` is `"card"`.
  - `statementPinned`: `true` when the user moved the purchase to another statement by hand.
- **`recurring`** gains optional `method` and `cardId`, with the same meaning.
- **No backfill migration.** A transaction counts in budget month M when either:
  - it has a `statementDate` in M, or
  - it has no `statementDate` and its `date` is in M.

  `getBudgetStatus()` changes its spend query to that rule. Add whatever index keeps it efficient.
- Existing transactions keep no method and count by date, as today.

## Behaviour details (decided)

- **Server computes the statement.** On create or update of a card expense, the server loads the card, checks it belongs to the ledger, and computes `statementDate` from the date and the card's current cutoff. A manual move arrives as an offset, -1 or +1 from the automatic statement, which the server applies and stores with `statementPinned: true`. Nothing else is accepted.
- **Editing a transaction.** If the date or the card changes, recompute the statement and clear `statementPinned`. Otherwise keep the stored `statementDate`, even if the card's cutoff has changed since, so editing a note or amount never moves an old purchase. Switching to a non-card method or to income removes `cardId`, `statementDate` and `statementPinned`.
- **Editing a card's cutoff.** In the same action, recompute `statementDate` for that card's transactions that have `statementDate >= today` and no `statementPinned`. The new statement may already be closed, as long as its budget month isn't in the past. If the new statement's month is before the current month, the purchase keeps its old `statementDate`. *(Builder-check call.)* Why:
  - The owner's RCBC case: today is Oct 29 and the cutoff moves from 10 to 11. An Oct 11 purchase moves from the Nov 10 statement to the closed Oct 11 statement. That's still October, the current month, so it moves. Fixing exactly this is why the owner would edit the cutoff.
  - The month-boundary case: today is Nov 1 and the cutoff moves from 30 to 31. An Oct 31 purchase would move into October, a past month. So it stays on the Nov 30 statement, and past budgets never change.
  - This needs a per-document check, not a single `updateMany`. The number of affected documents is small: one card's open statements.
- **Manual moves are exempt** from that guard. The Change control may put a purchase on the previous statement even when that statement's month is in the past. The user chose it explicitly, the same way editing an old transaction's date already changes a past month.
- **Archiving a card.** Archived cards disappear from pickers and the Settings list (or move to an "archived" group). Existing transactions and recurring rules keep the card, keep counting by its cutoff, and still show its name. When editing a transaction or rule that uses an archived card, the picker still shows that card so saving doesn't silently change it. Cards are never deleted, matching how categories are archived.
- **Recurring generation.** `generateDueRecurring()` sets `method`, `cardId` and `statementDate` on generated transactions from the rule, using the card's cutoff at generation time.
- **Households.** `mergeLedgerInto` moves cards along with transactions and rules. `deleteLedgerData` deletes them. `countLedgerData` may count them if the merge/replace prompt lists counts.
- **Security.** Every card id from the client passes `isId()` before reaching a query. Viewers are refused with the existing "You have view-only access to this household." message. Validation with zod: name trimmed, 1–40 characters; `last4` exactly 4 digits; `cutoffDay` an integer from 1 to 31.

## Screens (decided with the owner from mockups)

- **Transaction form** (`components/transaction-form.tsx`), expenses only: a **"Paid with"** field using the existing `Select` component, placed after Category. The owner picked the dropdown over tap buttons. Options: the ledger's active cards in creation order, labelled "Name ••1234", then Cash, GCash, Maya, Others. Use lucide icons, e.g. `CreditCard`, `Banknote`, `Wallet` or `Smartphone`, and `CircleEllipsis`.
- **Statement line**, shown when a card is picked: a soft accent-coloured line under "Paid with" reading "Nov 10 statement · counts in November budget", with a **Change** button. Change reveals a three-way segmented choice: previous statement, automatic, next statement, each labelled with its cutoff date and budget month. Copy below it: "Picked automatically from <card>'s cutoff (<day>). Change it if your statement shows otherwise." The line updates live as the date or card changes.
- **Default method** for a new expense: the method last used on this device, kept in `localStorage` with try/catch. Fall back to Cash when nothing is stored or the stored card is gone or archived. When editing an old transaction with no method, the field shows an empty "Not set" state, and saving keeps it unset unless the user picks one.
- **Recurring form** (`components/recurring-manager.tsx`) gets the same "Paid with" field for expense rules. It needs no statement line, since each occurrence gets its own statement.
- **Settings → Cards** card (in `app/(app)/settings/page.tsx`): list rows with a card icon, the name, "••1234 · cutoff 10th" and an Edit button, plus "+ Add card". The add/edit form is a `components/modal.tsx` dialog with Name, Last 4 digits and a Statement cutoff day `Select` (1st–31st). Help text: "Purchases up to and including this day go on that month's statement." Archive lives in the edit dialog. A footnote says "Cash, GCash, Maya and Others are always available."
- **Transactions list** (`components/transaction-list.tsx`): a small tag after the date, "GCash" or "RCBC Black ••4444 · Nov stmt". No tag when the method is not set.
- **CSV export** (`app/api/export/route.ts`): add `paid_with` ("RCBC Black ••4444", "GCash", or empty) and `statement` (the statement date `YYYY-MM-DD`, card purchases only) columns.
- **Budgets page** description gets a short note that card purchases count in the month their statement closes.
- **Budgets page, next-month peek** (`app/(app)/budgets/page.tsx`):
  - The forward link is enabled up to `addMonths(thisMonth, 1)` and disabled beyond that.
  - Next month is a third mode beside "current" and "past":
    - Budgets resolve with `budgetsFor(docs, nextMonth)`, which picks up current-month entries.
    - Categories use the current-month filter (active only).
    - The meter isn't "ended". There's no "budgets can total up to" line and no edit controls, even for owners and editors.
  - A short line explains the view, e.g. "Card purchases already counted for November. Budgets carry over from October; change them there."
  - A purchase moved by hand two months ahead (rare) shows once its month becomes next month. Only one month forward is allowed.
- **Gemini** (`lib/gemini.ts`): add one sentence to the system prompt saying budget "spent" counts card purchases in their statement month. Early in a month, a budget may already hold card spending swiped last month, so the model shouldn't judge pace as if spending builds up evenly. The prompt gets no per-budget card/other split and no next-month budget data. *(Builder-check call.)*

## Constraints

- Follow `CLAUDE.md`: Cache Components rules (Suspense around request data, `getToday()` instead of `new Date()` in server components), `Select` instead of native `<select>`, tokens instead of raw hex, 44px tap targets, `hover:` paired with `active:`, explicit `aria-label`s on form controls.
- Server Actions follow the existing pattern: `getLedgerContext()`, refuse viewers, zod, `isId()`, call `lib/data.ts`, `refresh()`, return `ActionState`.
- `lib/data.ts` stays the only module that touches collections.
- No test suite exists. Verify with `bunx tsc --noEmit`, `bun run lint`, `bun run build`, and the running app with a test session.
- **Test against `expense-tracker-dev`, never the default `.env.local` database**, which is production.
- Update `CLAUDE.md`'s data model section to describe `cards` and the new transaction and recurring fields.

## Left to the builder

- Module and function names. Whether the statement math lives in `lib/dates.ts` or a new shared file.
- Index choice for the budget spend query and for re-sorting by `cardId`.
- How the cards list reaches the transaction form: from the app layout, where categories are loaded for the add button, or alongside wherever the form is rendered.
- Exact styling of the statement line, the segmented control and the tags, within the design tokens.
- Whether archived cards show in a collapsed group in Settings, and whether they can be restored.
- Ordering cards in the picker beyond "cards first, in creation order".
