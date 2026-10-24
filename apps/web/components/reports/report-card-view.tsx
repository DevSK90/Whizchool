"use client";

import { useTranslations } from "next-intl";
import { Printer } from "lucide-react";
import { LogoMark } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { useGradeBands } from "@/lib/api/hooks";
import type { ReportCard } from "@whizchool/shared/types";
import { DEFAULT_GRADE_BANDS } from "@whizchool/shared/grading";
import { cn } from "@/lib/utils";

/** Printable term report card (A4 portrait). Used by staff and in the parent portal. */
export function ReportCardView({ card, showPrintButton = true }: { card: ReportCard; showPrintButton?: boolean }) {
  const t = useTranslations("academics.reportCards.card");
  const year = card.exam.startDate.slice(0, 4);
  const draft = card.status !== "released";
  const bands = useGradeBands().data ?? DEFAULT_GRADE_BANDS;
  const gradeKey = [...bands].sort((a, b) => b.min - a.min).map((b) => `${b.grade} ${b.min}–${b.max}`).join(" · ");
  return (
    <div className="space-y-4">
      {showPrintButton && (
        <div className="no-print flex justify-end">
          <Button variant="outline" onClick={() => window.print()}>
            <Printer /> {t("print")}
          </Button>
        </div>
      )}
      <article className="relative mx-auto max-w-[210mm] overflow-hidden rounded-xl border bg-white p-6 text-zinc-900 shadow-sm print:max-w-none print:rounded-none print:border-0 print:p-0 print:shadow-none sm:p-10">
        {draft && (
          <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="-rotate-30 text-6xl font-bold tracking-widest text-zinc-900/[0.06] uppercase">{t("draftWatermark")}</span>
          </div>
        )}
        <header className="flex items-start gap-4 border-b border-zinc-200 pb-5">
          <LogoMark className="size-12 shrink-0" />
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-semibold">{card.school.name}</h1>
            <p className="text-sm text-zinc-500 italic">{card.school.motto}</p>
            <p className="text-xs text-zinc-500">
              {card.school.address} · {card.school.phone}
            </p>
          </div>
          <div className="text-right">
            <p className="text-sm font-semibold tracking-wide uppercase">{t("title")}</p>
            <p className="text-sm text-zinc-500">{t("term", { term: card.exam.termName, year })}</p>
          </div>
        </header>

        <section className="grid grid-cols-2 gap-4 py-5 text-sm sm:grid-cols-4">
          <Info label={t("student")} value={card.student.fullName} className="col-span-2" />
          <Info label={t("admissionNo")} value={card.student.admissionNo} />
          <Info label={t("class")} value={card.student.className} />
        </section>

        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-y border-zinc-300 bg-zinc-50 text-left text-xs text-zinc-600 uppercase">
              <th className="px-3 py-2 font-medium">{t("subject")}</th>
              <th className="px-3 py-2 text-right font-medium">{t("mark")}</th>
              <th className="px-3 py-2 text-center font-medium">{t("grade")}</th>
              <th className="px-3 py-2 text-right font-medium">{t("classAvg")}</th>
            </tr>
          </thead>
          <tbody>
            {card.subjects.map((s) => (
              <tr key={s.subjectId} className="border-b border-zinc-200">
                <td className="px-3 py-2">{s.name}</td>
                <td className="px-3 py-2 text-right tabular">{s.mark ?? "—"}</td>
                <td className={cn("px-3 py-2 text-center font-semibold", s.grade === "W" && "text-red-700")}>{s.grade}</td>
                <td className="px-3 py-2 text-right text-zinc-500 tabular">{s.classAverage.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <section className="grid grid-cols-2 gap-4 py-5 text-sm sm:grid-cols-4">
          <Info label={t("total")} value={String(card.total)} />
          <Info label={t("average")} value={card.average.toFixed(2)} />
          <Info label={t("position")} value={t("positionValue", { rank: card.rank, size: card.classSize })} />
          <Info label={t("attendance")} value={t("attendanceValue", card.attendance)} />
        </section>

        <section className="space-y-4 border-t border-zinc-200 pt-5 text-sm">
          <div>
            <p className="text-xs font-medium text-zinc-500 uppercase">{t("classTeacherRemark")}</p>
            <p className="mt-1 min-h-6">{card.classTeacherRemark ?? "—"}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-zinc-500 uppercase">{t("principalRemark")}</p>
            <p className="mt-1 min-h-6">{card.principalRemark ?? "—"}</p>
          </div>
        </section>

        <footer className="mt-10 grid grid-cols-2 gap-10 text-sm">
          <Signature label={t("classTeacher")} name={card.classTeacherName} />
          <Signature label={t("principal")} name={card.school.principalName} />
        </footer>
        <p className="mt-8 text-center text-[11px] text-zinc-500">{t("gradeKey", { bands: gradeKey })}</p>
      </article>
    </div>
  );
}

function Info({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={className}>
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="font-medium">{value}</p>
    </div>
  );
}

function Signature({ label, name }: { label: string; name?: string }) {
  return (
    <div>
      <div className="h-10 border-b border-dotted border-zinc-400" />
      <p className="mt-1 font-medium">{name}</p>
      <p className="text-xs text-zinc-500">{label}</p>
    </div>
  );
}
