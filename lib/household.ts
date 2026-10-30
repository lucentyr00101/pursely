import "server-only";
import { MongoServerError, ObjectId, type ClientSession } from "mongodb";
import { client, db } from "./db";
import { countLedgerData, deleteLedgerData, ensureSetup, getSettings, mergeLedgerInto } from "./data";

export type Role = "owner" | "editor" | "viewer";
type InviteRole = "editor" | "viewer";

/** Whose data the signed-in user is looking at, and what they may do with it. */
export type LedgerContext = { userId: string; ledgerId: string; role: Role; householdId: string | null };

export type HouseholdDoc = {
  _id: ObjectId;
  ledgerId: string;
  ownerId: string;
  members: { userId: string; role: Role; joinedAt: Date }[];
};

/** Pins a user to a ledger other than their own (e.g. after leaving a household). */
export type UserLedgerDoc = { _id: string; ledgerId: string }; // _id = userId

type InviteDoc = {
  _id: ObjectId;
  householdId: ObjectId;
  email: string; // lowercased
  role: InviteRole;
  invitedBy: string;
  createdAt: Date;
};

/** Better Auth's user collection; the hex of `_id` is the userId. */
type UserDoc = { _id: ObjectId; name: string; email: string; image?: string | null };

export const households = db.collection<HouseholdDoc>("households");
export const userLedgers = db.collection<UserLedgerDoc>("userLedgers");
const invites = db.collection<InviteDoc>("invites");
const users = db.collection<UserDoc>("user");

let setup: Promise<void> | null = null;

/** Data setup plus the household indexes, once per server process. */
function ensureHouseholdSetup(): Promise<void> {
  setup ??= (async () => {
    await ensureSetup();
    await Promise.all([
      households.createIndex({ ledgerId: 1 }, { unique: true }),
      households.createIndex({ "members.userId": 1 }, { unique: true }),
      invites.createIndex({ householdId: 1, email: 1 }, { unique: true }),
      invites.createIndex({ email: 1 }),
    ]);
  })().catch((error) => {
    setup = null;
    throw error;
  });
  return setup;
}

/** The ledger a user works in: their household's, a pinned one, or their own. */
export async function resolveLedger(userId: string): Promise<LedgerContext> {
  await ensureHouseholdSetup();
  const household = await households.findOne({ "members.userId": userId });
  if (household) {
    const member = household.members.find((m) => m.userId === userId)!;
    return { userId, ledgerId: household.ledgerId, role: member.role, householdId: household._id.toHexString() };
  }
  const pinned = await userLedgers.findOne({ _id: userId });
  if (pinned) return { userId, ledgerId: pinned.ledgerId, role: "owner", householdId: null };
  return { userId, ledgerId: userId, role: "owner", householdId: null };
}

// ---------- Reading ----------

export type Member = { userId: string; name: string; email: string; image: string | null; role: Role };
export type Household = { id: string; ownerId: string; members: Member[] };
export type OutgoingInvite = { id: string; email: string; role: InviteRole };
/** `blocked`: the invitee shares a household with others and must sort that out before joining. */
export type IncomingInvite = { id: string; ownerName: string; role: InviteRole; blocked: boolean };
export type AcceptPreview = {
  transactions: number;
  categories: number;
  budgets: number;
  recurring: number;
  cards: number;
  currency: string;
  householdCurrency: string;
};

const toObjectId = (id: string) => (ObjectId.isValid(id) ? new ObjectId(id) : null);
const normalizeEmail = (email: string) => email.trim().toLowerCase();

async function findUsers(ids: string[]) {
  const objectIds = ids.map(toObjectId).filter((id) => id !== null);
  const docs = await users.find({ _id: { $in: objectIds } }).toArray();
  return new Map(docs.map((u) => [u._id.toHexString(), u]));
}

