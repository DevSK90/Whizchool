"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Mail, MessageSquare, Pin, Plus, Send, Trash2, Pencil } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { DataTable } from "@/components/shared/data-table";
import { FilterBar, FilterSelect } from "@/components/shared/filters";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState, ErrorState, CardsSkeleton } from "@/components/shared/states";
import { StatusBadge } from "@/components/shared/status-badge";
import { api, ApiError } from "@/lib/api/client";
import { useApiMutation, useAudience, useClasses, useGrades, useMessages, useNotices, useSchool } from "@/lib/api/hooks";
import type { AudienceType, MessageChannel, Notice } from "@whizchool/shared/types";
import { useCan } from "@/lib/auth";
import { formatDate, formatDateTime } from "@/lib/format";
import { useUrlState } from "@/hooks/use-url-state";

export default function MessagingPage() {
  const t = useTranslations("admin.messaging");
  const can = useCan();
  const url = useUrlState<"tab">({ tab: can("messaging.create") ? "compose" : "history" });
  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <Tabs value={url.get("tab")} onValueChange={(v) => url.set({ tab: v })}>
        <TabsList className="mb-4">
          {can("messaging.create") && <TabsTrigger value="compose">{t("tabs.compose")}</TabsTrigger>}
          <TabsTrigger value="history">{t("tabs.history")}</TabsTrigger>
          <TabsTrigger value="notices">{t("tabs.notices")}</TabsTrigger>
        </TabsList>
        {can("messaging.create") && (
          <TabsContent value="compose">
            <Compose onSent={() => url.set({ tab: "history" })} />
          </TabsContent>
        )}
        <TabsContent value="history">{url.get("tab") === "history" && <History />}</TabsContent>
        <TabsContent value="notices">{url.get("tab") === "notices" && <Notices />}</TabsContent>
      </Tabs>
    </>
  );
}

const AUDIENCES: AudienceType[] = ["all_parents", "grade", "class", "all_staff", "defaulters"];

