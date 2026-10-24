import { Suspense } from "react";
import { PortalShell, PortalShellSkeleton } from "@/components/layout/portal-shell";

export default function PortalLayout({ children }: LayoutProps<"/portal">) {
  return (
    <Suspense fallback={<PortalShellSkeleton />}>
      <PortalShell>{children}</PortalShell>
    </Suspense>
  );
}
