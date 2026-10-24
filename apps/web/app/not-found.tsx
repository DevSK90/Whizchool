import Link from "next/link";
import { LogoMark } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { serverT } from "@/i18n/server";

export default function NotFound() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-4 p-6 text-center">
      <LogoMark className="size-10" />
      <h1 className="text-2xl font-semibold tracking-tight">{serverT("common.notFoundTitle")}</h1>
      <p className="max-w-sm text-sm text-muted-foreground">{serverT("common.notFoundBody")}</p>
      <Button asChild>
        <Link href="/">{serverT("common.goHome")}</Link>
      </Button>
    </main>
  );
}