function Compose({ onSent }: { onSent: () => void }) {
  const t = useTranslations("admin.messaging.compose");
  const tc = useTranslations("common");
  const grades = useGrades();
  const classes = useClasses();
  const { data: school } = useSchool();
  const [channel, setChannel] = useState<MessageChannel>("sms");
  const [audience, setAudience] = useState<AudienceType>("all_parents");
  const [ids, setIds] = useState<string[]>([]);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const count = useAudience(audience, audience === "grade" || audience === "class" ? ids : []);
  const parts = Math.max(1, Math.ceil(body.length / 160));
  const send = useApiMutation(() => api.post("/messages", { channel, audience: { type: audience, ids }, subject, body }), {
    invalidate: [["messages"]],
    success: t("sent", { count: count.data?.count ?? 0 }),
    toastError: false,
    onSuccess: () => {
      setBody("");
      setSubject("");
      onSent();
    },
  });
  const needIds = audience === "grade" || audience === "class";
  const options = audience === "grade" ? (grades.data ?? []).map((g) => ({ id: g.id, label: g.name })) : (classes.data ?? []).map((c) => ({ id: c.id, label: c.name }));
  const templates = (["holiday", "meeting", "fees"] as const).map((k) => ({ key: k, label: t(`template.${k}`), text: t.raw(`template.${k}Text`) as string }));

  const validate = () => {
    const e: Record<string, string> = {};
    if (!body.trim()) e.body = tc("required");
    if (channel === "email" && !subject.trim()) e.subject = tc("required");
    if (needIds && !ids.length) e.audience = tc("required");
    setErrors(e);
    return !Object.keys(e).length;
  };

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardContent>
          <FieldGroup>
            <Field>
              <FieldLabel>{t("channel")}</FieldLabel>
              <ToggleGroup type="single" variant="outline" value={channel} onValueChange={(v) => v && setChannel(v as MessageChannel)} className="w-fit">
                <ToggleGroupItem value="sms" className="px-4">
                  <MessageSquare /> {t("sms")}
                </ToggleGroupItem>
                <ToggleGroupItem value="email" className="px-4">
                  <Mail /> {t("email")}
                </ToggleGroupItem>
              </ToggleGroup>
            </Field>
            <Field data-invalid={!!errors.audience}>
              <FieldLabel>{t("audience")}</FieldLabel>
              <FilterSelect
                ariaLabel={t("audience")}
                value={audience}
                onChange={(v) => {
                  setAudience(v as AudienceType);
                  setIds([]);
                }}
                options={AUDIENCES.map((a) => ({ value: a, label: t(`audiences.${a}`) }))}
                className="sm:w-64"
              />
              {needIds && (
                <div className="mt-2 flex max-h-40 flex-wrap gap-1.5 overflow-y-auto rounded-lg border p-2">
                  {options.map((o) => {
                    const on = ids.includes(o.id);
                    return (
                      <button
                        type="button"
                        key={o.id}
                        aria-pressed={on}
                        onClick={() => setIds((s) => (on ? s.filter((x) => x !== o.id) : [...s, o.id]))}
                        className={on ? "rounded-md border border-primary bg-primary px-2 py-1 text-xs text-primary-foreground" : "rounded-md border px-2 py-1 text-xs hover:bg-muted"}
                      >
                        {o.label}
                      </button>
                    );
                  })}
                </div>
              )}
              <FieldDescription className="tabular">{count.data ? t("recipients", { count: count.data.count }) : " "}</FieldDescription>
              <FieldError>{errors.audience}</FieldError>
            </Field>
            {channel === "email" && (
              <Field data-invalid={!!errors.subject}>
                <FieldLabel htmlFor="subject">{t("subject")}</FieldLabel>
                <Input id="subject" value={subject} onChange={(e) => setSubject(e.target.value)} aria-invalid={!!errors.subject} />
                <FieldError>{errors.subject}</FieldError>
              </Field>
            )}
            <Field data-invalid={!!errors.body}>
              <FieldLabel htmlFor="body">{t("body")}</FieldLabel>
              <Textarea id="body" rows={channel === "sms" ? 4 : 8} value={body} maxLength={channel === "sms" ? 480 : undefined} onChange={(e) => setBody(e.target.value)} aria-invalid={!!errors.body} />
              {channel === "sms" && (
                <FieldDescription className="tabular">
                  {t("smsCount", { chars: body.length, parts })} · {t("senderId", { id: school?.smsSenderId ?? "" })}
                </FieldDescription>
              )}
              <FieldError>{errors.body}</FieldError>
            </Field>
            <div className="flex justify-end">
              <ConfirmDialog
                trigger={
                  <Button disabled={send.isPending} onClick={(e) => !validate() && e.preventDefault()}>
                    <Send /> {t("send")}
                  </Button>
                }
                title={t("sendTitle", { channel: channel === "sms" ? "SMS" : "email" })}
                description={t("sendBody", { count: count.data?.count ?? 0 })}
                confirmLabel={t("send")}
                onConfirm={() => send.mutateAsync(undefined).catch((e) => setErrors(e instanceof ApiError && e.fields ? e.fields : { body: e.message }))}
              />
            </div>
          </FieldGroup>
        </CardContent>
      </Card>
      <Card className="h-fit">
        <CardHeader>
          <CardTitle>{t("templates")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {templates.map((tpl) => (
            <button key={tpl.key} type="button" className="w-full rounded-lg border p-3 text-left text-sm hover:bg-muted" onClick={() => setBody(tpl.text)}>
              <p className="font-medium">{tpl.label}</p>
              <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{tpl.text}</p>
            </button>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function History() {
  const t = useTranslations("admin.messaging.history");
  const tc = useTranslations("common");
  const url = useUrlState<"channel" | "kind">();
  const list = useMessages({ channel: url.get("channel"), kind: url.get("kind"), page: url.page, pageSize: 20 });
  return (
    <>
      <FilterBar>
        <FilterSelect
          ariaLabel={t("columns.channel")}
          value={url.get("channel")}
          onChange={(v) => url.set({ channel: v })}
          allLabel={tc("all")}
          options={[
            { value: "sms", label: "SMS" },
            { value: "email", label: "Email" },
          ]}
          className="sm:w-32"
        />
        <FilterSelect
          ariaLabel={t("kind.all")}
          value={url.get("kind")}
          onChange={(v) => url.set({ kind: v })}
          allLabel={t("kind.all")}
          options={(["manual", "absence_alert", "fee_reminder", "system"] as const).map((k) => ({ value: k, label: t(`kind.${k}`) }))}
        />
      </FilterBar>
      <DataTable
        rows={list.data?.items}
        loading={list.isFetching && !list.data}
        error={list.error}
        onRetry={list.refetch}
        rowKey={(m) => m.id}
        pagination={list.data ? { page: list.data.page, pageSize: list.data.pageSize, total: list.data.total, onPage: (page) => url.set({ page }) } : undefined}
        columns={[
          { key: "sent", header: t("columns.sent"), hideBelow: "md", cell: (m) => <span className="whitespace-nowrap text-muted-foreground">{formatDateTime(m.createdAt)}</span> },
          {
            key: "channel",
            header: t("columns.channel"),
            cell: (m) => (
              <Badge variant="outline" className="gap-1">
                {m.channel === "sms" ? <MessageSquare /> : <Mail />} {m.channel.toUpperCase()}
              </Badge>
            ),
          },
          {
            key: "message",
            header: t("columns.message"),
            cell: (m) => (
              <div className="max-w-md min-w-0">
                <p className="truncate font-medium">{m.audience.label}</p>
                <p className="truncate text-xs text-muted-foreground">{m.subject ?? m.body}</p>
              </div>
            ),
          },
          { key: "delivery", header: t("columns.delivery"), hideBelow: "sm", className: "tabular", cell: (m) => `${m.delivered}/${m.recipients}` },
          { key: "status", header: t("columns.status"), cell: (m) => <StatusBadge kind="message" status={m.status} /> },
          { key: "by", header: t("columns.by"), hideBelow: "lg", cell: (m) => <span className="text-muted-foreground">{m.createdBy}</span> },
        ]}
      />
    </>
  );
}

function Notices() {
  const t = useTranslations("admin.messaging.notices");
  const can = useCan();
  const { data, error, refetch, isPending } = useNotices();
  const remove = useApiMutation((id: string) => api.delete(`/notices/${id}`), { invalidate: [["notices"]], success: t("deleted") });
  if (isPending) return <CardsSkeleton count={3} />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  return (
    <div className="space-y-4">
      {can("messaging.create") && (
        <div className="flex justify-end">
          <NoticeDialog />
        </div>
      )}
      {data.length === 0 && <EmptyState title={t("empty")} />}
      {data.map((n) => (
        <Card key={n.id}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {n.pinned && <Pin className="size-4 text-primary" aria-label={t("pinned")} />}
              {n.title}
            </CardTitle>
            <CardDescription>
              {t("by", { author: n.author, date: formatDate(n.publishedAt) })} · {t(`audiences.${n.audience}`)}
            </CardDescription>
            {can("messaging.create") && (
              <CardAction className="flex gap-1">
                <NoticeDialog notice={n} />
                <ConfirmDialog
                  trigger={
                    <Button variant="ghost" size="icon-sm" aria-label={t("delete")}>
                      <Trash2 />
                    </Button>
                  }
                  title={t("deleteTitle")}
                  confirmLabel={t("delete")}
                  destructive
                  onConfirm={() => remove.mutateAsync(n.id)}
                />
              </CardAction>
            )}
          </CardHeader>
          <CardContent>
            <p className="text-sm whitespace-pre-line">{n.body}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function NoticeDialog({ notice }: { notice?: Notice }) {
  const t = useTranslations("admin.messaging.notices");
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  const empty = { title: "", body: "", audience: "everyone" as Notice["audience"], pinned: false };
  const [form, setForm] = useState(empty);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useApiMutation(() => (notice ? api.put(`/notices/${notice.id}`, form) : api.post("/notices", form)), {
    invalidate: [["notices"]],
    success: notice ? t("saved") : t("published"),
    toastError: false,
    onSuccess: () => setOpen(false),
  });
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          setForm(notice ? { title: notice.title, body: notice.body, audience: notice.audience, pinned: notice.pinned } : empty);
          setErrors({});
        }
      }}
    >
      <DialogTrigger asChild>
        {notice ? (
          <Button variant="ghost" size="icon-sm" aria-label={t("edit")}>
            <Pencil />
          </Button>
        ) : (
          <Button>
            <Plus /> {t("new")}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{notice ? t("edit") : t("new")}</DialogTitle>
          <DialogDescription />
        </DialogHeader>
        <FieldGroup>
          <Field data-invalid={!!errors.title}>
            <FieldLabel htmlFor="ntitle">{t("title")}</FieldLabel>
            <Input id="ntitle" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} aria-invalid={!!errors.title} />
            <FieldError>{errors.title}</FieldError>
          </Field>
          <Field data-invalid={!!errors.body}>
            <FieldLabel htmlFor="nbody">{t("body")}</FieldLabel>
            <Textarea id="nbody" rows={5} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} aria-invalid={!!errors.body} />
            <FieldError>{errors.body}</FieldError>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel>{t("audience")}</FieldLabel>
              <FilterSelect
                ariaLabel={t("audience")}
                value={form.audience}
                onChange={(v) => setForm({ ...form, audience: v as Notice["audience"] })}
                options={(["everyone", "parents", "staff"] as const).map((a) => ({ value: a, label: t(`audiences.${a}`) }))}
                className="sm:w-full"
              />
            </Field>
            <Field orientation="horizontal" className="self-end">
              <Checkbox id="pinned" checked={form.pinned} onCheckedChange={(c) => setForm({ ...form, pinned: c === true })} />
              <FieldLabel htmlFor="pinned" className="font-normal">
                {t("pinned")}
              </FieldLabel>
            </Field>
          </div>
        </FieldGroup>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            {tc("cancel")}
          </Button>
          <Button
            disabled={save.isPending}
            onClick={() => {
              const e: Record<string, string> = {};
              if (!form.title.trim()) e.title = tc("required");
              if (!form.body.trim()) e.body = tc("required");
              setErrors(e);
              if (!Object.keys(e).length) save.mutateAsync(undefined).catch((er) => setErrors(er instanceof ApiError && er.fields ? er.fields : {}));
            }}
          >
            {save.isPending && <Spinner />} {notice ? tc("save") : t("publish")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
