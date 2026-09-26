"use client";

import { useActionState, useState } from "react";
import {
  changeRoleAction,
  inviteMemberAction,
  revokeInviteAction,
  setMemberStatusAction,
  setMemberVenuesAction,
} from "@/modules/team/actions";
import type { PendingInvite, TeamMember } from "@/modules/team/service";
import { IDLE, fieldError, valueOf, type ActionState } from "@/lib/action-state";
import { formatDate, formatRelative } from "@/lib/datetime";
import { ROLES, ROLE_LABELS } from "@/lib/domain";
import { Button } from "@/components/ui/button";
import { Avatar, Badge, Card, CardHeader, Field, FormAlert, describedBy } from "@/components/ui/primitives";
import { IconCheck } from "@/components/ui/icons";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toaster";

/**
 * Ekip yönetimi: davet bağlantısı üretme, rol değiştirme, mekan erişimi ve erişim kapatma.
 * Davet bağlantısı yalnızca üretildiği anda gösterilir; sunucuda ham kod saklanmaz.
 */

type Venue = { id: string; name: string };

function VenuePicker({ venues, selected, idPrefix }: { venues: Venue[]; selected: string[]; idPrefix: string }) {
  return (
    <fieldset className="mt-3">
      <legend className="text-[12px] text-muted">Mekan erişimi — hiçbiri seçilmezse tüm mekanlar</legend>
      <div className="mt-2 flex flex-wrap gap-2">
        {venues.map((v) => (
          <label
            key={v.id}
            htmlFor={`${idPrefix}-${v.id}`}
            className="inline-flex cursor-pointer items-center gap-2 rounded-field border border-line px-3 py-1.5 text-[13px] text-fg transition-colors hover:border-line-strong has-checked:border-fg has-checked:bg-raised"
          >
            <input id={`${idPrefix}-${v.id}`} type="checkbox" name="venueIds" value={v.id} defaultChecked={selected.includes(v.id)} className="size-3.5 accent-white" />
            {v.name}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function InviteLink({ url, expiresAt }: { url: string; expiresAt: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-field border border-positive/30 bg-positive/[0.05] p-3.5">
      <p className="text-[13px] text-fg">Davet bağlantısı hazır. Kişiye kendiniz iletin — e-posta gönderilmez.</p>
      <div className="mt-2.5 flex flex-col gap-2 sm:flex-row">
        <code className="min-w-0 flex-1 truncate rounded-field border border-line bg-bg px-3 py-2 font-mono text-[12px] text-muted">{url}</code>
        <Button
          size="md"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(url);
              setCopied(true);
              toast("Davet bağlantısı kopyalandı.");
              window.setTimeout(() => setCopied(false), 2000);
            } catch {
              toast("Kopyalanamadı; bağlantıyı elle seçip kopyalayın.", "error");
            }
          }}
        >
          {copied && <IconCheck size={14} />}
          {copied ? "Kopyalandı" : "Kopyala"}
        </Button>
      </div>
      <p className="mt-2.5 text-[12px] leading-relaxed text-muted">
        {formatDate(new Date(expiresAt))} tarihine kadar geçerli, bir kez kullanılır. Bu bağlantı bir daha gösterilmez; kaybolursa yeni davet
        oluşturun (eskisi geçersiz olur).
      </p>
    </div>
  );
}

function InviteForm({ venues }: { venues: Venue[] }) {
  const [state, action, pending] = useActionState(inviteMemberAction, IDLE);
  const created = state.status === "success" ? (state.data as { url: string; expiresAt: string } | undefined) : undefined;
  const generalError = state.status === "error" && !state.fieldErrors ? state.message : null;

  return (
    <form action={action} className="space-y-4 p-5" noValidate>
      {generalError && <FormAlert tone="error">{generalError}</FormAlert>}
      {created && <InviteLink url={created.url} expiresAt={created.expiresAt} />}

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Ad soyad" htmlFor="invite-name" required showOptional={false} error={fieldError(state, "name")}>
          <input {...describedBy("invite-name", fieldError(state, "name"))} name="name" defaultValue={valueOf(state, "name")} maxLength={80} className="input" />
        </Field>
        <Field label="E-posta" htmlFor="invite-email" required showOptional={false} error={fieldError(state, "email")}>
          <input
            {...describedBy("invite-email", fieldError(state, "email"))}
            name="email"
            type="email"
            autoComplete="off"
            defaultValue={valueOf(state, "email")}
            maxLength={254}
            className="input"
          />
        </Field>
        <Field label="Rol" htmlFor="invite-role" required showOptional={false} error={fieldError(state, "role")}>
          <select {...describedBy("invite-role", fieldError(state, "role"))} name="role" defaultValue={valueOf(state, "role", "DOOR")} className="input">
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {venues.length > 1 && <VenuePicker venues={venues} selected={[]} idPrefix="invite-venue" />}

      <div className="flex items-center gap-3">
        <Button type="submit" variant="primary" disabled={pending}>
          {pending && <Spinner size={14} />}
          Davet bağlantısı oluştur
        </Button>
        <p className="text-[12px] text-muted">Kişi bağlantıyı açıp kendi şifresini belirler.</p>
      </div>
    </form>
  );
}

/** Tek satırlık işlem formu: sonuç bildirimi toast ile verilir. */
function RowForm({
  action,
  children,
  className = "",
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  children: (pending: boolean) => React.ReactNode;
  className?: string;
}) {
  const [state, formAction, pending] = useActionState(action, IDLE);
  const [seen, setSeen] = useState(0);
  if (state.status !== "idle" && state.at !== seen) {
    setSeen(state.at);
    toast(state.message, state.status === "error" ? "error" : "success");
  }
  return (
    <form action={formAction} className={className}>
      {children(pending)}
    </form>
  );
}

function MemberRow({ member, venues }: { member: TeamMember; venues: Venue[] }) {
  const [editingVenues, setEditingVenues] = useState(false);
  return (
    <li className="border-line px-5 py-4 [&+li]:border-t">
      {/* Satır dar alanda alt alta iner: ad/e-posta sütunu işlem düğmeleri yüzünden sıkışmasın. */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="flex min-w-[200px] flex-1 items-center gap-3">
          <Avatar name={member.name} size={32} />
          <div className="min-w-0">
            <p className="truncate text-sm text-fg">
              {member.name}
              {member.isSelf && <span className="ml-2 text-[12px] text-muted">(siz)</span>}
            </p>
            <p className="truncate text-xs text-muted">{member.email}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 pl-11 lg:pl-0">
          {!member.active && <Badge tone="negative">Erişim kapalı</Badge>}
          <span className="text-xs text-muted">{member.lastLoginAt ? `Son giriş ${formatRelative(member.lastLoginAt)}` : "Henüz giriş yapmadı"}</span>

          {member.isSelf ? (
            <Badge>{ROLE_LABELS[member.role]}</Badge>
          ) : (
            <RowForm action={changeRoleAction}>
              {(pending) => (
                <>
                  <input type="hidden" name="membershipId" value={member.membershipId} />
                  <label htmlFor={`role-${member.membershipId}`} className="sr-only">
                    {member.name} rolü
                  </label>
                  <select
                    id={`role-${member.membershipId}`}
                    name="role"
                    defaultValue={member.role}
                    disabled={pending}
                    onChange={(e) => e.currentTarget.form?.requestSubmit()}
                    className="input !h-8 !min-h-8 w-auto !py-0 !text-[13px]"
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABELS[r]}
                      </option>
                    ))}
                  </select>
                </>
              )}
            </RowForm>
          )}

          {venues.length > 1 && (
            <Button size="sm" variant="ghost" onClick={() => setEditingVenues((v) => !v)} aria-expanded={editingVenues}>
              {member.venueNames.length > 0 ? member.venueNames.join(", ") : "Tüm mekanlar"}
            </Button>
          )}

          {!member.isSelf && (
            <RowForm action={setMemberStatusAction}>
              {(pending) => (
                <>
                  <input type="hidden" name="membershipId" value={member.membershipId} />
                  <input type="hidden" name="active" value={member.active ? "false" : "true"} />
                  <Button size="sm" variant={member.active ? "danger" : "secondary"} type="submit" disabled={pending}>
                    {pending && <Spinner size={13} />}
                    {member.active ? "Erişimi kapat" : "Erişimi aç"}
                  </Button>
                </>
              )}
            </RowForm>
          )}
        </div>
      </div>

      {editingVenues && venues.length > 1 && (
        <RowForm action={setMemberVenuesAction} className="mt-2 rounded-field border border-line bg-raised/40 p-3.5">
          {(pending) => (
            <>
              <input type="hidden" name="membershipId" value={member.membershipId} />
              <VenuePicker venues={venues} selected={member.venueIds} idPrefix={`venue-${member.membershipId}`} />
              <div className="mt-3 flex gap-2">
                <Button size="sm" variant="primary" type="submit" disabled={pending}>
                  {pending && <Spinner size={13} />}
                  Kaydet
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditingVenues(false)}>
                  Vazgeç
                </Button>
              </div>
            </>
          )}
        </RowForm>
      )}
    </li>
  );
}

