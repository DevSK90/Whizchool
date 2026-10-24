"use client";

import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { ExternalLink, FileText, FileUp, ImageIcon, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { FilterSelect } from "@/components/shared/filters";
import { EmptyState } from "@/components/shared/states";
import { api, errorMessage } from "@/lib/api/client";
import { useApiMutation } from "@/lib/api/hooks";
import type { DocumentKind, StudentDocument } from "@whizchool/shared/types";
import { formatDate } from "@/lib/format";
import { checkFile, uploadFile } from "@/lib/uploads";

const KINDS: DocumentKind[] = ["birth_certificate", "report", "medical", "photo", "other"];

export function DocumentsPanel({ studentId, documents, editable }: { studentId: string; documents: StudentDocument[]; editable: boolean }) {
  const t = useTranslations("students.documents");
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<DocumentKind>("birth_certificate");
  const [busy, setBusy] = useState(false);
  const remove = useApiMutation((docId: string) => api.delete(`/students/${studentId}/documents/${docId}`), {
    invalidate: [["student", studentId]],
    success: t("removed"),
  });

  async function onFile(file: File | undefined) {
    if (!file) return;
    const problem = checkFile(file, "student-document");
    if (problem) return toast.error(t(problem));
    setBusy(true);
    try {
      const ref = await uploadFile(file, "student-document");
      await api.post(`/students/${studentId}/documents`, { fileId: ref.id, kind });
      await qc.invalidateQueries({ queryKey: ["student", studentId] });
      toast.success(t("uploaded"));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {editable && (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <FilterSelect
              ariaLabel={t("kind")}
              value={kind}
              onChange={(v) => setKind(v as DocumentKind)}
              options={KINDS.map((k) => ({ value: k, label: t(`kinds.${k}`) }))}
              className="sm:w-48"
            />
            <Button onClick={() => input.current?.click()} disabled={busy}>
              {busy ? <Spinner /> : <FileUp />} {t("upload")}
            </Button>
            <span className="text-xs text-muted-foreground sm:ml-auto">{t("formats")}</span>
            <input ref={input} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
          </div>
        )}
        {documents.length === 0 ? (
          <EmptyState icon={FileText} title={t("empty")} description={t("emptyHint")} />
        ) : (
          <ul className="divide-y rounded-lg border">
            {documents.map((d) => {
              const isImage = d.file.mimeType.startsWith("image/");
              return (
                <li key={d.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                  {isImage && d.file.url ? (
                    // eslint-disable-next-line @next/next/no-img-element -- signed URLs / data URLs, not optimizable
                    <img src={d.file.url} alt="" className="size-10 rounded-md border object-cover" />
                  ) : (
                    <span className="flex size-10 items-center justify-center rounded-md bg-muted text-muted-foreground">
                      {isImage ? <ImageIcon className="size-4" /> : <FileText className="size-4" />}
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {t(`kinds.${d.kind}`)} <span className="font-normal text-muted-foreground">· {d.file.name}</span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {Math.max(1, Math.round(d.file.size / 1024))} KB · {t("by", { date: formatDate(d.uploadedAt), name: d.uploadedBy })}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => (d.file.url ? window.open(d.file.url, "_blank", "noopener,noreferrer") : toast.info(t("noPreview")))}
                  >
                    <ExternalLink /> {t("view")}
                  </Button>
                  {editable && (
                    <ConfirmDialog
                      trigger={
                        <Button variant="ghost" size="icon-sm" aria-label={t("remove")}>
                          <Trash2 />
                        </Button>
                      }
                      title={t("removeTitle")}
                      description={d.file.name}
                      confirmLabel={t("remove")}
                      destructive
                      onConfirm={() => remove.mutateAsync(d.id)}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
