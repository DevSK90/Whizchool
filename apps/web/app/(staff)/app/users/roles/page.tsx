"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Lock, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { FilterSelect } from "@/components/shared/filters";
import { PageHeader } from "@/components/shared/page-header";
import { ErrorState, PageSkeleton } from "@/components/shared/states";
import { api, ApiError } from "@/lib/api/client";
import { useApiMutation, useRoles } from "@/lib/api/hooks";
import type { Role } from "@whizchool/shared/types";
import { useCan } from "@/lib/auth";
import { PERMISSION_ACTIONS, PERMISSION_MODULES, type DataScope, type PermissionKey, type PermissionModule } from "@whizchool/shared/permissions";
import { cn } from "@/lib/utils";

const SCOPES: DataScope[] = ["all", "own_class", "own_subjects", "own_children"];
const NEW_ID = "__new";

export default function RolesPage() {
  const t = useTranslations("admin.roles");
  const tn = useTranslations("nav");
  const can = useCan();
  const { data, error, refetch, isPending } = useRoles();
  const [picked, setSelectedId] = useState<string>("");
  const selectedId = picked || data?.[0]?.id || "";
  if (isPending) return <PageSkeleton />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  const role: Role | undefined =
    selectedId === NEW_ID ? { id: NEW_ID, name: "", description: "", system: false, scope: "all", permissions: ["dashboard.view"] } : data.find((r) => r.id === selectedId);

  return (
    <>
      <PageHeader
        back={{ href: "/app/users", label: tn("users") }}
        title={t("title")}
        description={t("description")}
        actions={
          can("roles.edit") && (
            <Button onClick={() => setSelectedId(NEW_ID)}>
              <Plus /> {t("new")}
            </Button>
          )
        }
      />
      <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
        <nav className="space-y-1" aria-label={t("title")}>
          {data.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setSelectedId(r.id)}
              className={cn(
                "flex w-full items-start gap-3 rounded-lg border border-transparent p-3 text-left hover:bg-muted",
                selectedId === r.id && "border-border bg-card shadow-xs",
              )}
            >
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-sm font-medium">
                  {r.name}
                  {r.system && (
                    <Badge variant="outline" className="h-5 text-[10px]">
                      {t("system")}
                    </Badge>
                  )}
                </span>
                <span className="block text-xs text-muted-foreground">{t("users", { count: r.userCount ?? 0 })}</span>
              </span>
            </button>
          ))}
        </nav>
        {role && <RoleEditor key={role.id} role={role} editable={can("roles.edit")} onSaved={(r) => setSelectedId(r.id)} onDeleted={() => setSelectedId(data[0].id)} />}
      </div>
    </>
  );
}

function RoleEditor({ role, editable, onSaved, onDeleted }: { role: Role; editable: boolean; onSaved: (r: Role) => void; onDeleted: () => void }) {
  const t = useTranslations("admin.roles");
  const ts = useTranslations("status.scope");
  const tc = useTranslations("common");
  const isNew = role.id === NEW_ID;
  const locked = role.id === "role_admin" || !editable;
  const [name, setName] = useState(role.name);
  const [description, setDescription] = useState(role.description);
  const [scope, setScope] = useState<DataScope>(role.scope);
  const [perms, setPerms] = useState<PermissionKey[]>(role.permissions);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const dirty = name !== role.name || description !== role.description || scope !== role.scope || perms.slice().sort().join() !== role.permissions.slice().sort().join();

  const save = useApiMutation(() => (isNew ? api.post<Role>("/roles", { name, description, scope, permissions: perms }) : api.put<Role>(`/roles/${role.id}`, { name, description, scope, permissions: perms })), {
    invalidate: [["roles"], ["auth"]],
    success: t("saved"),
    toastError: false,
    onSuccess: onSaved,
  });
  const remove = useApiMutation(() => api.delete(`/roles/${role.id}`), { invalidate: [["roles"]], success: t("deleted"), onSuccess: onDeleted });

  const toggle = (key: PermissionKey, on: boolean) => setPerms((p) => (on ? [...p, key] : p.filter((x) => x !== key)));
  const modules = Object.entries(PERMISSION_MODULES) as [PermissionModule, readonly string[]][];

  return (
    <Card>
      <CardHeader>
        <CardTitle>{isNew ? t("new") : role.name}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {role.id === "role_admin" && (
          <Alert>
            <Lock />
            <AlertDescription>{t("adminLocked")}</AlertDescription>
          </Alert>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field data-invalid={!!errors.name}>
            <FieldLabel htmlFor="rname">{t("name")}</FieldLabel>
            <Input id="rname" value={name} disabled={locked || role.system} onChange={(e) => setName(e.target.value)} aria-invalid={!!errors.name} />
            <FieldError>{errors.name}</FieldError>
          </Field>
          <Field>
            <FieldLabel>{t("scope")}</FieldLabel>
            {locked || role.system ? (
              <p className="py-1.5 text-sm">{ts(scope)}</p>
            ) : (
              <FilterSelect ariaLabel={t("scope")} value={scope} onChange={(v) => setScope(v as DataScope)} options={SCOPES.map((s) => ({ value: s, label: ts(s) }))} className="sm:w-full" />
            )}
          </Field>
        </div>
        <Field>
          <FieldLabel htmlFor="rdesc">{t("roleDescription")}</FieldLabel>
          <Input id="rdesc" value={description} disabled={locked} onChange={(e) => setDescription(e.target.value)} />
        </Field>

        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead>{t("module")}</TableHead>
                {PERMISSION_ACTIONS.map((a) => (
                  <TableHead key={a} className="w-24 text-center">
                    {t(`actions.${a}`)}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {modules.map(([module, actions]) => (
                <TableRow key={module}>
                  <TableCell className="font-medium">{t(`modules.${module}`)}</TableCell>
                  {PERMISSION_ACTIONS.map((a) => {
                    const key = `${module}.${a}` as PermissionKey;
                    return (
                      <TableCell key={a} className="text-center">
                        {actions.includes(a) ? (
                          <Checkbox
                            aria-label={`${t(`modules.${module}`)} – ${t(`actions.${a}`)}`}
                            checked={perms.includes(key)}
                            disabled={locked}
                            onCheckedChange={(c) => toggle(key, c === true)}
                          />
                        ) : (
                          <span className="text-muted-foreground/40">·</span>
                        )}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {!locked && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            {!isNew && !role.system ? (
              <ConfirmDialog
                trigger={
                  <Button variant="ghost" className="text-destructive">
                    <Trash2 /> {t("delete")}
                  </Button>
                }
                title={t("deleteTitle", { name: role.name })}
                confirmLabel={t("delete")}
                destructive
                onConfirm={() => remove.mutateAsync(undefined)}
              />
            ) : (
              <span />
            )}
            <div className="flex items-center gap-3">
              {dirty && <span className="text-sm text-muted-foreground">{t("unsaved")}</span>}
              <Button
                disabled={save.isPending || (!dirty && !isNew)}
                onClick={() => save.mutateAsync(undefined).catch((e) => setErrors(e instanceof ApiError && e.fields ? e.fields : { name: e.message }))}
              >
                {save.isPending && <Spinner />} {isNew ? tc("create") : t("save")}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
