import { Suspense } from "react";
import { StaffShell, StaffShellSkeleton } from "@/components/layout/staff-shell";

export default function StaffLayout({ children }: LayoutProps<"/app">) {
  return (
    <Suspense fallback={<StaffShellSkeleton />}>
      <StaffShell>{children}</StaffShell>
    </Suspense>
  );
}
