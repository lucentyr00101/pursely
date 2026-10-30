import "server-only";
import { ObjectId, type AnyBulkWriteOperation, type ClientSession, type Filter } from "mongodb";
import { db } from "./db";
import { SYSTEM_CATEGORIES, type IconKey, type TxType } from "./category-defs";
import { addMonths, buckets, startOf, toIso, toUtc, type Granularity, type Range } from "./dates";
import { DEFAULT_CURRENCY, formatMoney } from "./money";
import { monthlyTotals, occurrence } from "./recurring";
import { statementChoices, statementFor, type Method } from "./statements";

// ---------- Documents ----------

type CategoryDoc = {
  _id: ObjectId;
  ledgerId: string | null; // null = system category
  key?: string;
  name: string;
  type: TxType;
  icon: IconKey;
  color: string;
  parentId: ObjectId | null;
  archivedAt: Date | null;
  createdAt: Date;
};

type TransactionDoc = {
  _id: ObjectId;
  ledgerId: string;
  createdBy: string; // userId of whoever entered it
  type: TxType;
  amount: number; // cents
  categoryId: ObjectId; // top-level category
  subcategoryId: ObjectId | null;
  note: string;
  date: Date; // UTC midnight of the calendar day
  recurringId?: ObjectId; // the rule that generated it, until its date is edited
  method?: Method; // how an expense was paid; missing = not set
  cardId?: ObjectId; // with method "card"
  statementDate?: Date; // with method "card": UTC midnight of its statement's cutoff date, which sets its budget month
  statementPinned?: true; // moved to another statement by hand, so cutoff edits leave it alone
  createdAt: Date;
  updatedAt: Date;
};

/** A repeating transaction. Occurrence k falls on occurrence(startDate, unit, every, k). */
type RecurringDoc = {
  _id: ObjectId;
  ledgerId: string;
  createdBy: string;
  type: TxType;
  amount: number; // cents
  categoryId: ObjectId;
  subcategoryId: ObjectId | null;
  note: string;
  every: number;
  unit: Granularity;
  startDate: Date;
  endDate: Date | null; // last day an occurrence may fall on
  nextIndex: number; // occurrences before this one have been generated
  nextDate: Date | null; // occurrence nextIndex; null once past endDate
  pausedAt: Date | null;
  method?: Method; // expense rules only; each generated entry gets it
  cardId?: ObjectId; // with method "card"
  createdAt: Date;
  updatedAt: Date;
};

/**
 * A budget applies from the month `from` (YYYY-MM-01) until a later entry for the same category takes
 * over, so changing it never rewrites past months. `from: null` (or missing, on budgets set before
 * per-month history) applies to every month. A null amount ends the budget.
 */
type BudgetDoc = { _id: ObjectId; ledgerId: string; categoryId: ObjectId; from?: string | null; amount: number | null };
type SettingsDoc = { _id: string; currency: string }; // _id = ledgerId
/** A credit card. Archived rather than deleted, so purchases keep their card. Never holds more than the last 4 digits. */
type CardDoc = {
  _id: ObjectId;
  ledgerId: string;
  name: string;
  last4: string;
  cutoffDay: number; // 1-31, the day its statement closes
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};
/** The latest Gemini overview for a ledger, kept so the dashboard doesn't spend free-tier quota on every load. */
type InsightDoc = { _id: string; overview: string; steps: string[]; nextMonth: string; createdAt: Date }; // _id = ledgerId

const categories = db.collection<CategoryDoc>("categories");
const transactions = db.collection<TransactionDoc>("transactions");
const budgets = db.collection<BudgetDoc>("budgets");
const settings = db.collection<SettingsDoc>("settings");
const recurring = db.collection<RecurringDoc>("recurring");
const insights = db.collection<InsightDoc>("insights");
const cards = db.collection<CardDoc>("cards");

// ---------- One-time setup ----------

let setup: Promise<void> | null = null;

/** Migrate userId to ledgerId, create indexes and seed system categories, once per server process. */
export function ensureSetup(): Promise<void> {
  setup ??= (async () => {
    // Legacy per-user data becomes per-ledger data (a solo user's ledger id is their user id).
    // Every step is a no-op once everything is converted.
    const legacy = {
      categories: db.collection("categories"),
      transactions: db.collection("transactions"),
      budgets: db.collection("budgets"),
    };
    // Drop the old indexes first: a unique {userId, categoryId} index would see a renamed budget as
    // (null, categoryId) and reject the next one.
    await Promise.all(
      (
        [
          [legacy.categories, "userId_1_type_1"],
          [legacy.transactions, "userId_1_date_-1"],
          [legacy.budgets, "userId_1_categoryId_1"],
          // Replaced by {ledgerId, categoryId, from}, which allows one entry per month.
          [legacy.budgets, "ledgerId_1_categoryId_1"],
        ] as const
      ).map(([collection, name]) =>
        collection.dropIndex(name).catch((error) => {
          if (error?.codeName !== "IndexNotFound" && error?.codeName !== "NamespaceNotFound") throw error;
        }),
      ),
    );

    // Categories and transactions have no unique index that a rename could break (`key` is untouched).
    for (const collection of [legacy.categories, legacy.transactions]) {
      await collection.updateMany({ userId: { $exists: true } }, { $rename: { userId: "ledgerId" } });
    }
    // After the rename, so a transaction written between the steps (by either code version) still gets
    // an author. Before households every ledger had one person, so the ledger id is the author.
    await legacy.transactions.updateMany({ createdBy: { $exists: false } }, [
      { $set: { createdBy: { $ifNull: ["$ledgerId", "$userId"] } } },
    ]);
    // Old code still running during the deploy (or after a rollback) can write a legacy budget for a
    // category its ledger already budgets. The migrated row wins and the legacy one is dropped.
    // Another process may rename `doc` after our read, so never match it against itself, and only
    // delete it while it is still legacy.
    const dropLegacy = (id: ObjectId) => legacy.budgets.deleteOne({ _id: id, userId: { $exists: true } });
    for (const doc of await legacy.budgets.find({ userId: { $exists: true } }).toArray()) {
      const migrated = await legacy.budgets.findOne({
        _id: { $ne: doc._id },
        ledgerId: doc.userId,
        categoryId: doc.categoryId,
      });
      if (migrated) {
        await dropLegacy(doc._id);
        continue;
      }
      await legacy.budgets.updateOne({ _id: doc._id }, { $rename: { userId: "ledgerId" } }).catch(async (error) => {
        if (error?.code !== 11000) throw error;
        await dropLegacy(doc._id); // another process migrated a twin first
      });
    }
    // Before the unique index exists, concurrent cold starts could still leave twins: keep the oldest.
    const twins = await legacy.budgets
      .aggregate<{ ids: ObjectId[] }>([
        { $match: { ledgerId: { $type: "string" } } },
        {
          $group: {
            _id: { ledgerId: "$ledgerId", categoryId: "$categoryId", from: { $ifNull: ["$from", null] } },
            ids: { $push: "$_id" },
            n: { $sum: 1 },
          },
        },
        { $match: { n: { $gt: 1 } } },
      ])
      .toArray();
    for (const { ids } of twins) {
      const [, ...extra] = ids.toSorted((a, b) => a.toHexString().localeCompare(b.toHexString()));
      await legacy.budgets.deleteMany({ _id: { $in: extra } });
    }

    await Promise.all([
      categories.createIndex({ ledgerId: 1, type: 1 }),
      categories.createIndex({ key: 1 }, { unique: true, partialFilterExpression: { key: { $type: "string" } } }),
      transactions.createIndex({ ledgerId: 1, date: -1 }),
      transactions.createIndex({ ledgerId: 1, statementDate: 1 }, { partialFilterExpression: { statementDate: { $type: "date" } } }),
      budgets.createIndex({ ledgerId: 1, categoryId: 1, from: 1 }, { unique: true }),
      recurring.createIndex({ ledgerId: 1, nextDate: 1 }),
      cards.createIndex({ ledgerId: 1 }),
      // One entry per rule per day, so two requests generating the same occurrence can't both insert it.
      transactions.createIndex(
        { recurringId: 1, date: 1 },
        { unique: true, partialFilterExpression: { recurringId: { $type: "objectId" } } },
      ),
    ]);

    // Batched: this runs on every cold start, and each round trip to the database counts.
    const now = new Date();
    const defs = (["expense", "income"] as const).flatMap((type) => SYSTEM_CATEGORIES[type].map((def) => ({ type, def })));
    await categories.bulkWrite(
      defs.map(({ type, def }) => ({
        updateOne: {
          filter: { key: def.key },
          update: {
            $set: { name: def.name, icon: def.icon, color: def.color },
            $setOnInsert: { ledgerId: null, type, parentId: null, archivedAt: null, createdAt: now },
          },
          upsert: true,
        },
      })),
      { ordered: false },
    );
    const parents = await categories
      .find({ key: { $in: defs.map(({ def }) => def.key) } }, { projection: { key: 1 } })
      .toArray();
    const parentIds = new Map(parents.map((p) => [p.key, p._id]));
    await categories.bulkWrite(
      defs.flatMap(({ type, def }) =>
        (def.children ?? []).map((child) => ({
          updateOne: {
            filter: { key: `${def.key}/${child}` },
            update: {
              $set: { name: child, icon: def.icon, color: def.color },
              $setOnInsert: { ledgerId: null, type, parentId: parentIds.get(def.key)!, archivedAt: null, createdAt: now },
            },
            upsert: true,
          },
        })),
      ),
      { ordered: false },
    );
  })().catch((error) => {
    setup = null;
    throw error;
  });
  return setup;
}

