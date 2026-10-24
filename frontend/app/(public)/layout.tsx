import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { serverT as t } from "@/i18n/server";

export default function PublicLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-svh flex-col">
      <header className="sticky top-0 z-20 border-b bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-2 px-4">
          <Link href="/" aria-label={t("common.a11y.home", { app: t("common.appName") })}>
            <Logo />
          </Link>
          <div className="flex-1" />
          <nav className="hidden items-center gap-1 sm:flex">
            <Button variant="ghost" asChild>
              <Link href="/apply">{t("landing.nav.apply")}</Link>
            </Button>
            <Button variant="ghost" asChild>
              <Link href="/apply/status">{t("landing.nav.status")}</Link>
            </Button>
          </nav>
          <ThemeToggle />
          <Button asChild>
            <Link href="/login">{t("landing.nav.signIn")}</Link>
          </Button>
        </div>
      </header>
      <div className="flex-1">{children}</div>
      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl flex-col gap-1 px-4 py-6 text-xs text-muted-foreground sm:flex-row sm:justify-between">
          <span>{t("landing.footer.rights")}</span>
          <span>{t("landing.footer.privacy")}</span>
        </div>
      </footer>
    </div>
  );
}
