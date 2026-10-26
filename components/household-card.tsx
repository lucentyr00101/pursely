"use client";

import { useActionState, useState, useTransition } from "react";
import { Check, LoaderCircle, Mail, X } from "lucide-react";
import {
  cancelInviteAction,
  changeMemberRole,
  leaveHouseholdAction,
  removeMemberAction,
  sendInvite,
  transferOwnershipAction,
  type ActionState,
} from "@/app/actions";
import type { Household, Member, OutgoingInvite, Role } from "@/lib/household";
import { Modal } from "./modal";
import { Select, type SelectOption } from "./select";
import { FormError } from "./ui";

type InviteRole = OutgoingInvite["role"];
type Dialog = { kind: "remove" | "transfer"; member: Member } | { kind: "leave" };

const ROLE_LABEL: Record<Role, string> = { owner: "Owner", editor: "Editor", viewer: "Viewer" };
const ROLE_OPTIONS: SelectOption<InviteRole>[] = [
  { value: "editor", label: ROLE_LABEL.editor },
  { value: "viewer", label: ROLE_LABEL.viewer },
];

export function HouseholdCard({ household, invites, viewerId, role }: {
  household: Household | null;
  invites: OutgoingInvite[];
  viewerId: string;
  role: Role;
}) {
  const isOwner = role === "owner";
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [error, setError] = useState<string>();
  const close = () => setDialog(null);

  return (
    <div className="flex flex-col gap-5">
      {household ? (
        <ul className="flex flex-col divide-y divide-line">
          {household.members.map((m) => (
            <MemberRow
              key={m.userId}
              member={m}
              isViewer={m.userId === viewerId}
              canManage={isOwner && m.role !== "owner"}
              onDialog={setDialog}
              onError={setError}
            />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">Invite someone who has signed in to this app to share your ledger.</p>
      )}
      <FormError message={error} />

      {isOwner && <InviteForm />}
      {isOwner && invites.length > 0 && (
        <div>
          <h3 className="label">Pending invites</h3>
          <ul className="flex flex-col divide-y divide-line">
            {invites.map((i) => (
              <PendingInvite key={i.id} invite={i} />
            ))}
          </ul>
        </div>
      )}

      {household && !isOwner && (
        <div>
          <button type="button" className="btn btn-danger" onClick={() => setDialog({ kind: "leave" })}>
            Leave household
          </button>
        </div>
      )}

      <Modal
        open={dialog !== null}
        onClose={close}
        title={
          dialog?.kind === "remove"
            ? `Remove ${dialog.member.name || dialog.member.email}?`
            : dialog?.kind === "transfer"
              ? `Make ${dialog.member.name || dialog.member.email} the owner?`
              : "Leave household?"
        }
      >
        {dialog && <Confirm dialog={dialog} onDone={close} />}
      </Modal>
    </div>
  );
}

function Avatar({ member }: { member: Member }) {
  return member.image ? (
    // eslint-disable-next-line @next/next/no-img-element -- Google avatar, tiny and remote
    <img src={member.image} alt="" className="size-9 shrink-0 rounded-full" referrerPolicy="no-referrer" />
  ) : (
    <span aria-hidden className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-on-primary">
      {(member.name || member.email).charAt(0).toUpperCase()}
    </span>
  );
}

function MemberRow({ member, isViewer, canManage, onDialog, onError }: {
  member: Member;
  isViewer: boolean;
  canManage: boolean;
  onDialog: (d: Dialog) => void;
  onError: (message?: string) => void;
}) {
  const [pending, start] = useTransition();
  const name = member.name || member.email;
  return (
    <li className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <Avatar member={member} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">
            {name}
            {isViewer && <span className="text-subtle"> (you)</span>}
          </p>
          <p className="truncate text-xs text-subtle">{member.email}</p>
        </div>
        {!canManage && <span className="text-sm text-muted">{ROLE_LABEL[member.role]}</span>}
      </div>
      {canManage && (
        <div className="flex flex-wrap items-center gap-2">
          <Select
            aria-label={`Role for ${name}`}
            options={ROLE_OPTIONS}
            value={member.role as InviteRole}
            disabled={pending}
            onChange={(role) =>
              start(async () => {
                const result = await changeMemberRole(member.userId, role);
                onError(result.ok ? undefined : result.error);
              })
            }
          />
          <button type="button" className="btn btn-ghost" onClick={() => onDialog({ kind: "transfer", member })}>
            Make owner
          </button>
          <button
            type="button"
            className="btn btn-danger"
            aria-label={`Remove ${name}`}
            onClick={() => onDialog({ kind: "remove", member })}
          >
            Remove
          </button>
        </div>
      )}
    </li>
  );
}

function InviteForm() {
  const [state, action, pending] = useActionState<ActionState, FormData>(sendInvite, { ok: false });
  return (
    <form action={action} className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label htmlFor="invite-email" className="label">
            Invite by email
          </label>
          <input id="invite-email" name="email" type="email" required autoComplete="off" placeholder="name@example.com" className="field" />
        </div>
        <div>
          <label htmlFor="invite-role" className="label">
            Role
          </label>
          <Select id="invite-role" name="role" options={ROLE_OPTIONS} defaultValue="editor" />
        </div>
        <button type="submit" disabled={pending} className="btn btn-primary">
          {pending ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Mail className="size-4" aria-hidden />}
          Send invite
        </button>
      </div>
      {state.ok && (
        <p role="status" className="flex items-center gap-1.5 text-sm text-success">
          <Check className="size-4" aria-hidden /> Invite sent
        </p>
      )}
      <FormError message={state.error} />
    </form>
  );
}

function PendingInvite({ invite }: { invite: OutgoingInvite }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  return (
    <li className="py-2 first:pt-0 last:pb-0">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm">{invite.email}</p>
          <p className="text-xs text-subtle">{ROLE_LABEL[invite.role]}</p>
        </div>
        <button
          type="button"
          disabled={pending}
          className="btn btn-ghost"
          aria-label={`Cancel invite for ${invite.email}`}
          onClick={() =>
            start(async () => {
              const result = await cancelInviteAction(invite.id);
              setError(result.ok ? undefined : result.error);
            })
          }
        >
          {pending ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <X className="size-4" aria-hidden />}
          Cancel
        </button>
      </div>
      <FormError message={error} />
    </li>
  );
}

function Confirm({ dialog, onDone }: { dialog: Dialog; onDone: () => void }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const name = dialog.kind === "leave" ? "" : dialog.member.name || dialog.member.email;
  const text =
    dialog.kind === "remove"
      ? `${name} loses access and starts with an empty ledger. The household keeps everything.`
      : dialog.kind === "transfer"
        ? `${name} becomes the owner and manages members. You stay on as an editor.`
        : "You'll start with an empty ledger. The household keeps everything.";
  const label = dialog.kind === "remove" ? "Remove" : dialog.kind === "transfer" ? "Make owner" : "Leave";

  return (
    <div className="flex flex-col gap-4">
      <p className="text-muted">{text}</p>
      <FormError message={error} />
      <div className="grid grid-cols-2 gap-3">
        <button type="button" className="btn btn-ghost" onClick={onDone}>
          Cancel
        </button>
        <button
          type="button"
          disabled={pending}
          data-autofocus
          className={`btn ${dialog.kind === "transfer" ? "btn-primary" : "btn-danger"}`}
          onClick={() =>
            start(async () => {
              const result =
                dialog.kind === "remove"
                  ? await removeMemberAction(dialog.member.userId)
                  : dialog.kind === "transfer"
                    ? await transferOwnershipAction(dialog.member.userId)
                    : await leaveHouseholdAction();
              if (result.ok) onDone();
              else setError(result.error);
            })
          }
        >
          {pending && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
          {label}
        </button>
      </div>
    </div>
  );
}
