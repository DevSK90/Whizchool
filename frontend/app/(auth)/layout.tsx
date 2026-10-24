import { Suspense } from "react";
import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { Skeleton } from "@/components/ui/skeleton";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-svh flex-col bg-[radial-gradient(70%_50%_at_50%_0%,color-mix(in_oklch,var(--primary)_10%,transparent),transparent)]">
      <header className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-4">
        <Link href="/" aria-label="Whizchool home">
          <Logo />
        </Link>
        <ThemeToggle />
      </header>
      <main className="flex flex-1 items-center justify-center px-4 py-8 sm:pb-[calc(3.5rem+2rem)]">
        <div className="w-full max-w-md has-[[data-wide]]:max-w-5xl">
          <Suspense fallback={<Skeleton className="h-96 w-full rounded-xl" />}>{children}</Suspense>
        </div>
      </main>
    </div>
  );
}
