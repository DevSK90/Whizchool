"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { ArrowRight, Menu } from "lucide-react";
import { useTranslations } from "next-intl";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "#features", key: "features" },
  { href: "#how", key: "how" },
  { href: "#security", key: "security" },
  { href: "#contact", key: "contact" },
] as const;

function subscribeScroll(onChange: () => void) {
  window.addEventListener("scroll", onChange, { passive: true });
  return () => window.removeEventListener("scroll", onChange);
}

export function MarketingNav() {
  const t = useTranslations("landing.nav");
  const ta = useTranslations("common");
  const scrolled = useSyncExternalStore(subscribeScroll, () => window.scrollY > 12, () => false);
  const [open, setOpen] = useState(false);

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-50 transition-[background-color,border-color,backdrop-filter] duration-300",
        scrolled ? "border-b border-white/[0.07] bg-[#03040f]/75 backdrop-blur-xl" : "border-b border-transparent",
      )}
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4 sm:px-6">
        <Link href="/" aria-label={ta("a11y.home", { app: ta("appName") })} className="text-white">
          <Logo />
        </Link>
        <nav aria-label={ta("a11y.mainNav")} className="hidden flex-1 items-center justify-center gap-1 md:flex">
          {LINKS.map((l) => (
            <a key={l.href} href={l.href} className="rounded-full px-3.5 py-2 text-sm text-white/65 transition-colors hover:bg-white/5 hover:text-white">
              {t(l.key)}
            </a>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2 md:ml-0">
          <Button variant="ghost" asChild className="hidden h-9 rounded-full px-4 text-white/80 hover:bg-white/8 hover:text-white sm:inline-flex">
            <Link href="/login">{t("signIn")}</Link>
          </Button>
          <Button asChild className="h-9 rounded-full bg-white px-4 text-[#0a0b1e] hover:bg-white/90">
            <Link href="/apply">
              {t("apply")} <ArrowRight className="size-3.5" />
            </Link>
          </Button>
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="text-white hover:bg-white/10 md:hidden" aria-label={t("menu")}>
                <Menu />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="dark w-72 border-white/10 bg-[#070920] text-white">
              <SheetHeader>
                <SheetTitle className="text-white">
                  <Logo />
                </SheetTitle>
              </SheetHeader>
              <nav aria-label={ta("a11y.mobileNav")} className="flex flex-col gap-1 px-4">
                {LINKS.map((l) => (
                  <a key={l.href} href={l.href} onClick={() => setOpen(false)} className="rounded-lg px-3 py-2.5 text-white/80 hover:bg-white/5">
                    {t(l.key)}
                  </a>
                ))}
                <Link href="/apply/status" className="rounded-lg px-3 py-2.5 text-white/80 hover:bg-white/5">
                  {t("status")}
                </Link>
                <Link href="/login" className="rounded-lg px-3 py-2.5 text-white/80 hover:bg-white/5">
                  {t("signIn")}
                </Link>
              </nav>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