export function TeamManager({ members, invites, venues }: { members: TeamMember[]; invites: PendingInvite[]; venues: Venue[] }) {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Ekip" description="Roller ve mekan erişimi sunucu tarafında uygulanır." />
        <ul>
          {members.map((m) => (
            <MemberRow key={m.membershipId} member={m} venues={venues} />
          ))}
        </ul>
      </Card>

      <Card>
        <CardHeader title="Ekibe kişi davet et" description="E-posta gönderilmez; bağlantıyı siz iletirsiniz." />
        <InviteForm venues={venues} />
      </Card>

      {invites.length > 0 && (
        <Card>
          <CardHeader title="Bekleyen davetler" description="Kullanılmamış bağlantılar." />
          <ul>
            {invites.map((invite) => (
              <li key={invite.id} className="flex flex-col gap-2 border-line px-5 py-3.5 sm:flex-row sm:items-center [&+li]:border-t">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-fg">{invite.name}</p>
                  <p className="truncate text-xs text-muted">{invite.email}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="muted">{ROLE_LABELS[invite.role]}</Badge>
                  {invite.venueNames.length > 0 && <Badge tone="muted">{invite.venueNames.join(", ")}</Badge>}
                  <span className="text-xs text-muted">
                    {invite.expired ? "Süresi doldu" : `${formatDate(invite.expiresAt)} tarihine kadar geçerli`}
                  </span>
                  <RowForm action={revokeInviteAction}>
                    {(pending) => (
                      <>
                        <input type="hidden" name="inviteId" value={invite.id} />
                        <Button size="sm" variant="ghost" type="submit" disabled={pending}>
                          {pending && <Spinner size={13} />}
                          İptal et
                        </Button>
                      </>
                    )}
                  </RowForm>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