// ---------- Settings ----------

export type Settings = { currency: string };

export async function getSettings(ledgerId: string): Promise<Settings> {
  const doc = await settings.findOne({ _id: ledgerId });
  return { currency: doc?.currency ?? DEFAULT_CURRENCY };
}

export async function updateSettings(ledgerId: string, patch: Settings): Promise<void> {
  await settings.updateOne({ _id: ledgerId }, { $set: patch }, { upsert: true });
}

// ---------- Insights ----------

export type Insight = { overview: string; steps: string[]; nextMonth: string; createdAt: string };

export async function getInsight(ledgerId: string): Promise<Insight | null> {
  const doc = await insights.findOne({ _id: ledgerId });
  // Docs saved in the earlier summary/tips shape have no overview; they're regenerated on request.
  if (!doc?.overview) return null;
  return { overview: doc.overview, steps: doc.steps, nextMonth: doc.nextMonth, createdAt: doc.createdAt.toISOString() };
}

export async function saveInsight(ledgerId: string, insight: Omit<Insight, "createdAt">): Promise<Insight> {
  const createdAt = new Date();
  await insights.replaceOne({ _id: ledgerId }, { ...insight, createdAt }, { upsert: true });
  return { ...insight, createdAt: createdAt.toISOString() };
}

// ---------- Categories ----------

export type Category = {
  id: string;
  name: string;
  type: TxType;
  icon: IconKey;
  color: string;
  parentId: string | null;
  isSystem: boolean;
  archived: boolean;
};

export type CategoryNode = Category & { children: Category[] };

function toCategory(doc: CategoryDoc): Category {
  return {
    id: doc._id.toHexString(),
    name: doc.name,
    type: doc.type,
    icon: doc.icon,
    color: doc.color,
    parentId: doc.parentId?.toHexString() ?? null,
    isSystem: doc.ledgerId === null,
    archived: doc.archivedAt !== null,
  };
}

/**
 * The ledger's own categories plus system ones. `$type: "null"` only matches an explicit null, so a
 * legacy doc that still has `userId` and no `ledgerId` (written by old code) matches neither.
 */
const visibleTo = (ledgerId: string): Filter<CategoryDoc> => ({
  $or: [{ ledgerId }, { ledgerId: { $type: "null" } }],
});

/** System + the user's categories as a tree, system ones first. */
export async function listCategories(
  ledgerId: string,
  { includeArchived = false }: { includeArchived?: boolean } = {},
): Promise<CategoryNode[]> {
  await ensureSetup();
  const docs = await categories
    .find({ ...visibleTo(ledgerId), ...(includeArchived ? {} : { archivedAt: null }) })
    .sort({ createdAt: 1, _id: 1 })
    .toArray();

  const all = docs.map(toCategory);
  const byParent = new Map<string, Category[]>();
  for (const c of all) {
    if (c.parentId) byParent.set(c.parentId, [...(byParent.get(c.parentId) ?? []), c]);
  }
  return all
    .filter((c) => !c.parentId)
    .sort((a, b) => Number(b.isSystem) - Number(a.isSystem))
    .map((c) => ({ ...c, children: byParent.get(c.id) ?? [] }));
}

async function findUsableCategory(ledgerId: string, id: string) {
  if (typeof id !== "string" || !ObjectId.isValid(id)) return null;
  return categories.findOne({ _id: new ObjectId(id), ...visibleTo(ledgerId), archivedAt: null });
}

async function findOwnCategory(ledgerId: string, id: string) {
  if (typeof id !== "string" || !ObjectId.isValid(id)) return null;
  return categories.findOne({ _id: new ObjectId(id), ledgerId });
}

export async function createCategory(
  ledgerId: string,
  input: { name: string; type: TxType; icon: IconKey; color: string; parentId: string | null },
): Promise<string | null> {
  await ensureSetup();
  let parentId: ObjectId | null = null;
  let type = input.type;
  if (input.parentId) {
    const parent = await findUsableCategory(ledgerId, input.parentId);
    if (!parent || parent.parentId) return "Pick a top-level parent category.";
    parentId = parent._id;
    type = parent.type;
  }

  const duplicate = await categories.findOne({
    ...visibleTo(ledgerId),
    type,
    parentId,
    archivedAt: null,
    name: { $regex: `^${escapeRegex(input.name)}$`, $options: "i" },
  });
  if (duplicate) return `"${input.name}" already exists here.`;

  await categories.insertOne({
    _id: new ObjectId(),
    ledgerId,
    name: input.name,
    type,
    icon: input.icon,
    color: input.color,
    parentId,
    archivedAt: null,
    createdAt: new Date(),
  });
  return null;
}

