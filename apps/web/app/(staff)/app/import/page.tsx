"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, CheckCircle2, ChevronDown, Download, FileUp, Info, Sparkles, XCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FilterSelect } from "@/components/shared/filters";
import { PageHeader } from "@/components/shared/page-header";
import { api, newIdempotencyKey } from "@/lib/api/client";
import { useApiMutation } from "@/lib/api/hooks";
import {
  IMPORT_FIELDS,
  IMPORT_LIMITS,
  matchColumns,
  REQUIRED_IMPORT_FIELDS,
  rowsFromTable,
  type ImportFieldKey,
} from "@whizchool/shared/student-import";
import type { ImportPreview, ImportRow } from "@whizchool/shared/types";
import { decodeCsv, detectDelimiter, downloadText, parseCsv, toCsv } from "@/lib/csv";
import { cn } from "@/lib/utils";

interface LoadedFile {
  name: string;
  headers: string[];
  body: string[][];
  legacyEncoding: boolean;
}

/** A spreadsheet the way schools often have it: own column names, own order, Excel's quirks. */
const SAMPLE: LoadedFile = {
  name: "sample.csv",
  legacyEncoding: false,
  headers: ["Surname", "First Name", "Sex", "D.O.B", "Grade/Class", "Parent Name", "Mobile No", "E-mail", "Address", "House"],
  body: [
    ["Abeysekara", "Senul", "Male", "14/03/2016", "4A", "Mr. Upul Abeysekara", "774561290", "upul.abey@gmail.com", "12 Lake Drive, Kandy", "Red"],
    ["Mendis", "Hiruni", "F", "02/11/2013", "7 B", "Mrs. Gayani Mendis", "071 220 9981", "gayani.m@gmail.com", "5 Temple Road, Ampitiya", "Blue"],
    ["Farook", "Aadhil", "M", "2010-06-21", "Grade 10-B", "Mr. Fazil Farook", "+94 76 334 8812", "", "88 Station Road, Katugastota", "Green"],
    ["Peiris", "Tharushi", "Girl", "30 Jan 2009", "11-C", "Mrs. Nirosha Peiris", "0751124433", "nirosha.p@gmail.com", "3 Hill Street, Kandy", "Yellow"],
    ["", "Kavin", "M", "14/05/15", "5-Z", "Mr. Roshan Silva", "0771234", "roshan@", "Gampola", "Red"],
  ],
};

/** Column index → field it imports as ("" = ignored), starting from what the headers say. */
function initialMapping(headers: string[]) {
  const matched = matchColumns(headers).fields;
  const byColumn: Record<number, ImportFieldKey | ""> = {};
  headers.forEach((_, i) => (byColumn[i] = ""));
  for (const [field, col] of Object.entries(matched)) byColumn[col!] = field as ImportFieldKey;
  return byColumn;
}

