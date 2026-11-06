"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { FileSpreadsheet, Printer } from "lucide-react";
import { scheduleCell, scheduleColumns, type ScheduleColumn } from "@whizchool/shared/schedule";
import type { MarkValue, ReportCardClassView } from "@whizchool/shared/types";
import { Button } from "@/components/ui/button";
import { usePublicSchool } from "@/lib/api/hooks";
import { cn } from "@/lib/utils";

const showMark = (m: MarkValue | undefined) => (m === null || m === undefined ? "—" : String(m));

/** Every student's marks in one table, as schools keep for each class: on screen, printed, or in a spreadsheet. */
export function MarkSchedule({ data }: { data: ReportCardClassView }) {
  const t = useTranslations("academics.reportCards.schedule");
  const tg = useTranslations("academics.optionGroups");
  const school = usePublicSchool();
  const columns = scheduleColumns(data.subjects, data.optionsRequired ?? 0);
  const groupLabel = (c: Extract<ScheduleColumn, { kind: "group" }>) => (c.picks > 1 ? t("nth", { group: tg(c.group as "options"), n: c.index + 1 }) : tg(c.group as "options"));
  const label = (c: ScheduleColumn) => (c.kind === "subject" ? c.name : groupLabel(c));
  const nameOf = new Map(data.subjects.map((s) => [s.subjectId, s.name]));

  function exportCsv() {
    const cell = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
    const head = [t("rank"), t("admissionNo"), t("student"), ...columns.flatMap((c) => (c.kind === "subject" ? [c.name] : [`${label(c)} – ${t("subject")}`, `${label(c)} – ${t("mark")}`])), t("total"), t("average")];
    const lines = data.rows.map((r) => [
      r.rank,
      r.admissionNo,
      r.fullName,
      ...columns.flatMap((c) => {
        const entry = scheduleCell(c, r.marks);
        const mark = entry?.mark === null || entry?.mark === undefined ? "" : entry.mark;
        return c.kind === "subject" ? [mark] : [entry ? (nameOf.get(entry.subjectId) ?? "") : "", mark];
      }),
      r.total,
      r.average.toFixed(2),
    ]);
    // A byte-order mark so Excel reads Sinhala and Tamil names correctly.
    const csv = "﻿" + [head, ...lines].map((line) => line.map(cell).join(",")).join("\r\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    link.download = `${data.className} ${data.exam.name} marks.csv`.replace(/[\\/:*?"<>|]/g, "-");
    link.click();
    URL.revokeObjectURL(link.href);
  }

  return (
    <div className="space-y-3">
      {/* Only while this table is on screen does printing turn the page sideways. */}
      <style>{"@media print { @page { size: A4 landscape; margin: 10mm; } }"}</style>
      <div className="no-print flex flex-wrap justify-end gap-2">
        <Button variant="outline" onClick={exportCsv}>
          <FileSpreadsheet /> {t("export")}
        </Button>
        <Button variant="outline" onClick={() => window.print()}>
          <Printer /> {t("print")}
        </Button>
      </div>
      <div className="hidden print:block">
        <p className="text-base font-semibold">{school.data?.name}</p>
        <p className="text-sm">{t("printTitle", { className: data.className, exam: data.exam.name })}</p>
      </div>
      <div className="overflow-x-auto rounded-xl border bg-card print:overflow-visible print:rounded-none print:border-0">
        <table className="w-full border-collapse text-sm print:text-[8pt]">
          <thead>
            <tr className="border-b bg-muted/40 text-xs text-muted-foreground print:bg-transparent">
              <th scope="col" className="sticky left-0 z-10 bg-muted px-3 py-2 text-left font-medium print:static print:bg-transparent">
                {t("student")}
              </th>
              {columns.map((c) => (
                <th key={c.key} scope="col" className="min-w-20 px-2 py-2 text-right align-bottom font-medium leading-tight">
                  {label(c)}
                </th>
              ))}
              <th scope="col" className="px-2 py-2 text-right font-medium">{t("total")}</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">{t("average")}</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.studentId} className="border-b last:border-b-0 hover:bg-muted/30">
                <th scope="row" className="sticky left-0 z-10 bg-card px-3 py-1.5 text-left font-normal whitespace-nowrap print:static">
                  <span className="mr-2 inline-block w-6 text-right text-muted-foreground">{r.rank}</span>
                  <Link href={`/app/report-cards/${r.examId}/student/${r.studentId}`} className="font-medium hover:underline">
                    {r.fullName}
                  </Link>
                </th>
                {columns.map((c) => {
                  const entry = scheduleCell(c, r.marks);
                  return (
                    <td key={c.key} className="px-2 py-1.5 text-right align-top">
                      {entry ? (
                        <>
                          <span className={cn("font-medium", entry.grade === "W" && "text-destructive")}>{showMark(entry.mark)}</span>
                          {c.kind === "group" && <span className="block max-w-28 truncate text-[11px] text-muted-foreground print:max-w-none print:whitespace-normal">{nameOf.get(entry.subjectId)}</span>}
                        </>
                      ) : (
                        <span className="text-muted-foreground" title={c.kind === "group" ? t("notChosen") : undefined}>
                          {c.kind === "group" ? t("notChosenShort") : ""}
                        </span>
                      )}
                    </td>
                  );
                })}
                <td className="px-2 py-1.5 text-right align-top font-medium">{r.total}</td>
                <td className="px-3 py-1.5 text-right align-top font-medium">{r.average.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t bg-muted/40 text-xs text-muted-foreground print:bg-transparent">
              <th scope="row" className="sticky left-0 z-10 bg-muted px-3 py-2 text-left font-medium print:static print:bg-transparent">
                {t("classAverage")}
              </th>
              {columns.map((c) => (
                <td key={c.key} className="px-2 py-2 text-right">
                  {c.kind === "subject" && c.average ? c.average.toFixed(1) : ""}
                </td>
              ))}
              <td />
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="no-print text-xs text-muted-foreground">{t("legend")}</p>
    </div>
  );
}
