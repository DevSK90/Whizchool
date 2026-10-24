import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { serverT as t } from "@/i18n/server";

export function MarketingFooter() {
  const cols = [
    {
      title: t("landing.footer.school"),
      links: [
        { href: "#features", label: t("landing.nav.features") },
        { href: "#how", label: t("landing.nav.how") },
        { href: "#security", label: t("landing.nav.security") },
        { href: "#contact", label: t("landing.nav.contact") },
      ],
    },
    {
      title: t("landing.footer.parents"),
      links: [
        { href: "/apply", label: t("landing.nav.apply") },
        { href: "/apply/status", label: t("landing.nav.status") },
        { href: "/login", label: t("landing.footer.portal") },
      ],
    },
  ];
  return (
    <footer className="relative border-t border-white/[0.07]">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr]">
        <div className="space-y-4">
          <div className="text-white">
            <Logo />
          </div>
          <p className="max-w-sm text-sm text-white/50">{t("landing.footer.tagline")}</p>
        </div>
        {cols.map((c) => (
          <div key={c.title}>
            <p className="text-sm font-medium text-white">{c.title}</p>
            <ul className="mt-4 space-y-2.5">
              {c.links.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="text-sm text-white/55 transition-colors hover:text-white">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-white/[0.07]">
        <div className="mx-auto flex max-w-6xl flex-col gap-1 px-4 py-6 text-xs text-white/40 sm:flex-row sm:justify-between sm:px-6">
          <span>{t("landing.footer.rights")}</span>
          <span>{t("landing.footer.privacy")}</span>
        </div>
      </div>
    </footer>
  );
}