export default function ImportPage() {
  const t = useTranslations("admin.import");
  const tc = useTranslations("common");
  const [file, setFile] = useState<LoadedFile | null>(null);
  const [mapping, setMapping] = useState<Record<number, ImportFieldKey | "">>({});
  const [rows, setRows] = useState<ImportRow[] | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [onlyErrors, setOnlyErrors] = useState(false);
  const [invite, setInvite] = useState(true);
  const [fileError, setFileError] = useState<string | null>(null);
  const [idemKey, setIdemKey] = useState(newIdempotencyKey);

  const fieldLabel = (k: ImportFieldKey) => t(`fields.${k}.label`);

  const check = useApiMutation((data: ImportRow[]) => api.post<ImportPreview>("/imports/students/preview", { rows: data }), {
    onSuccess: (p) => {
      // A new review means a new import: a fresh key, so a later commit isn't mistaken for a retry.
      setIdemKey(newIdempotencyKey());
      setPreview(p);
    },
  });
  const commit = useApiMutation(
    () =>
      api.post<{ created: number; skipped: number; invited: number }>(
        "/imports/students/commit",
        { rows: rows!, inviteParents: invite },
        { idempotencyKey: idemKey },
      ),
    {
      invalidate: [["students"], ["classes"], ["dashboard"]],
      success: (r) => t("done", r),
      onSuccess: () => {
        setFile(null);
        setRows(null);
        setPreview(null);
      },
    },
  );

  // What the current column choices add up to.
  const chosen = useMemo(() => {
    const fields: Partial<Record<ImportFieldKey, number>> = {};
    const counts = new Map<ImportFieldKey, number>();
    for (const [col, field] of Object.entries(mapping)) {
      if (!field) continue;
      counts.set(field, (counts.get(field) ?? 0) + 1);
      fields[field] ??= Number(col);
    }
    return {
      fields,
      missing: REQUIRED_IMPORT_FIELDS.filter((k) => fields[k] === undefined),
      duplicates: [...counts].filter(([, n]) => n > 1).map(([k]) => k),
    };
  }, [mapping]);

  function load(loaded: LoadedFile) {
    if (!loaded.headers.some((h) => h.trim())) return setFileError(t("noHeader"));
    if (!loaded.body.length) return setFileError(t("empty"));
    if (loaded.body.length > IMPORT_LIMITS.rows) return setFileError(t("tooManyRows", { count: loaded.body.length, max: IMPORT_LIMITS.rows }));
    setFileError(null);
    setFile(loaded);
    setMapping(initialMapping(loaded.headers));
    setRows(null);
    setPreview(null);
  }

  async function onFile(f: File | undefined) {
    if (!f) return;
    if (!/\.(csv|txt|tsv)$/i.test(f.name)) return setFileError(t("notCsv"));
    if (f.size > IMPORT_LIMITS.bytes) return setFileError(t("tooBig"));
    const { text, encoding } = decodeCsv(new Uint8Array(await f.arrayBuffer()));
    const [headers = [], ...body] = parseCsv(text, detectDelimiter(text));
    load({ name: f.name, headers: headers.map((h) => h.trim()), body, legacyEncoding: encoding === "windows-1252" });
  }

  function runCheck() {
    if (!file) return;
    const data = rowsFromTable(file.body, chosen.fields);
    setRows(data);
    setPreview(null);
    check.mutate(data);
  }

  function downloadProblems() {
    if (!preview || !rows) return;
    const fields = IMPORT_FIELDS.filter((f) => chosen.fields[f.key] !== undefined);
    const bad = preview.rows.filter((r) => r.errors.length);
    downloadText(
      "whizchool-import-problems.csv",
      toCsv([
        [t("row"), ...fields.map((f) => f.label), t("problems")],
        ...bad.map((r) => [r.index, ...fields.map((f) => rows[r.index - 1]?.[f.key] ?? ""), r.errors.join("; ")]),
      ]),
    );
  }

  const shown = preview?.rows.filter((r) => !onlyErrors || r.errors.length || r.warnings.length) ?? [];
  const matchedCount = file ? Object.values(initialMapping(file.headers)).filter(Boolean).length : 0;
  const canCheck = !!file && !chosen.missing.length && !chosen.duplicates.length;

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("step1")}</CardTitle>
            <CardDescription>{t("step1Body")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button
              variant="outline"
              onClick={() =>
                downloadText(
                  "whizchool-students-template.csv",
                  toCsv([IMPORT_FIELDS.map((f) => f.label), IMPORT_FIELDS.map((f) => f.example)]),
                )
              }
            >
              <Download /> {t("template")}
            </Button>
            <p className="flex gap-2 text-xs text-muted-foreground">
              <Info className="mt-0.5 size-3.5 shrink-0" /> {t("excelTip")}
            </p>
            <Collapsible>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="group -ml-2">
                  {t("guideToggle")} <ChevronDown className="transition-transform group-data-[state=open]:rotate-180" />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="mt-2 overflow-x-auto rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("guideColumn")}</TableHead>
                        <TableHead>{t("guideNeed")}</TableHead>
                        <TableHead>{t("guideAccepts")}</TableHead>
                        <TableHead className="hidden sm:table-cell">{t("guideExample")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {IMPORT_FIELDS.map((f) => (
                        <TableRow key={f.key}>
                          <TableCell className="font-medium whitespace-nowrap">{f.label}</TableCell>
                          <TableCell>
                            <Badge variant={f.required ? "default" : "secondary"}>{f.required ? t("required") : t("optional")}</Badge>
                          </TableCell>
                          <TableCell className="min-w-56 text-xs whitespace-normal text-muted-foreground">{t(`fields.${f.key}.accepts`)}</TableCell>
                          <TableCell className="hidden font-mono text-xs sm:table-cell">{f.example}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CollapsibleContent>
            </Collapsible>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t("step2")}</CardTitle>
            {file && <CardDescription>{t("fileInfo", { name: file.name, rows: file.body.length, columns: file.headers.length })}</CardDescription>}
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button asChild>
              <label className="cursor-pointer">
                <FileUp /> {t("choose")}
                <input
                  type="file"
                  accept=".csv,.txt,.tsv,text/csv"
                  className="sr-only"
                  onChange={(e) => {
                    onFile(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
              </label>
            </Button>
            <Button variant="ghost" onClick={() => load(SAMPLE)}>
              <Sparkles /> {t("sample")}
            </Button>
            {fileError && (
              <p role="alert" className="w-full text-sm text-destructive">
                {fileError}
              </p>
            )}
            {file?.legacyEncoding && (
              <Alert className="w-full">
                <AlertTriangle />
                <AlertDescription>{t("encodingNote")}</AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      </div>

      {file && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>{t("step3")}</CardTitle>
            <CardDescription>{t("mapBody", { matched: matchedCount, total: file.headers.length })}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("fileColumn")}</TableHead>
                    <TableHead className="hidden sm:table-cell">{t("sampleValue")}</TableHead>
                    <TableHead>{t("importsAs")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {file.headers.map((h, col) => {
                    const field = mapping[col] ?? "";
                    const clash = !!field && chosen.duplicates.includes(field);
                    return (
                      <TableRow key={col} className={cn(!field && "text-muted-foreground")}>
                        <TableCell className="font-medium">{h || `#${col + 1}`}</TableCell>
                        <TableCell className="hidden max-w-48 truncate text-xs sm:table-cell">{file.body[0]?.[col] ?? ""}</TableCell>
                        <TableCell>
                          <FilterSelect
                            ariaLabel={`${t("importsAs")}: ${h || col + 1}`}
                            value={field}
                            onChange={(v) => {
                              setMapping({ ...mapping, [col]: v as ImportFieldKey | "" });
                              setPreview(null);
                            }}
                            allLabel={t("ignore")}
                            options={IMPORT_FIELDS.map((f) => ({ value: f.key, label: `${fieldLabel(f.key)}${f.required ? " *" : ""}` }))}
                            className={cn("sm:w-56", clash && "[&_button]:border-destructive")}
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            {chosen.missing.length > 0 && (
              <p role="alert" className="flex items-center gap-2 text-sm text-destructive">
                <XCircle className="size-4 shrink-0" /> {t("missing", { fields: chosen.missing.map(fieldLabel).join(", ") })}
              </p>
            )}
            {chosen.duplicates.map((k) => (
              <p key={k} role="alert" className="flex items-center gap-2 text-sm text-destructive">
                <XCircle className="size-4 shrink-0" /> {t("duplicate", { field: fieldLabel(k) })}
              </p>
            ))}
            <Button onClick={runCheck} disabled={!canCheck || check.isPending}>
              {check.isPending && <Spinner />} {t("check", { count: file.body.length })}
            </Button>
          </CardContent>
        </Card>
      )}

      {preview && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>{t("step4")}</CardTitle>
            <CardDescription className="tabular">{t("summary", { valid: preview.valid, invalid: preview.invalid })}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={onlyErrors} onCheckedChange={setOnlyErrors} /> {t("onlyErrors")}
              </label>
              {preview.invalid > 0 && (
                <Button variant="outline" size="sm" onClick={downloadProblems}>
                  <Download /> {t("downloadErrors")}
                </Button>
              )}
            </div>
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
