"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { CheckCircle2, Circle } from "lucide-react";
import Link from "next/link";
import type { StudentDetail } from "@whizchool/shared/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useCan } from "@/lib/auth";
import { toISODate } from "@/lib/format";

/** How long a new student's page keeps reminding staff of what's left to do. */
const NEW_STUDENT_DAYS = 30;

/** What's left after enrolling. Goes away once everything is done, or the student has settled in. */
export function NextSteps({ student: s, onPayment }: { student: StudentDetail; onPayment: () => void }) {
  const t = useTranslations("students.nextSteps");
  const can = useCan();
  const [cutoff] = useState(() => toISODate(new Date(Date.now() - NEW_STUDENT_DAYS * 86_400_000)));
  if (s.status !== "active" || s.joinedDate < cutoff) return null;

  const edit = `/app/students/${s.id}/edit`;
  const canEdit = can("students.edit");
  const steps = [
    ...(can("fees.view") ? [{ key: "payment", done: s.balance <= 0, action: can("payments.create") ? { onClick: onPayment } : undefined }] : []),
    ...(s.subjectChoices ? [{ key: "subjects", done: s.subjectChoices === "done", action: canEdit ? { href: edit } : undefined }] : []),
    { key: "photo", done: !!s.photoUrl, action: undefined },
    { key: "medical", done: !!(s.medical?.bloodGroup || s.medical?.allergies), action: canEdit ? { href: edit } : undefined },
  ] as { key: "payment" | "subjects" | "photo" | "medical"; done: boolean; action?: { href?: string; onClick?: () => void } }[];
  const left = steps.filter((x) => !x.done).length;
  if (!left) return null;

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("description", { count: left })}</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2 text-sm">
          {steps.map((step) => (
            <li key={step.key} className="flex min-h-8 flex-wrap items-center gap-x-3 gap-y-1">
              {step.done ? <CheckCircle2 className="size-4 shrink-0 text-success" /> : <Circle className="size-4 shrink-0 text-muted-foreground" />}
              <span className={step.done ? "text-muted-foreground line-through" : ""}>{t(step.key)}</span>
              {!step.done && step.action?.href && (
                <Button variant="link" size="sm" className="h-auto p-0" asChild>
                  <Link href={step.action.href}>{t("open")}</Link>
                </Button>
              )}
              {!step.done && step.action?.onClick && (
                <Button variant="link" size="sm" className="h-auto p-0" onClick={step.action.onClick}>
                  {t("openFees")}
                </Button>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
