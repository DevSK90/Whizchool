"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { MoreHorizontal, UserPlus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { DataTable } from "@/components/shared/data-table";
import { FilterBar, FilterSelect } from "@/components/shared/filters";
import { PageHeader } from "@/components/shared/page-header";
import { SearchInput } from "@/components/shared/search-input";
import { StatusBadge } from "@/components/shared/status-badge";
import { api, ApiError } from "@/lib/api/client";
import { useApiMutation, useRoles, useUsers, type UserRow } from "@/lib/api/hooks";
import type { Role } from "@whizchool/shared/types";
import { useCan, useSession } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { useUrlState } from "@/hooks/use-url-state";

export default function UsersPage() {
  const t = useTranslations("admin.users");
  const ts = useTranslations("status.user");
  const tn = useTranslations("nav");
  const can = useCan();
  const url = useUrlState<"kind" | "status" | "roleId" | "search" | "sort">({ kind: "staff" });
  const roles = useRoles();
  const list = useUsers({ kind: url.get("kind"), status: url.get("status"), roleId: url.get("roleId"), search: url.get("search"), sort: url.get("sort"), page: url.page, pageSize: 25 });
  const [editing, setEditing] = useState<UserRow | null>(null);

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <>
            {can("roles.view") && (
              <Button variant="outline" asChild>
                <Link href="/app/users/roles">{tn("roles")}</Link>
              </Button>
            )}
            {can("users.create") && <InviteDialog roles={roles.data ?? []} />}
          </>
        }
      />
      <Tabs value={url.get("kind")} onValueChange={(v) => url.set({ kind: v })} className="mb-4">
        <TabsList>
          {(["staff", "parent", "all"] as const).map((k) => (
            <TabsTrigger key={k} value={k}>
              {t(`kinds.${k}`)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <FilterBar>
        <SearchInput value={url.get("search")} onChange={(v) => url.set({ search: v })} placeholder={t("searchPlaceholder")} />
        <FilterSelect
          ariaLabel={t("columns.status")}
          value={url.get("status")}
          onChange={(v) => url.set({ status: v })}
          allLabel={t("allStatuses")}
          options={(["active", "invited", "deactivated"] as const).map((s) => ({ value: s, label: ts(s) }))}
          className="sm:w-40"
        />
        <FilterSelect
          ariaLabel={t("columns.roles")}
          value={url.get("roleId")}
          onChange={(v) => url.set({ roleId: v })}
          allLabel={t("allRoles")}
          options={(roles.data ?? []).map((r) => ({ value: r.id, label: r.name }))}
        />
      </FilterBar>
      <DataTable
        rows={list.data?.items}
        loading={list.isFetching && !list.data}
        error={list.error}
        onRetry={list.refetch}
        rowKey={(u) => u.id}
        sort={url.get("sort")}
        onSort={(sort) => url.set({ sort })}
        pagination={list.data ? { page: list.data.page, pageSize: list.data.pageSize, total: list.data.total, onPage: (page) => url.set({ page }) } : undefined}
        columns={[
          {
            key: "name",
            header: t("columns.name"),
            sortKey: "name",
            cell: (u) => (
              <div className="min-w-0">
                <p className="font-medium">{u.name}</p>
                <p className="truncate text-xs text-muted-foreground">{u.email}</p>
              </div>
            ),
          },
          {
            key: "roles",
            header: t("columns.roles"),
            hideBelow: "md",
            cell: (u) => (
              <div className="flex flex-wrap gap-1">
                {u.roleNames.map((r) => (
                  <Badge key={r} variant="secondary">
                    {r}
                  </Badge>
                ))}
              </div>
            ),
          },
          { key: "status", header: t("columns.status"), cell: (u) => <StatusBadge kind="user" status={u.status} /> },
          { key: "last", header: t("columns.lastLogin"), sortKey: "lastLoginAt", hideBelow: "lg", cell: (u) => <span className="text-muted-foreground">{u.lastLoginAt ? formatDateTime(u.lastLoginAt) : t("never")}</span> },
          { key: "actions", header: "", className: "w-10 text-right", cell: (u) => can("users.edit") && <UserActions user={u} onEditRoles={() => setEditing(u)} /> },
        ]}
      />
      {editing && <RolesDialog user={editing} roles={roles.data ?? []} onClose={() => setEditing(null)} />}
    </>
  );
}

function UserActions({ user, onEditRoles }: { user: UserRow; onEditRoles: () => void }) {
  const t = useTranslations("admin.users");
  const tc = useTranslations("common");
  const me = useSession();
  const inv = [["users"], ["roles"]];
  const deactivate = useApiMutation(() => api.post(`/users/${user.id}/deactivate`), { invalidate: inv, success: t("deactivated") });
  const reactivate = useApiMutation(() => api.post(`/users/${user.id}/reactivate`), { invalidate: inv, success: t("reactivated") });
  const resend = useApiMutation(() => api.post<{ inviteLink: string }>(`/users/${user.id}/resend-invite`), { success: (r) => `${t("resent")} ${r.inviteLink}` });
  const [confirmOpen, setConfirmOpen] = useState(false);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={tc("actions")}>
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={onEditRoles}>{t("editRoles")}</DropdownMenuItem>
          {user.status === "invited" && <DropdownMenuItem onSelect={() => resend.mutate(undefined)}>{t("resend")}</DropdownMenuItem>}
          {user.status === "deactivated" ? (
            <DropdownMenuItem onSelect={() => reactivate.mutate(undefined)}>{t("reactivate")}</DropdownMenuItem>
          ) : (
            user.id !== me?.id && (
              <DropdownMenuItem variant="destructive" onSelect={() => setConfirmOpen(true)}>
                {t("deactivate")}
              </DropdownMenuItem>
            )
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t("deactivateTitle", { name: user.name })}
        description={t("deactivateBody")}
        confirmLabel={t("deactivate")}
        destructive
        onConfirm={() => deactivate.mutateAsync(undefined)}
      />
    </>
  );
}

function RolesDialog({ user, roles, onClose }: { user: UserRow; roles: Role[]; onClose: () => void }) {
  const t = useTranslations("admin.users");
  const tc = useTranslations("common");
  const [ids, setIds] = useState(user.roleIds);
  const save = useApiMutation(() => api.put(`/users/${user.id}/roles`, { roleIds: ids }), { invalidate: [["users"], ["roles"], ["auth"]], success: t("rolesSaved"), onSuccess: onClose });
  const available = roles.filter((r) => (user.kind === "parent" ? r.scope === "own_children" : r.scope !== "own_children"));
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("editRoles")}</DialogTitle>
          <DialogDescription>{user.name}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {available.map((r) => (
            <label key={r.id} className="flex items-start gap-3 rounded-lg border p-3 text-sm has-[[data-state=checked]]:border-primary/50 has-[[data-state=checked]]:bg-primary/5">
              <Checkbox checked={ids.includes(r.id)} onCheckedChange={(c) => setIds((s) => (c ? [...s, r.id] : s.filter((x) => x !== r.id)))} />
              <span>
                <span className="font-medium">{r.name}</span>
                <span className="block text-xs text-muted-foreground">{r.description}</span>
              </span>
            </label>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {tc("cancel")}
          </Button>
          <Button onClick={() => save.mutate(undefined)} disabled={!ids.length || save.isPending}>
            {save.isPending && <Spinner />} {tc("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function InviteDialog({ roles }: { roles: Role[] }) {
  const t = useTranslations("admin.users");
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  const empty = { kind: "staff" as "staff" | "parent", name: "", email: "", phone: "", designation: "", roleIds: [] as string[] };
  const [form, setForm] = useState(empty);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [link, setLink] = useState<string | null>(null);
  const invite = useApiMutation(() => api.post<{ inviteLink: string }>("/users/invite", form), {
    invalidate: [["users"], ["roles"]],
    success: t("inviteForm.done", { email: form.email }),
    toastError: false,
    onSuccess: (r) => setLink(r.inviteLink),
  });
  const available = roles.filter((r) => (form.kind === "parent" ? r.scope === "own_children" : r.scope !== "own_children"));
  const field = (key: "name" | "email" | "phone" | "designation", label: string, type = "text", placeholder?: string) => (
    <Field data-invalid={!!errors[key]}>
      <FieldLabel htmlFor={`inv-${key}`}>{label}</FieldLabel>
      <Input id={`inv-${key}`} type={type} placeholder={placeholder} value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} aria-invalid={!!errors[key]} />
      <FieldError>{errors[key]}</FieldError>
    </Field>
  );
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          setForm(empty);
          setErrors({});
          setLink(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <UserPlus /> {t("invite")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("inviteForm.title")}</DialogTitle>
          <DialogDescription>{t("inviteForm.description")}</DialogDescription>
        </DialogHeader>
        {link ? (
          <div className="space-y-4">
            <div className="rounded-lg border bg-muted/40 p-3 text-sm">
              <p className="mb-1 text-muted-foreground">{t("inviteForm.link")}</p>
              <Link href={link} className="font-mono text-xs break-all text-primary hover:underline">
                {link}
              </Link>
            </div>
            <DialogFooter>
              <Button onClick={() => setOpen(false)}>{tc("close")}</Button>
            </DialogFooter>
          </div>
        ) : (
          <>
            <FieldGroup>
              <Field>
                <FieldLabel>{t("inviteForm.kind")}</FieldLabel>
                <Tabs value={form.kind} onValueChange={(v) => setForm({ ...form, kind: v as "staff" | "parent", roleIds: [] })}>
                  <TabsList>
                    <TabsTrigger value="staff">{t("kinds.staff")}</TabsTrigger>
                    <TabsTrigger value="parent">{t("kinds.parent")}</TabsTrigger>
                  </TabsList>
                </Tabs>
              </Field>
              {field("name", t("inviteForm.name"))}
              <div className="grid gap-4 sm:grid-cols-2">
                {field("email", t("inviteForm.email"), "email")}
                {field("phone", t("inviteForm.phone"), "tel", "077 123 4567")}
              </div>
              {form.kind === "staff" && field("designation", t("inviteForm.designation"), "text", t("inviteForm.designationPlaceholder"))}
              <Field data-invalid={!!errors.roleIds}>
                <FieldLabel>{t("inviteForm.roles")}</FieldLabel>
                <div className="grid gap-2 sm:grid-cols-2">
                  {available.map((r) => (
                    <label key={r.id} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={form.roleIds.includes(r.id)}
                        onCheckedChange={(c) => setForm({ ...form, roleIds: c ? [...form.roleIds, r.id] : form.roleIds.filter((x) => x !== r.id) })}
                      />
                      {r.name}
                    </label>
                  ))}
                </div>
                <FieldError>{errors.roleIds}</FieldError>
              </Field>
            </FieldGroup>
            <DialogFooter>
              <Button onClick={() => invite.mutateAsync(undefined).catch((e) => setErrors(e instanceof ApiError && e.fields ? e.fields : { email: e.message }))} disabled={invite.isPending}>
                {invite.isPending && <Spinner />} {t("inviteForm.submit")}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