export async function getHousehold(householdId: string): Promise<Household | null> {
  const _id = toObjectId(householdId);
  const doc = _id && (await households.findOne({ _id }));
  if (!doc) return null;
  const byId = await findUsers(doc.members.map((m) => m.userId));
  const members = doc.members
    .toSorted((a, b) => Number(b.role === "owner") - Number(a.role === "owner") || +a.joinedAt - +b.joinedAt)
    .map((m) => {
      const user = byId.get(m.userId);
      return { userId: m.userId, name: user?.name ?? "", email: user?.email ?? "", image: user?.image ?? null, role: m.role };
    });
  return { id: householdId, ownerId: doc.ownerId, members };
}

/** Names and avatars by userId, for showing who logged a transaction. */
export async function listUsers(ids: string[]): Promise<Record<string, { name: string; image: string | null }>> {
  const byId = await findUsers([...new Set(ids)]);
  return Object.fromEntries([...byId].map(([id, u]) => [id, { name: u.name, image: u.image ?? null }]));
}

export async function listOutgoingInvites(householdId: string): Promise<OutgoingInvite[]> {
  const _id = toObjectId(householdId);
  if (!_id) return [];
  const docs = await invites.find({ householdId: _id }).sort({ createdAt: 1 }).toArray();
  return docs.map((d) => ({ id: d._id.toHexString(), email: d.email, role: d.role }));
}

export async function listIncomingInvites(ctx: LedgerContext, email: string): Promise<IncomingInvite[]> {
  const docs = await invites.find({ email: normalizeEmail(email) }).sort({ createdAt: 1 }).toArray();
  if (!docs.length) return [];
  const own = await households.findOne({ "members.userId": ctx.userId });
  const blocked = (own?.members.length ?? 0) > 1;
  const owners = await households.find({ _id: { $in: docs.map((d) => d.householdId) } }).toArray();
  const ownerOf = new Map(owners.map((h) => [h._id.toHexString(), h.ownerId]));
  const names = await findUsers([...ownerOf.values()]);
  return docs.map((d) => ({
    id: d._id.toHexString(),
    ownerName: names.get(ownerOf.get(d.householdId.toHexString()) ?? "")?.name ?? "Someone",
    role: d.role,
    blocked,
  }));
}

async function findInvite(email: string, inviteId: string, session?: ClientSession) {
  const _id = toObjectId(inviteId);
  return _id && invites.findOne({ _id, email: normalizeEmail(email) }, { session });
}

export async function getAcceptPreview(ctx: LedgerContext, email: string, inviteId: string): Promise<AcceptPreview | null> {
  if (typeof inviteId !== "string") return null;
  const invite = await findInvite(email, inviteId);
  const household = invite && (await households.findOne({ _id: invite.householdId }));
  if (!household) return null;
  const [counts, mine, theirs] = await Promise.all([
    countLedgerData(ctx.ledgerId),
    getSettings(ctx.ledgerId),
    getSettings(household.ledgerId),
  ]);
  return { ...counts, currency: mine.currency, householdCurrency: theirs.currency };
}

// ---------- Invites ----------

const OWNER_ONLY = "Only the household owner can do that.";
const NOT_A_MEMBER = "They're not in your household.";

/** Membership edits run in a transaction so a half-applied change can't happen. */
function inTransaction<T>(fn: (session: ClientSession) => Promise<T>): Promise<T> {
  return client.withSession((session) => session.withTransaction(() => fn(session)));
}

