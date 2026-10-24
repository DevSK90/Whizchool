"use client";

import { useTranslations } from "next-intl";
import { Bell, Pin } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/shared/page-header";
import { CardsSkeleton, EmptyState, ErrorState } from "@/components/shared/states";
import { useNotices } from "@/lib/api/hooks";
import { formatDate } from "@/lib/format";

export default function PortalNoticesPage() {
  const t = useTranslations("portal.notices");
  const { data, error, refetch, isPending } = useNotices();
  return (
    <>
      <PageHeader title={t("title")} />
      {isPending ? (
        <CardsSkeleton count={3} />
      ) : error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : data.length === 0 ? (
        <EmptyState icon={Bell} title={t("empty")} />
      ) : (
        <div className="space-y-4">
          {data.map((n) => (
            <Card key={n.id}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  {n.pinned && <Pin className="size-4 text-primary" />}
                  {n.title}
                </CardTitle>
                <CardDescription>{formatDate(n.publishedAt)}</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm whitespace-pre-line">{n.body}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