export async function updateCategory(
  ledgerId: string,
  id: string,
  input: { name: string; icon: IconKey; color: string },
): Promise<string | null> {
  const doc = await findOwnCategory(ledgerId, id);
  if (!doc) return "Only custom categories can be edited.";
  await categories.updateOne({ _id: doc._id }, { $set: input });
  return null;
}

/** Archive rather than delete, so past transactions keep their category. */
export async function archiveCategory(ledgerId: string, id: string): Promise<string | null> {
  const doc = await findOwnCategory(ledgerId, id);
  if (!doc) return "Only custom categories can be removed.";
  const now = new Date();
  await categories.updateMany(
    { ledgerId, $or: [{ _id: doc._id }, { parentId: doc._id }] },
    { $set: { archivedAt: now } },
  );
  // Its budgets stay, so past months still show them.
  // Recurring entries in it stop until someone picks a new category.
  await recurring.updateMany(
    { ledgerId, pausedAt: null, $or: [{ categoryId: doc._id }, { subcategoryId: doc._id }] },
    { $set: { pausedAt: now } },
  );
  return null;
}

function escapeRegex(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---------- Cards ----------

export type PaymentCard = { id: string; name: string; last4: string; cutoffDay: number; archived: boolean };
export type CardInput = { name: string; last4: string; cutoffDay: number };

function toPaymentCard(doc: CardDoc): PaymentCard {
  return { id: doc._id.toHexString(), name: doc.name, last4: doc.last4, cutoffDay: doc.cutoffDay, archived: doc.archivedAt !== null };
}

export async function listCards(ledgerId: string, { includeArchived = false }: { includeArchived?: boolean } = {}): Promise<PaymentCard[]> {
  const docs = await cards
    .find({ ledgerId, ...(includeArchived ? {} : { archivedAt: null }) })
    .sort({ createdAt: 1, _id: 1 })
    .toArray();
  return docs.map(toPaymentCard);
}

async function findCard(ledgerId: string, id: unknown) {
  if (typeof id !== "string" || !ObjectId.isValid(id)) return null;
  return cards.findOne({ _id: new ObjectId(id), ledgerId });
}

/** A card a purchase or rule may use: the ledger's own, and active unless it is the one it already had. */
async function usableCard(ledgerId: string, id: unknown, current: ObjectId | undefined) {
  const card = await findCard(ledgerId, id);
  return card && (card.archivedAt === null || current?.equals(card._id)) ? card : null;
}

export async function createCard(ledgerId: string, input: CardInput): Promise<string | null> {
  await ensureSetup();
  const now = new Date();
  await cards.insertOne({ _id: new ObjectId(), ledgerId, ...input, archivedAt: null, createdAt: now, updatedAt: now });
  return null;
}

/**
 * A new cutoff re-sorts the card's purchases on statements that haven't closed (today or later),
 * except ones moved by hand. A purchase may land on a statement that just closed, but never in a
 * month before this one, so past budgets don't change.
 */
export async function updateCard(ledgerId: string, id: string, input: CardInput, today: string): Promise<string | null> {
  const doc = await findCard(ledgerId, id);
  if (!doc) return "Card not found.";
  await cards.updateOne({ _id: doc._id }, { $set: { ...input, updatedAt: new Date() } });
  if (input.cutoffDay === doc.cutoffDay) return null;

  const thisMonth = startOf(today, "month");
  const open = await transactions
    .find(
      { ledgerId, cardId: doc._id, statementDate: { $gte: toUtc(today) }, statementPinned: { $ne: true } },
      { projection: { date: 1, statementDate: 1 } },
    )
    .toArray();
  const ops: AnyBulkWriteOperation<TransactionDoc>[] = open.flatMap((t) => {
    const next = statementFor(toIso(t.date), input.cutoffDay);
    if (startOf(next, "month") < thisMonth || next === toIso(t.statementDate!)) return [];
    return [{ updateOne: { filter: { _id: t._id }, update: { $set: { statementDate: toUtc(next) } } } }];
  });
  if (ops.length) await transactions.bulkWrite(ops);
  return null;
}

/** Archive rather than delete: purchases and recurring entries on the card keep it. */
export async function archiveCard(ledgerId: string, id: string): Promise<string | null> {
  const doc = await findCard(ledgerId, id);
  if (!doc) return "Card not found.";
  if (doc.archivedAt === null) await cards.updateOne({ _id: doc._id }, { $set: { archivedAt: new Date(), updatedAt: new Date() } });
  return null;
}

// ---------- Transactions ----------

export type Transaction = {
  id: string;
  type: TxType;
  amount: number;
  date: string;
  note: string;
  categoryId: string;
  subcategoryId: string | null;
  createdBy: string;
  recurringId: string | null;
  method: Method | null;
  cardId: string | null;
  statementDate: string | null;
  statementPinned: boolean;
};

export type TransactionInput = {
  type: TxType;
  amount: number;
  date: string;
  note: string;
  categoryId: string; // may be a subcategory id
  method: Method | null;
  cardId: string | null;
  statement: string | null; // the chosen statement date, or null for the automatic one
};

const PAYMENT_FIELDS = ["method", "cardId", "statementDate", "statementPinned"] as const;
type PaymentFields = Pick<TransactionDoc, (typeof PAYMENT_FIELDS)[number]>;

/**
 * The payment fields to $set and $unset. Income carries none. A card purchase whose date, card and
 * statement are unchanged keeps its stored statement, so editing a note never moves it even after
 * the card's cutoff changed; otherwise the statement must be the previous, automatic or next one.
 */
async function resolvePayment(
  ledgerId: string,
  input: TransactionInput,
  existing: (PaymentFields & { date: Date }) | null,
): Promise<{ set: PaymentFields; unset: string[] } | string> {
  const none = { set: {}, unset: [...PAYMENT_FIELDS] };
  if (input.type !== "expense" || !input.method) return none;
  if (input.method !== "card") return { set: { method: input.method }, unset: ["cardId", "statementDate", "statementPinned"] };

  const card = await usableCard(ledgerId, input.cardId, existing?.cardId);
  if (!card) return "Pick a valid card.";
  const sameCard = Boolean(existing?.cardId?.equals(card._id));
  const date = toUtc(input.date);
  const stored = existing?.statementDate && toIso(existing.statementDate);
  if (sameCard && +existing!.date === +date && stored && (input.statement ?? stored) === stored) {
    return { set: { method: "card", cardId: card._id }, unset: [] };
  }
  const choices = statementChoices(input.date, card.cutoffDay);
  const statement = input.statement ?? choices[1];
  if (!choices.includes(statement)) return "Pick a valid statement.";
  const pinned = statement !== choices[1];
  return {
    set: { method: "card", cardId: card._id, statementDate: toUtc(statement), ...(pinned && { statementPinned: true as const }) },
    unset: pinned ? [] : ["statementPinned"],
  };
}

/** Resolve a picked category id into (top-level, subcategory). */
async function resolveCategory(ledgerId: string, type: TxType, id: string) {
  const doc = await findUsableCategory(ledgerId, id);
  if (!doc || doc.type !== type) return null;
  return doc.parentId
    ? { categoryId: doc.parentId, subcategoryId: doc._id }
    : { categoryId: doc._id, subcategoryId: null };
}

export async function createTransaction(
  ledgerId: string,
  createdBy: string,
  input: TransactionInput,
): Promise<string | null> {
  await ensureSetup();
  const resolved = await resolveCategory(ledgerId, input.type, input.categoryId);
  if (!resolved) return "Pick a valid category.";
  const payment = await resolvePayment(ledgerId, input, null);
  if (typeof payment === "string") return payment;
  const now = new Date();
  await transactions.insertOne({
    _id: new ObjectId(),
    ledgerId,
    createdBy,
    type: input.type,
    amount: input.amount,
    note: input.note,
    date: toUtc(input.date),
    ...resolved,
    ...payment.set,
    createdAt: now,
    updatedAt: now,
  });
  return null;
}

export async function updateTransaction(ledgerId: string, id: string, input: TransactionInput): Promise<string | null> {
  if (typeof id !== "string" || !ObjectId.isValid(id)) return "Transaction not found.";
  const resolved = await resolveCategory(ledgerId, input.type, input.categoryId);
  if (!resolved) return "Pick a valid category.";
  const _id = new ObjectId(id);
  const existing = await transactions.findOne(
    { _id, ledgerId },
    { projection: { date: 1, method: 1, cardId: 1, statementDate: 1, statementPinned: 1 } },
  );
  if (!existing) return "Transaction not found.";
  const payment = await resolvePayment(ledgerId, input, existing);
  if (typeof payment === "string") return payment;
  const date = toUtc(input.date);
  // A generated entry moved to another day no longer holds its rule's slot for that day, which could
  // collide with another occurrence.
  const moved = +existing.date !== +date;
  const unset = [...payment.unset, ...(moved ? ["recurringId"] : [])];
  const result = await transactions.updateOne(
    { _id, ledgerId },
    {
      $set: {
        type: input.type,
        amount: input.amount,
        note: input.note,
        date,
        ...resolved,
        ...payment.set,
        updatedAt: new Date(),
      },
      ...(unset.length && { $unset: Object.fromEntries(unset.map((f) => [f, ""])) }),
    },
  );
  return result.matchedCount ? null : "Transaction not found.";
}

export async function deleteTransaction(ledgerId: string, id: string): Promise<void> {
  if (typeof id !== "string" || !ObjectId.isValid(id)) return;
  await transactions.deleteOne({ _id: new ObjectId(id), ledgerId });
}

const inRange = (ledgerId: string, from: string, to: string): Filter<TransactionDoc> => ({
  ledgerId,
  date: { $gte: toUtc(from), $lte: toUtc(to) },
});

function toTransaction(d: TransactionDoc): Transaction {
  return {
    id: d._id.toHexString(),
    type: d.type,
    amount: d.amount,
    date: toIso(d.date),
    note: d.note,
    categoryId: d.categoryId.toHexString(),
    subcategoryId: d.subcategoryId?.toHexString() ?? null,
    createdBy: d.createdBy,
    recurringId: d.recurringId?.toHexString() ?? null,
    method: d.method ?? null,
    cardId: d.cardId?.toHexString() ?? null,
    statementDate: d.statementDate ? toIso(d.statementDate) : null,
    statementPinned: d.statementPinned === true,
  };
}

export async function listTransactions(ledgerId: string, from: string, to: string): Promise<Transaction[]> {
  const docs = await transactions.find(inRange(ledgerId, from, to)).sort({ date: -1, createdAt: -1 }).toArray();
  return docs.map(toTransaction);
}

/** Every field is optional; callers validate them, and ids that aren't ObjectIds are ignored here too. */
export type TransactionSearch = {
  q?: string;
  type?: TxType;
  categoryId?: string; // top-level or subcategory
  createdBy?: string;
  min?: number; // cents
  max?: number;
  from?: string;
  to?: string;
};

export type SearchResult = {
  transactions: Transaction[];
  count: number;
  expense: number;
  income: number;
};

/** Matching transactions, newest first and capped at `limit`, plus totals over every match. */
export async function searchTransactions(ledgerId: string, search: TransactionSearch, limit: number): Promise<SearchResult> {
  const and: Filter<TransactionDoc>[] = [];
  if (search.type) and.push({ type: search.type });
  if (typeof search.createdBy === "string") and.push({ createdBy: search.createdBy });
  if (typeof search.categoryId === "string" && ObjectId.isValid(search.categoryId)) {
    const id = new ObjectId(search.categoryId);
    and.push({ $or: [{ categoryId: id }, { subcategoryId: id }] });
  }
  if (search.min !== undefined || search.max !== undefined) {
    and.push({ amount: { ...(search.min !== undefined && { $gte: search.min }), ...(search.max !== undefined && { $lte: search.max }) } });
  }
  if (search.from || search.to) {
    and.push({ date: { ...(search.from && { $gte: toUtc(search.from) }), ...(search.to && { $lte: toUtc(search.to) }) } });
  }
  const q = search.q?.trim();
  if (q) {
    // A word matches the note or the name of a category, archived ones included so old entries turn up.
    const regex = { $regex: escapeRegex(q), $options: "i" };
    const named = await categories
      .find({ ...visibleTo(ledgerId), name: regex }, { projection: { _id: 1 } })
      .toArray();
    const ids = named.map((c) => c._id);
    and.push({ $or: [{ note: regex }, { categoryId: { $in: ids } }, { subcategoryId: { $in: ids } }] });
  }

  const filter: Filter<TransactionDoc> = { ledgerId, ...(and.length && { $and: and }) };
  const [docs, totals] = await Promise.all([
    transactions.find(filter).sort({ date: -1, createdAt: -1 }).limit(limit).toArray(),
    transactions
      .aggregate<{ _id: TxType; total: number; count: number }>([
        { $match: filter },
        { $group: { _id: "$type", total: { $sum: "$amount" }, count: { $sum: 1 } } },
      ])
      .toArray(),
  ]);
  const byType = new Map(totals.map((t) => [t._id, t]));
  return {
    transactions: docs.map(toTransaction),
    count: totals.reduce((n, t) => n + t.count, 0),
    expense: byType.get("expense")?.total ?? 0,
    income: byType.get("income")?.total ?? 0,
  };
}

export type DayTotal = { date: string; expense: number; income: number };

export async function dailyTotals(ledgerId: string, from: string, to: string): Promise<DayTotal[]> {
  const rows = await transactions
    .aggregate<{ _id: { date: Date; type: TxType }; total: number }>([
      { $match: inRange(ledgerId, from, to) },
      { $group: { _id: { date: "$date", type: "$type" }, total: { $sum: "$amount" } } },
    ])
    .toArray();
  const map = new Map<string, DayTotal>();
  for (const day of buckets(from, to, "day")) map.set(day, { date: day, expense: 0, income: 0 });
  for (const r of rows) map.get(toIso(r._id.date))![r._id.type] = r.total;
  return [...map.values()];
}

// ---------- Recurring ----------

export type Recurring = {
  id: string;
  type: TxType;
  amount: number;
  note: string;
  categoryId: string;
  subcategoryId: string | null;
  every: number;
  unit: Granularity;
  startDate: string;
  endDate: string | null;
  nextDate: string | null; // null once finished
  paused: boolean;
  createdBy: string;
  method: Method | null;
  cardId: string | null;
};

export type RecurringInput = {
  type: TxType;
  amount: number;
  note: string;
  categoryId: string; // may be a subcategory id
  every: number;
  unit: Granularity;
  start: string; // first occurrence; on an edit, the next one
  end: string | null;
  method: Method | null;
  cardId: string | null;
};

/** A rule's method fields to $set and $unset, checked like a transaction's; income carries none. */
async function resolveRuleMethod(
  ledgerId: string,
  input: RecurringInput,
  current: ObjectId | undefined,
): Promise<{ set: Pick<RecurringDoc, "method" | "cardId">; unset: string[] } | string> {
  if (input.type !== "expense" || !input.method) return { set: {}, unset: ["method", "cardId"] };
  if (input.method !== "card") return { set: { method: input.method }, unset: ["cardId"] };
  const card = await usableCard(ledgerId, input.cardId, current);
  return card ? { set: { method: "card", cardId: card._id }, unset: [] } : "Pick a valid card.";
}

function toRecurring(d: RecurringDoc): Recurring {
  return {
    id: d._id.toHexString(),
    type: d.type,
    amount: d.amount,
    note: d.note,
    categoryId: d.categoryId.toHexString(),
    subcategoryId: d.subcategoryId?.toHexString() ?? null,
    every: d.every,
    unit: d.unit,
    startDate: toIso(d.startDate),
    endDate: d.endDate && toIso(d.endDate),
    nextDate: d.nextDate && toIso(d.nextDate),
    paused: d.pausedAt !== null,
    createdBy: d.createdBy,
    method: d.method ?? null,
    cardId: d.cardId?.toHexString() ?? null,
  };
}

/** Active rules by next date, then paused ones, then finished ones. */
export async function listRecurring(ledgerId: string): Promise<Recurring[]> {
  await ensureSetup();
  const docs = await recurring.find({ ledgerId }).sort({ createdAt: 1 }).toArray();
  const rank = (r: Recurring) => (r.nextDate === null ? 2 : r.paused ? 1 : 0);
  return docs
    .map(toRecurring)
    .sort((a, b) => rank(a) - rank(b) || (a.nextDate ?? "").localeCompare(b.nextDate ?? ""));
}

/** The schedule fields for a rule anchored at `start`: its first occurrence is `start` itself. */
function schedule(input: RecurringInput) {
  const end = input.end ? toUtc(input.end) : null;
  const start = toUtc(input.start);
  return {
    every: input.every,
    unit: input.unit,
    startDate: start,
    endDate: end,
    nextIndex: 0,
    nextDate: end && start > end ? null : start,
  };
}

export async function createRecurring(ledgerId: string, createdBy: string, input: RecurringInput): Promise<string | null> {
  await ensureSetup();
  const resolved = await resolveCategory(ledgerId, input.type, input.categoryId);
  if (!resolved) return "Pick a valid category.";
  const method = await resolveRuleMethod(ledgerId, input, undefined);
  if (typeof method === "string") return method;
  const now = new Date();
  await recurring.insertOne({
    _id: new ObjectId(),
    ledgerId,
    createdBy,
    type: input.type,
    amount: input.amount,
    note: input.note,
    ...resolved,
    ...schedule(input),
    ...method.set,
    pausedAt: null,
    createdAt: now,
    updatedAt: now,
  });
  return null;
}

/**
 * Re-anchors the schedule at `input.start`, so the changes apply from that date on. Entries already
 * generated stay as they are, and the unique index skips any occurrence that already exists.
 */
export async function updateRecurring(ledgerId: string, id: string, input: RecurringInput): Promise<string | null> {
  if (typeof id !== "string" || !ObjectId.isValid(id)) return "Recurring entry not found.";
  const resolved = await resolveCategory(ledgerId, input.type, input.categoryId);
  if (!resolved) return "Pick a valid category.";
  const _id = new ObjectId(id);
  const existing = await recurring.findOne({ _id, ledgerId }, { projection: { cardId: 1 } });
  if (!existing) return "Recurring entry not found.";
  const method = await resolveRuleMethod(ledgerId, input, existing.cardId);
  if (typeof method === "string") return method;
  const result = await recurring.updateOne(
    { _id, ledgerId },
    {
      $set: { type: input.type, amount: input.amount, note: input.note, ...resolved, ...schedule(input), ...method.set, updatedAt: new Date() },
      ...(method.unset.length && { $unset: Object.fromEntries(method.unset.map((f) => [f, ""])) }),
    },
  );
  return result.matchedCount ? null : "Recurring entry not found.";
}

/** Deletes the rule. Entries it generated stay, as ordinary transactions. */
export async function deleteRecurring(ledgerId: string, id: string): Promise<void> {
  if (typeof id !== "string" || !ObjectId.isValid(id)) return;
  const _id = new ObjectId(id);
  const result = await recurring.deleteOne({ _id, ledgerId });
  if (result.deletedCount) await transactions.updateMany({ ledgerId, recurringId: _id }, { $unset: { recurringId: "" } });
}

/** Resuming skips the occurrences missed while paused; the next one is today or later. */
export async function setRecurringPaused(ledgerId: string, id: string, paused: boolean, today: string): Promise<string | null> {
  if (typeof id !== "string" || !ObjectId.isValid(id)) return "Recurring entry not found.";
  const doc = await recurring.findOne({ _id: new ObjectId(id), ledgerId });
  if (!doc) return "Recurring entry not found.";
  if (paused) {
    if (doc.pausedAt === null) await recurring.updateOne({ _id: doc._id }, { $set: { pausedAt: new Date(), updatedAt: new Date() } });
    return null;
  }
  if (!(await findUsableCategory(ledgerId, (doc.subcategoryId ?? doc.categoryId).toHexString()))) {
    return "Its category was removed. Edit it to pick another, then resume.";
  }
  const start = toIso(doc.startDate);
  const end = doc.endDate && toIso(doc.endDate);
  let k = doc.nextIndex;
  while (occurrence(start, doc.unit, doc.every, k) < today) k++;
  const next = occurrence(start, doc.unit, doc.every, k);
  await recurring.updateOne(
    { _id: doc._id },
    { $set: { pausedAt: null, nextIndex: k, nextDate: end && next > end ? null : toUtc(next), updatedAt: new Date() } },
  );
  return null;
}

// Caps one request's work; a rule further behind catches up over the next few requests.
const MAX_GENERATED = 100;

/**
 * Inserts every occurrence due on or before `today` and advances the rules. Runs on each page load.
 * Inserting before advancing means a crash in between only repeats inserts, which the unique
 * {recurringId, date} index drops; the nextIndex guard stops two requests advancing a rule twice.
 */
export async function generateDueRecurring(ledgerId: string, today: string): Promise<void> {
  const due = await recurring.find({ ledgerId, pausedAt: null, nextDate: { $lte: toUtc(today) } }).toArray();
  // A card entry's statement comes from the card's cutoff now; a rule whose card is gone generates with no method.
  const cardIds = due.flatMap((r) => (r.method === "card" && r.cardId ? [r.cardId] : []));
  const cutoffs = new Map(
    cardIds.length
      ? (await cards.find({ _id: { $in: cardIds }, ledgerId }, { projection: { cutoffDay: 1 } }).toArray()).map((c) => [c._id.toHexString(), c.cutoffDay])
      : [],
  );
  for (const rule of due) {
    const cutoffDay = rule.cardId && cutoffs.get(rule.cardId.toHexString());
    const payment = (d: string): Pick<TransactionDoc, "method" | "cardId" | "statementDate"> =>
      rule.method === "card"
        ? cutoffDay
          ? { method: "card", cardId: rule.cardId, statementDate: toUtc(statementFor(d, cutoffDay)) }
          : {}
        : rule.method
          ? { method: rule.method }
          : {};
    const start = toIso(rule.startDate);
    const end = rule.endDate && toIso(rule.endDate);
    const dates: string[] = [];
    let k = rule.nextIndex;
    let date = occurrence(start, rule.unit, rule.every, k);
    while (date <= today && (!end || date <= end) && dates.length < MAX_GENERATED) {
      dates.push(date);
      date = occurrence(start, rule.unit, rule.every, ++k);
    }
    const now = new Date();
    if (dates.length) {
      await transactions
        .insertMany(
          dates.map((d) => ({
            _id: new ObjectId(),
            ledgerId,
            createdBy: rule.createdBy,
            type: rule.type,
            amount: rule.amount,
            note: rule.note,
            categoryId: rule.categoryId,
            subcategoryId: rule.subcategoryId,
            date: toUtc(d),
            recurringId: rule._id,
            ...payment(d),
            createdAt: now,
            updatedAt: now,
          })),
          { ordered: false },
        )
        .catch((error) => {
          // Duplicate key: another request generated some of these first. Anything else is real.
          const errors: { code?: number }[] = [error?.writeErrors ?? error].flat();
          if (!errors.every((e) => e?.code === 11000)) throw error;
        });
    }
    await recurring.updateOne(
      { _id: rule._id, nextIndex: rule.nextIndex },
      { $set: { nextIndex: k, nextDate: end && date > end ? null : toUtc(date), updatedAt: now } },
    );
  }
}

// ---------- Summary ----------

/** `byCategory` maps a top-level category id to its total in the bucket; categories with no transactions are absent. */
export type SeriesPoint = {
  bucket: string;
  expense: number;
  income: number;
  byCategory: Record<string, number>;
  /** Recurring occurrences not generated yet, keyed like `byCategory`. */
  scheduled: { expense: number; income: number; byCategory: Record<string, number> };
};
export type CategoryTotal = {
  id: string;
  name: string;
  icon: IconKey;
  color: string;
  amount: number;
  count: number;
  children: { id: string | null; name: string; amount: number }[];
};
export type Summary = {
  expense: number;
  income: number;
  count: number;
  series: SeriesPoint[];
  expenseByCategory: CategoryTotal[];
  incomeByCategory: CategoryTotal[];
  /** Upcoming occurrences of active recurring rules in the range, not yet transactions. */
  scheduled: { expense: number; income: number; count: number; expenseByCategory: CategoryTotal[]; incomeByCategory: CategoryTotal[] };
  /** Recurring money in the range: generated transactions plus scheduled occurrences. */
  recurring: Record<TxType, { posted: number; scheduled: number; count: number }>;
};

/** Plenty for any chart; a daily rule over a decades-long custom range stops here. */
const MAX_PROJECTED = 5000;

type Row = { bucket: string; type: TxType; cat: string; sub: string | null; total: number; count: number };

/** Occurrences from each active rule's next one through `to`, which generation hasn't reached yet. */
async function projectRecurring(ledgerId: string, range: Range): Promise<Row[]> {
  const rules = await recurring.find({ ledgerId, pausedAt: null, nextDate: { $ne: null, $lte: toUtc(range.to) } }).toArray();
  const rows: Row[] = [];
  for (const rule of rules) {
    const start = toIso(rule.startDate);
    const end = rule.endDate && toIso(rule.endDate);
    const last = end && end < range.to ? end : range.to;
    for (let k = rule.nextIndex, n = 0; n < MAX_PROJECTED; k++, n++) {
      const date = occurrence(start, rule.unit, rule.every, k);
      if (date > last) break;
      if (date < range.from) continue;
      rows.push({
        bucket: startOf(date, range.group),
        type: rule.type,
        cat: rule.categoryId.toHexString(),
        sub: rule.subcategoryId?.toHexString() ?? null,
        total: rule.amount,
        count: 1,
      });
    }
  }
  return rows;
}

export async function getSummary(ledgerId: string, range: Range): Promise<Summary> {
  const match = inRange(ledgerId, range.from, range.to);

  const [rawRows, recurringRows, scheduledRows, cats] = await Promise.all([
    transactions
      .aggregate<{ _id: { bucket: Date; type: TxType; cat: ObjectId; sub: ObjectId | null }; total: number; count: number }>([
        { $match: match },
        {
          $group: {
            _id: {
              bucket: { $dateTrunc: { date: "$date", unit: range.group, timezone: "UTC", startOfWeek: "monday" } },
              type: "$type",
              cat: "$categoryId",
              sub: "$subcategoryId",
            },
            total: { $sum: "$amount" },
            count: { $sum: 1 },
          },
        },
      ])
      .toArray(),
    transactions
      .aggregate<{ _id: TxType; total: number; count: number }>([
        { $match: { ...match, recurringId: { $exists: true } } },
        { $group: { _id: "$type", total: { $sum: "$amount" }, count: { $sum: 1 } } },
      ])
      .toArray(),
    projectRecurring(ledgerId, range),
    listCategories(ledgerId, { includeArchived: true }),
  ]);
  const rows: Row[] = rawRows.map((r) => ({
    bucket: toIso(r._id.bucket),
    type: r._id.type,
    cat: r._id.cat.toHexString(),
    sub: r._id.sub?.toHexString() ?? null,
    total: r.total,
    count: r.count,
  }));

  const series = new Map<string, SeriesPoint>();
  for (const b of buckets(range.from, range.to, range.group)) {
    series.set(b, { bucket: b, expense: 0, income: 0, byCategory: {}, scheduled: { expense: 0, income: 0, byCategory: {} } });
  }
  const totals = { expense: 0, income: 0, count: 0 };
  const scheduled = { expense: 0, income: 0, count: 0 };
  for (const [list, sum, slot] of [
    [rows, totals, (p: SeriesPoint) => p],
    [scheduledRows, scheduled, (p: SeriesPoint) => p.scheduled],
  ] as const) {
    for (const r of list) {
      const point = series.get(r.bucket);
      if (point) {
        const target = slot(point);
        target[r.type] += r.total;
        target.byCategory[r.cat] = (target.byCategory[r.cat] ?? 0) + r.total;
      }
      sum[r.type] += r.total;
      sum.count += r.count;
    }
  }

  const names = new Map<string, Category>();
  for (const c of cats) {
    names.set(c.id, c);
    for (const child of c.children) names.set(child.id, child);
  }

  function byCategory(list: Row[]): Record<TxType, CategoryTotal[]> {
    const groups: Record<TxType, Map<string, CategoryTotal>> = { expense: new Map(), income: new Map() };
    for (const r of list) {
      const cat = names.get(r.cat);
      const group = groups[r.type];
      const entry =
        group.get(r.cat) ??
        ({
          id: r.cat,
          name: cat?.name ?? "Unknown",
          icon: cat?.icon ?? "tag",
          color: cat?.color ?? "#94a3b8",
          amount: 0,
          count: 0,
          children: [],
        } satisfies CategoryTotal);
      entry.amount += r.total;
      entry.count += r.count;
      // Rows are split by bucket too, so a subcategory can appear more than once.
      const child = entry.children.find((c) => c.id === r.sub);
      if (child) child.amount += r.total;
      else {
        entry.children.push({
          id: r.sub,
          name: r.sub ? (names.get(r.sub)?.name ?? "Unknown") : `${entry.name} (general)`,
          amount: r.total,
        });
      }
      group.set(r.cat, entry);
    }
    const sorted = (m: Map<string, CategoryTotal>) =>
      [...m.values()]
        .map((c) => ({ ...c, children: c.children.sort((a, b) => b.amount - a.amount) }))
        .sort((a, b) => b.amount - a.amount);
    return { expense: sorted(groups.expense), income: sorted(groups.income) };
  }
  const actual = byCategory(rows);
  const upcoming = byCategory(scheduledRows);

  const recurringTotals = (type: TxType) => {
    const posted = recurringRows.find((r) => r._id === type);
    const ahead = scheduledRows.filter((r) => r.type === type);
    return {
      posted: posted?.total ?? 0,
      scheduled: ahead.reduce((sum, r) => sum + r.total, 0),
      count: (posted?.count ?? 0) + ahead.length,
    };
  };

  return {
    ...totals,
    series: [...series.values()],
    expenseByCategory: actual.expense,
    incomeByCategory: actual.income,
    scheduled: { ...scheduled, expenseByCategory: upcoming.expense, incomeByCategory: upcoming.income },
    recurring: { expense: recurringTotals("expense"), income: recurringTotals("income") },
  };
}

// ---------- Budgets ----------

export type BudgetStatus = {
  categoryId: string;
  name: string;
  icon: IconKey;
  color: string;
  budget: number | null;
  spent: number;
  archived: boolean;
};

/** Each category's budget for `month` (YYYY-MM-01): its latest entry starting on or before it. */
function budgetsFor(docs: BudgetDoc[], month: string): Map<string, number> {
  const latest = new Map<string, BudgetDoc>();
  for (const b of docs) {
    const from = b.from ?? "";
    if (from > month) continue;
    const id = b.categoryId.toHexString();
    const seen = latest.get(id);
    if (!seen || from > (seen.from ?? "")) latest.set(id, b);
  }
  return new Map([...latest].flatMap(([id, b]) => (b.amount === null ? [] : [[id, b.amount] as const])));
}

/**
 * Every top-level expense category with its budget for the month (if any) and spend. With `past`,
 * categories archived after the month began are included too, so a past month shows what it had.
 */
export async function getBudgetStatus(
  ledgerId: string,
  monthStart: string,
  monthEnd: string,
  { past = false }: { past?: boolean } = {},
): Promise<BudgetStatus[]> {
  await ensureSetup();
  const [cats, budgetDocs, spentRows] = await Promise.all([
    categories
      .find({
        $and: [
          visibleTo(ledgerId),
          { type: "expense", parentId: null },
          past ? { $or: [{ archivedAt: null }, { archivedAt: { $gt: toUtc(monthStart) } }] } : { archivedAt: null },
        ],
      })
      .sort({ createdAt: 1, _id: 1 })
      .toArray(),
    budgets.find({ ledgerId }).toArray(),
    transactions
      .aggregate<{ _id: ObjectId; total: number }>([
        {
          // A card purchase counts in its statement's month; everything else in the month of its date.
          $match: {
            ledgerId,
            type: "expense",
            $or: [
              { statementDate: { $gte: toUtc(monthStart), $lte: toUtc(monthEnd) } },
              { statementDate: null, date: { $gte: toUtc(monthStart), $lte: toUtc(monthEnd) } },
            ],
          },
        },
        { $group: { _id: "$categoryId", total: { $sum: "$amount" } } },
      ])
      .toArray(),
  ]);
  const budgetBy = budgetsFor(budgetDocs, monthStart);
  const spentBy = new Map(spentRows.map((r) => [r._id.toHexString(), r.total]));
  // System categories first, matching listCategories.
  cats.sort((a, b) => Number(a.ledgerId !== null) - Number(b.ledgerId !== null));
  return cats
    .map((doc) => {
      const c = toCategory(doc);
      return {
        categoryId: c.id,
        name: c.name,
        icon: c.icon,
        color: c.color,
        budget: budgetBy.get(c.id) ?? null,
        spent: spentBy.get(c.id) ?? 0,
        archived: c.archived,
      };
    })
    // An archived category only shows in a past month it budgeted or spent in.
    .filter((r) => !r.archived || r.budget !== null || r.spent > 0);
}

/**
 * The most all budgets may add up to: the recurring net per month (recurring income minus recurring
 * expenses). Null, meaning no cap, when no recurring income is set up.
 */
export async function getBudgetLimit(ledgerId: string): Promise<number | null> {
  const { income, net } = monthlyTotals(await listRecurring(ledgerId));
  return income > 0 ? Math.max(0, net) : null;
}

/** Set a category's budget from `month` (YYYY-MM-01) on. Earlier months keep theirs. */
export async function setBudget(ledgerId: string, categoryId: string, amount: number | null, month: string): Promise<string | null> {
  const cat = await findUsableCategory(ledgerId, categoryId);
  if (!cat || cat.type !== "expense" || cat.parentId) return "Budgets apply to top-level expense categories.";
  const docs = await budgets.find({ ledgerId }).toArray();
  if (amount !== null) {
    const [limit, archived] = await Promise.all([
      getBudgetLimit(ledgerId),
      categories.distinct("_id", { ledgerId, archivedAt: { $ne: null } }),
    ]);
    const archivedIds = new Set(archived.map((id) => id.toHexString()));
    const current = budgetsFor(docs, month);
    const own = cat._id.toHexString();
    let others = 0;
    for (const [id, value] of current) if (id !== own && !archivedIds.has(id)) others += value;
    // Lowering a budget is always allowed, so a ledger already over its limit can work back under it.
    if (limit !== null && amount > (current.get(own) ?? 0) && others + amount > limit) {
      const { currency } = await getSettings(ledgerId);
      const room = Math.max(0, limit - others);
      return `Budgets can total at most ${formatMoney(limit, currency)}, your recurring net per month. ${formatMoney(room, currency)} is left for this one.`;
    }
  }
  // An entry that repeats the previous month's budget adds nothing, so drop it instead.
  const before = budgetsFor(
    docs.filter((b) => b.categoryId.equals(cat._id)),
    addMonths(month, -1),
  ).get(cat._id.toHexString()) ?? null;
  if (amount === before) {
    await budgets.deleteOne({ ledgerId, categoryId: cat._id, from: month });
  } else {
    await budgets.updateOne({ ledgerId, categoryId: cat._id, from: month }, { $set: { amount } }, { upsert: true });
  }
  return null;
}

// ---------- Export ----------

export async function exportRows(ledgerId: string, from: string, to: string) {
  const [txs, cats] = await Promise.all([
    listTransactions(ledgerId, from, to),
    listCategories(ledgerId, { includeArchived: true }),
  ]);
  const names = new Map<string, string>();
  for (const c of cats) {
    names.set(c.id, c.name);
    for (const child of c.children) names.set(child.id, child.name);
  }
  return txs
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((t) => ({
      date: t.date,
      type: t.type,
      category: names.get(t.categoryId) ?? "",
      subcategory: t.subcategoryId ? (names.get(t.subcategoryId) ?? "") : "",
      amount: (t.amount / 100).toFixed(2),
      note: t.note,
    }));
}

// ---------- Moving a ledger (accepting a household invite) ----------
// These take an optional session so they can run inside a transaction. Operations in a transaction
// must not overlap, so everything here runs sequentially.

export type LedgerCounts = { transactions: number; categories: number; budgets: number; recurring: number };

/** What a ledger holds: transactions, active custom categories and budgets. */
export async function countLedgerData(ledgerId: string, session?: ClientSession): Promise<LedgerCounts> {
  return {
    transactions: await transactions.countDocuments({ ledgerId }, { session }),
    categories: await categories.countDocuments({ ledgerId, archivedAt: null }, { session }),
    budgets: (await budgets.distinct("categoryId", { ledgerId, amount: { $ne: null } }, { session })).length,
    recurring: await recurring.countDocuments({ ledgerId }, { session }),
  };
}

/** Permanently delete everything on a ledger. System categories are untouched. */
export async function deleteLedgerData(ledgerId: string, session?: ClientSession): Promise<void> {
  await transactions.deleteMany({ ledgerId }, { session });
  await recurring.deleteMany({ ledgerId }, { session });
  await budgets.deleteMany({ ledgerId }, { session });
  await categories.deleteMany({ ledgerId }, { session });
  await cards.deleteMany({ ledgerId }, { session });
  await settings.deleteOne({ _id: ledgerId }, { session });
  await insights.deleteOne({ _id: ledgerId }, { session });
}

/**
 * Move a ledger's categories, transactions, recurring rules and budgets into another ledger. An active custom category
 * matching an active one visible there (same type, same parent, name ignoring case) is folded into it
 * and archived. The target's budgets and currency win over the source's.
 */
export async function mergeLedgerInto(fromLedgerId: string, toLedgerId: string, session?: ClientSession): Promise<void> {
  const now = new Date();
  const sources = await categories.find({ ledgerId: fromLedgerId }, { session }).toArray();
  const targets = await categories.find({ ...visibleTo(toLedgerId), archivedAt: null }, { session }).toArray();

  // Top-level categories first, so children see their parent's mapping.
  sources.sort((a, b) => Number(a.parentId !== null) - Number(b.parentId !== null));
  const idMap = new Map<string, ObjectId>();
  const mapped = (id: ObjectId) => idMap.get(id.toHexString()) ?? id;
  const categoryOps: AnyBulkWriteOperation<CategoryDoc>[] = [];
  for (const c of sources) {
    const parentId = c.parentId && mapped(c.parentId);
    const name = c.name.toLowerCase();
    const match =
      c.archivedAt === null
        ? targets.find((t) => t.type === c.type && String(t.parentId) === String(parentId) && t.name.toLowerCase() === name)
        : undefined;
    idMap.set(c._id.toHexString(), match?._id ?? c._id);
    categoryOps.push({
      updateOne: {
        filter: { _id: c._id },
        update: { $set: { ledgerId: toLedgerId, parentId, ...(match ? { archivedAt: now } : {}) } },
      },
    });
  }
  if (categoryOps.length) await categories.bulkWrite(categoryOps, { session });

  const txOps: AnyBulkWriteOperation<TransactionDoc>[] = [];
  for (const [from, to] of idMap) {
    if (from === to.toHexString()) continue;
    const old = new ObjectId(from);
    txOps.push(
      { updateMany: { filter: { ledgerId: fromLedgerId, categoryId: old }, update: { $set: { categoryId: to } } } },
      { updateMany: { filter: { ledgerId: fromLedgerId, subcategoryId: old }, update: { $set: { subcategoryId: to } } } },
    );
  }
  if (txOps.length) await transactions.bulkWrite(txOps, { session });
  await transactions.updateMany({ ledgerId: fromLedgerId }, { $set: { ledgerId: toLedgerId } }, { session });

  const ruleOps: AnyBulkWriteOperation<RecurringDoc>[] = [];
  for (const [from, to] of idMap) {
    if (from === to.toHexString()) continue;
    const old = new ObjectId(from);
    ruleOps.push(
      { updateMany: { filter: { ledgerId: fromLedgerId, categoryId: old }, update: { $set: { categoryId: to } } } },
      { updateMany: { filter: { ledgerId: fromLedgerId, subcategoryId: old }, update: { $set: { subcategoryId: to } } } },
    );
  }
  if (ruleOps.length) await recurring.bulkWrite(ruleOps, { session });
  await recurring.updateMany({ ledgerId: fromLedgerId }, { $set: { ledgerId: toLedgerId } }, { session });
  await cards.updateMany({ ledgerId: fromLedgerId }, { $set: { ledgerId: toLedgerId } }, { session });

  // When both ledgers budget the same category, the target's budget history wins whole.
  const sourceBudgets = await budgets.find({ ledgerId: fromLedgerId }, { session }).toArray();
  const targetBudgets = await budgets.find({ ledgerId: toLedgerId }, { session }).toArray();
  const taken = new Set(targetBudgets.map((b) => b.categoryId.toHexString()));
  // Two source categories folded into one target could both have an entry for the same month.
  const moved = new Set<string>();
  for (const b of sourceBudgets) {
    const categoryId = mapped(b.categoryId);
    const key = `${categoryId.toHexString()}:${b.from ?? ""}`;
    if (taken.has(categoryId.toHexString()) || moved.has(key)) {
      await budgets.deleteOne({ _id: b._id }, { session });
    } else {
      moved.add(key);
      await budgets.updateOne({ _id: b._id }, { $set: { ledgerId: toLedgerId, categoryId } }, { session });
    }
  }

  await settings.deleteOne({ _id: fromLedgerId }, { session });
  // Both ledgers' advice describes data that just changed.
  await insights.deleteMany({ _id: { $in: [fromLedgerId, toLedgerId] } }, { session });
}