export async function createInvite(ctx: LedgerContext, email: string, role: InviteRole): Promise<string | null> {
  if (ctx.role !== "owner") return OWNER_ONLY;
  await ensureHouseholdSetup();
  const normalized = normalizeEmail(email);
  const invitee = await users.findOne({ email: normalized });
  if (!invitee) return "No account uses that email. Ask them to sign in once first.";
  const inviteeId = invitee._id.toHexString();
  if (inviteeId === ctx.userId) return "That's you.";
  const theirs = await households.findOne({ "members.userId": inviteeId });
  if (theirs && theirs._id.toHexString() === ctx.householdId) return "They're already in your household.";
  if (theirs && theirs.members.length > 1) return "They already share a household with someone else.";

  // The first invite turns the owner's ledger into a household.
  const household = ctx.householdId
    ? { _id: new ObjectId(ctx.householdId), ownerId: ctx.userId }
    : await households
        .findOneAndUpdate(
          { ledgerId: ctx.ledgerId },
          { $setOnInsert: { ownerId: ctx.userId, members: [{ userId: ctx.userId, role: "owner", joinedAt: new Date() }] } },
          { upsert: true, returnDocument: "after" },
        )
        .catch((error) => {
          // Two first invites at once both try to insert; the loser reads the winner's household.
          if (!(error instanceof MongoServerError) || error.code !== 11000) throw error;
          return households.findOne({ ledgerId: ctx.ledgerId });
        });
  if (!household || household.ownerId !== ctx.userId) return OWNER_ONLY;
  await invites.updateOne(
    { householdId: household._id, email: normalized },
    { $set: { role, invitedBy: ctx.userId }, $setOnInsert: { createdAt: new Date() } },
    { upsert: true },
  );
  return null;
}

export async function cancelInvite(ctx: LedgerContext, inviteId: string): Promise<void> {
  if (typeof inviteId !== "string") return;
  const _id = toObjectId(inviteId);
  if (ctx.role !== "owner" || !ctx.householdId || !_id) return;
  const householdId = new ObjectId(ctx.householdId);
  await inTransaction(async (session) => {
    const { deletedCount } = await invites.deleteOne({ _id, householdId }, { session });
    if (!deletedCount) return;
    // An owner left with nobody and no pending invites turns back into a solo user, as on leaving alone.
    const household = await households.findOne({ _id: householdId, ownerId: ctx.userId }, { session });
    if (!household || household.members.length > 1) return;
    if (await invites.countDocuments({ householdId }, { session })) return;
    await dissolve(household, session);
  });
}

export async function declineInvite(email: string, inviteId: string): Promise<void> {
  if (typeof inviteId !== "string") return;
  const _id = toObjectId(inviteId);
  if (!_id) return;
  await invites.deleteOne({ _id, email: normalizeEmail(email) });
}

/** Join the inviting household, merging the invitee's data into it or deleting it first. */
export async function acceptInvite(
  ctx: LedgerContext,
  email: string,
  inviteId: string,
  mode: "merge" | "replace",
): Promise<string | null> {
  if (typeof inviteId !== "string") return "This invite is no longer available.";
  await ensureHouseholdSetup();
  return inTransaction(async (session) => {
    const invite = await findInvite(email, inviteId, session);
    const household = invite && (await households.findOne({ _id: invite.householdId }, { session }));
    if (!invite || !household) return "This invite is no longer available.";

    const own = await households.findOne({ "members.userId": ctx.userId }, { session });
    if (own) {
      if (own.ownerId !== ctx.userId) return "Leave your current household before joining another one.";
      if (own.members.length > 1) return "Transfer ownership or remove everyone before joining another household.";
      await households.deleteOne({ _id: own._id }, { session });
      await invites.deleteMany({ householdId: own._id }, { session });
    }

    if (mode === "replace") await deleteLedgerData(ctx.ledgerId, session);
    else await mergeLedgerInto(ctx.ledgerId, household.ledgerId, session);

    await households.updateOne(
      { _id: household._id },
      { $push: { members: { userId: ctx.userId, role: invite.role, joinedAt: new Date() } } },
      { session },
    );
    await userLedgers.deleteOne({ _id: ctx.userId }, { session });
    await invites.deleteMany({ email: invite.email }, { session });
    return null;
  });
}

// ---------- Membership ----------

/** Filter for the caller's household, only if they still own it. */
function ownedBy(ctx: LedgerContext) {
  return ctx.role === "owner" && ctx.householdId ? { _id: new ObjectId(ctx.householdId), ownerId: ctx.userId } : null;
}

