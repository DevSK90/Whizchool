"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, ErrorState } from "@/components/shared/states";
import { StatusBadge } from "@/components/shared/status-badge";
import { useStudentResults } from "@/lib/api/hooks";

export function StudentResultsView({ studentId, reportHref }: { studentId: string; reportHref: (examId: string) => string }) {
  const t = useTranslations("students.results");
  const { data, error, refetch, isPending } = useStudentResults(studentId);
  if (isPending) return <Skeleton className="h-72 rounded-xl" />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  const exams = [...data.exams].reverse();
  if (!exams.length) return <EmptyState title={t("empty")} />;
  return (
    <div className="space-y-4">
      {exams.map(({ exam, released, average, rank, classSize, subjects }) => (
        <Card key={exam.id}>
          <CardHeader>
            <CardTitle>{exam.name}</CardTitle>
            <CardDescription>
              {average !== undefined ? (
                <>
                  {t("average")}: <span className="font-medium text-foreground tabular">{average.toFixed(1)}</span>
                  {rank && classSize && (
                    <>
                      {" · "}
                      {t("rank")}: <span className="font-medium text-foreground tabular">{t("rankOf", { rank, size: classSize })}</span>
                    </>
                  )}
                </>
              ) : (
                t("notReleased")
              )}
            </CardDescription>
            <CardAction>
              {released ? (
                <Button variant="outline" size="sm" asChild>
                  <Link href={reportHref(exam.id)}>
                    <FileText /> {t("viewCard")}
                  </Link>
                </Button>
              ) : (
                <StatusBadge kind="exam" status={exam.status} />
              )}
            </CardAction>
          </CardHeader>
          {subjects && (
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("subject")}</TableHead>
                    <TableHead className="text-right">{t("mark")}</TableHead>
                    <TableHead className="w-16 text-right">{t("grade")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {subjects.map((s) => (
                    <TableRow key={s.name}>
                      <TableCell>{s.name}</TableCell>
                      <TableCell className="text-right tabular">{s.mark ?? "—"}</TableCell>
                      <TableCell className="text-right font-medium">{s.grade}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          )}
        </Card>
      ))}
    </div>
  );
}
