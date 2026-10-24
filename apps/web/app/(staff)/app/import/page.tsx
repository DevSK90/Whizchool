"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, CheckCircle2, Download, FileUp, Sparkles, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/shared/page-header";
import { api, errorMessage, newIdempotencyKey } from "@/lib/api/client";
import { useApiMutation } from "@/lib/api/hooks";
import type { ImportPreview, ImportRow } from "@whizchool/shared/types";
import { downloadText, parseCsv, toCsv } from "@/lib/csv";
import { cn } from "@/lib/utils";

const COLUMNS: (keyof ImportRow)[] = ["admissionNo", "firstName", "lastName", "gender", "dob", "className", "guardianName", "guardianPhone", "guardianEmail", "address"];

const SAMPLE: string[][] = [
  ["", "Senul", "Abeysekara", "M", "2016-03-14", "4-A", "Mr. Upul Abeysekara", "077 456 1290", "upul.abey@gmail.com", "12 Lake Drive, Kandy"],
  ["", "Hiruni", "Mendis", "F", "2013-11-02", "7-B", "Mrs. Gayani Mendis", "071 220 9981", "gayani.m@gmail.com", "5 Temple Road, Ampitiya"],
  ["", "Aadhil", "Farook", "M", "2010-06-21", "10-B", "Mr. Fazil Farook", "076 334 8812", "", "88 Station Road, Katugastota"],
  ["", "Tharushi", "Peiris", "F", "2009-01-30", "11-C", "Mrs. Nirosha Peiris", "075 112 4433", "nirosha.p@gmail.com", "3 Hill Street, Kandy"],
  ["", "Kavin", "", "M", "14/05/2015", "5-A", "Mr. Roshan Silva", "0771234", "roshan@", "Gampola"],
];

export default function ImportPage() {
  const t = useTranslations("admin.import");
  const tc = useTranslations("common");
  const [rows, setRows] = useState<ImportRow[] | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [onlyErrors, setOnlyErrors] = useState(false);
  const [invite, setInvite] = useState(true);
  const [fileError, setFileError] = useState<string | null>(null);
  const idemKey = useRef<string | null>(null);

  const check = useApiMutation((data: ImportRow[]) => api.post<ImportPreview>("/imports/students/preview", { rows: data }), {
    onSuccess: (p) => {
      idemKey.current = null;
      setPreview(p);
    },
  });
  const commit = useApiMutation(
    () =>
      api.post<{ created: number; skipped: number; invited: number }>(
        "/imports/students/commit",
        { rows: preview!.rows.filter((r) => !r.errors.length).map((r) => r.data), inviteParents: invite },
        { idempotencyKey: (idemKey.current ??= newIdempotencyKey()) },
      ),
    {
      invalidate: [["students"], ["classes"], ["dashboard"]],
      success: (r) => t("done", r),
      onSuccess: () => {
        setRows(null);
        setPreview(null);
      },
    },
  );

  function load(table: string[][]) {
    const [header, ...body] = table;
    const looksLikeHeader = header?.some((h) => h.trim().toLowerCase() === "firstname");
    const data = (looksLikeHeader ? body : table).map((r) => Object.fromEntries(COLUMNS.map((c, i) => [c, (r[i] ?? "").trim()])) as unknown as ImportRow);
    if (!data.length) return setFileError(t("empty"));
    setFileError(null);
    setRows(data);
    setPreview(null);
    check.mutate(data);
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".csv")) return setFileError(t("notCsv"));
    try {
      load(parseCsv(await file.text()));
    } catch (e) {
      setFileError(errorMessage(e));
    }
  }

  const shown = preview?.rows.filter((r) => !onlyErrors || r.errors.length || r.warnings.length) ?? [];

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("step1")}</CardTitle>
            <CardDescription>{t("step1Body")}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" onClick={() => downloadText("whizchool-students-template.csv", toCsv([COLUMNS, SAMPLE[0]]))}>
              <Download /> {t("template")}
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t("step2")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button asChild>
              <label className="cursor-pointer">
                <FileUp /> {t("choose")}
                <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} />
              </label>
            </Button>
            <Button variant="ghost" onClick={() => load(SAMPLE)}>
              <Sparkles /> {t("sample")}
            </Button>
            {fileError && <p className="w-full text-sm text-destructive">{fileError}</p>}
          </CardContent>
        </Card>
      </div>

      {check.isPending && rows && (
        <p className="mt-6 flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner /> {t("parsing", { count: rows.length })}
        </p>
      )}

      {preview && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>{t("step3")}</CardTitle>
            <CardDescription className="tabular">{t("summary", { valid: preview.valid, invalid: preview.invalid })}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={onlyErrors} onCheckedChange={setOnlyErrors} /> {t("onlyErrors")}
            </label>
            <div className="max-h-[480px] overflow-auto rounded-lg border">
              <Table>
                <TableHeader className="sticky top-0 bg-card">
                  <TableRow>
                    <TableHead className="w-14">{t("row")}</TableHead>
                    <TableHead>{tc("student")}</TableHead>
                    <TableHead>{tc("class")}</TableHead>
                    <TableHead className="hidden md:table-cell">{tc("guardian")}</TableHead>
                    <TableHead>{t("issues")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shown.map((r) => (
                    <TableRow key={r.index} className={cn(r.errors.length > 0 && "bg-destructive/5")}>
                      <TableCell className="tabular text-muted-foreground">{r.index}</TableCell>
                      <TableCell>
                        {r.data.firstName} {r.data.lastName}
                        <span className="block text-xs text-muted-foreground">{r.data.dob}</span>
                      </TableCell>
                      <TableCell>{r.data.className}</TableCell>
                      <TableCell className="hidden md:table-cell">
                        {r.data.guardianName}
                        <span className="block text-xs text-muted-foreground">{r.data.guardianPhone}</span>
                      </TableCell>
                      <TableCell>
                        {r.errors.length === 0 && r.warnings.length === 0 && (
                          <span className="flex items-center gap-1 text-sm text-success">
                            <CheckCircle2 className="size-4" /> {t("ok")}
                          </span>
                        )}
                        <ul className="space-y-0.5 text-xs">
                          {r.errors.map((e) => (
                            <li key={e} className="flex items-center gap-1 text-destructive">
                              <XCircle className="size-3.5 shrink-0" /> {e}
                            </li>
                          ))}
                          {r.warnings.map((w) => (
                            <li key={w} className="flex items-center gap-1 text-warning-foreground dark:text-warning">
                              <AlertTriangle className="size-3.5 shrink-0" /> {w}
                            </li>
                          ))}
                        </ul>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={invite} onCheckedChange={(c) => setInvite(c === true)} /> {t("invite")}
              </label>
              <Button onClick={() => commit.mutate(undefined)} disabled={!preview.valid || commit.isPending}>
                {commit.isPending && <Spinner />} {t("commit", { count: preview.valid })}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </>
  );
}
