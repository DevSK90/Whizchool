"use client";

import { useTranslations } from "next-intl";
import { picksFor } from "@whizchool/shared/curriculum";
import type { ClassDetail } from "@whizchool/shared/types";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldError, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/** The subjects a student picks in this class: one from a group, or several for A/L Commerce and Arts. */
export function SubjectChoices({ cls, value, onChange, error }: { cls?: ClassDetail; value: string[]; onChange: (ids: string[]) => void; error?: string }) {
  const t = useTranslations("students.form");
  const tg = useTranslations("academics.optionGroups");
  const tc = useTranslations("common");
  const groups = [...new Set(cls?.subjects.flatMap((s) => (s.optionGroup ? [s.optionGroup] : [])) ?? [])].map((group) => ({
    group,
    options: cls!.subjects.filter((s) => s.optionGroup === group),
    picks: picksFor(group, cls!.optionsRequired ?? 0),
  }));
  if (!groups.length) return null;
  return (
    <FieldSet>
      <FieldLegend variant="label">{t("electives")}</FieldLegend>
      <div className="grid gap-4 sm:grid-cols-3">
        {groups.map(({ group, options, picks }) => {
          const inGroup = (id: string) => options.some((o) => o.subjectId === id);
          const others = value.filter((id) => !inGroup(id));
          const chosen = value.filter(inGroup);
          return picks === 1 ? (
            <Field key={group}>
              <FieldLabel>{tg(group as "options")}</FieldLabel>
              <Select value={chosen[0] ?? ""} onValueChange={(v) => onChange([...others, v])}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={tc("selectPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {options.map((o) => (
                    <SelectItem key={o.subjectId} value={o.subjectId}>
                      {o.subjectName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          ) : (
            <Field key={group} className="sm:col-span-3">
              <FieldLabel>
                {tg(group as "options")}: {t("pickSome", { count: picks })}
              </FieldLabel>
              <div className="grid gap-2 sm:grid-cols-3">
                {options.map((o) => {
                  const on = chosen.includes(o.subjectId);
                  return (
                    <label key={o.subjectId} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={on}
                        disabled={!on && chosen.length >= picks}
                        onCheckedChange={(c) => onChange(c ? [...value, o.subjectId] : value.filter((id) => id !== o.subjectId))}
                      />
                      {o.subjectName}
                    </label>
                  );
                })}
              </div>
            </Field>
          );
        })}
      </div>
      <FieldError>{error}</FieldError>
    </FieldSet>
  );
}