export async function setMemberRole(ctx: LedgerContext, memberId: string, role: InviteRole): Promise<string | null> {
  if (typeof memberId !== "string") return NOT_A_MEMBER;
  const filter = ownedBy(ctx);
  if (!filter) return OWNER_ONLY;
  const result = await households.updateOne(
    { ...filter, members: { $elemMatch: { userId: memberId, role: { $ne: "owner" } } } },
    { $set: { "members.$.role": role } },
  );
  return result.matchedCount ? null : NOT_A_MEMBER;
}

/** Pull a member out and start them on a fresh, empty ledger. Dissolves the household once the owner is alone. */
async function dropMember(householdId: ObjectId, memberId: string, session: ClientSession) {
  await households.updateOne({ _id: householdId }, { $pull: { members: { userId: memberId } } }, { session });
  await userLedgers.updateOne(
    { _id: memberId },
    { $set: { ledgerId: new ObjectId().toHexString() } },
    { upsert: true, session },
  );
  const rest = await households.findOne({ _id: householdId }, { session });
  if (rest && rest.members.length <= 1) await dissolve(rest, session);
}

/** Delete a household of one (or none) and its invites. The member left keeps the household's ledger. */
async function dissolve(household: HouseholdDoc, session: ClientSession) {
  await households.deleteOne({ _id: household._id }, { session });
  await invites.deleteMany({ householdId: household._id }, { session });
  if (household.members[0]) await keepLedger(household.members[0].userId, household.ledgerId, session);
}

/** Keep a user on a ledger once no household points them to it: pin it unless it's their own. */
async function keepLedger(userId: string, ledgerId: string, session: ClientSession) {
  if (ledgerId === userId) await userLedgers.deleteOne({ _id: userId }, { session });
  else await userLedgers.updateOne({ _id: userId }, { $set: { ledgerId } }, { upsert: true, session });
}

export async function removeMember(ctx: LedgerContext, memberId: string): Promise<string | null> {
  if (typeof memberId !== "string") return NOT_A_MEMBER;
  const filter = ownedBy(ctx);
  if (!filter) return OWNER_ONLY;
  if (memberId === ctx.userId) return NOT_A_MEMBER;
  return inTransaction(async (session) => {
    const household = await households.findOne({ ...filter, "members.userId": memberId }, { session });
    if (!household) return NOT_A_MEMBER;
    await dropMember(household._id, memberId, session);
    return null;
  });
}

export async function transferOwnership(ctx: LedgerContext, memberId: string): Promise<string | null> {
  if (typeof memberId !== "string") return NOT_A_MEMBER;
  const filter = ownedBy(ctx);
  if (!filter) return OWNER_ONLY;
  if (memberId === ctx.userId) return NOT_A_MEMBER;
  const result = await households.updateOne(
    { ...filter, "members.userId": memberId },
    { $set: { ownerId: memberId, "members.$[next].role": "owner", "members.$[prev].role": "editor" } },
    { arrayFilters: [{ "next.userId": memberId }, { "prev.userId": ctx.userId }] },
  );
  return result.matchedCount ? null : NOT_A_MEMBER;
}

export async function leaveHousehold(ctx: LedgerContext): Promise<string | null> {
  if (!ctx.householdId) return "You're not in a household.";
  const householdId = new ObjectId(ctx.householdId);
  return inTransaction(async (session) => {
    const household = await households.findOne({ _id: householdId, "members.userId": ctx.userId }, { session });
    if (!household) return "You're not in a household.";
    if (household.ownerId !== ctx.userId) {
      await dropMember(householdId, ctx.userId, session);
      return null;
    }
    if (household.members.length > 1) return "Transfer ownership or remove everyone before leaving.";
    // An owner on their own turns back into a solo user and keeps the ledger.
    await dissolve(household, session);
    return null;
  });
}
