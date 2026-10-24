"use client";

import type { ReactNode } from "react";
import { AlertCircle, Inbox, Lock, RotateCw, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { ApiError, errorMessage } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <Empty className={cn("border border-dashed py-10", className)}>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        {description && <EmptyDescription>{description}</EmptyDescription>}
      </EmptyHeader>
      {action && <EmptyContent>{action}</EmptyContent>}
    </Empty>
  );
}

export function ErrorState({ error, onRetry, className }: { error: unknown; onRetry?: () => void; className?: string }) {
  const t = useTranslations("common");
  const forbidden = error instanceof ApiError && error.status === 403;
  return (
    <EmptyState
      className={className}
      icon={forbidden ? Lock : AlertCircle}
      title={forbidden ? t("forbiddenTitle") : t("errorTitle")}
      description={forbidden ? t("forbiddenBody") : errorMessage(error) || t("errorBody")}
      action={
        !forbidden && onRetry ? (
          <Button variant="outline" onClick={onRetry}>
            <RotateCw /> {t("retry")}
          </Button>
        ) : undefined
      }
    />
  );
}

export function PageSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true">
      <div className="space-y-2">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-28 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-80 rounded-xl" />
    </div>
  );
}

export function CardsSkeleton({ count = 3, className }: { count?: number; className?: string }) {
  return (
    <div className={cn("grid gap-4", className)}>
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} className="h-32 rounded-xl" />
      ))}
    </div>
  );
}
