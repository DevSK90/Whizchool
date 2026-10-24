import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  BellRing,
  Briefcase,
  CreditCard,
  GraduationCap,
  Languages,
  Layers,
  School,
  Smartphone,
  UserRound,
  UsersRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { FeatureBento } from "@/components/marketing/feature-bento";
import { HeroMockup } from "@/components/marketing/hero-mockup";
import {
  Eyebrow,
  SectionHeading,
} from "@/components/marketing/section-heading";
import { SecurityGrid } from "@/components/marketing/security-grid";
import { StepsPath } from "@/components/marketing/steps-path";
import { SchoolContact } from "@/components/public/school-contact";
import { serverT as t } from "@/i18n/server";

export const metadata: Metadata = {
  title: t("landing.metaTitle"),
  description: t("landing.metaDescription"),
  robots: { index: true, follow: true },
  openGraph: {
    title: `${t("landing.hero.titleA")} ${t("landing.hero.titleB")}`,
    description: t("landing.metaDescription"),
    type: "website",
  },
};

// Fixed positions so the prerendered HTML is deterministic.
const STARS = [
  [8, 22],
  [14, 64],
  [22, 38],
  [31, 12],
  [38, 58],
  [47, 30],
  [56, 70],
  [63, 18],
  [71, 46],
  [79, 26],
  [86, 62],
  [92, 34],
  [18, 82],
  [67, 84],
  [43, 8],
  [96, 12],
];

const PILLS = [
  { key: "grades", icon: GraduationCap },
  { key: "streams", icon: Layers },
  { key: "payhere", icon: CreditCard },
  { key: "sms", icon: BellRing },
  { key: "languages", icon: Languages },
  { key: "mobile", icon: Smartphone },
] as const;

const ROLES = [
  { key: "parents", icon: UsersRound },
  { key: "teachers", icon: UserRound },
  { key: "office", icon: Briefcase },
  { key: "principal", icon: School },
] as const;

export default function LandingPage() {
  return (
    <main className="overflow-x-clip">
      {/* ---------------- Hero ---------------- */}
      <section className="relative isolate pt-32 pb-24 sm:pt-40">
        <div
          aria-hidden
          className="absolute inset-0 -z-10 overflow-hidden [mask-image:linear-gradient(to_bottom,black_75%,transparent)]"
        >
          {/* light beams from the top corners */}
          <div className="mk-beam absolute -top-40 -left-[12%] h-[760px] w-[360px] rotate-[28deg] rounded-full bg-gradient-to-b from-[#7cc0ff]/55 via-[#4f5bff]/20 to-transparent blur-3xl" />
          <div className="mk-beam absolute -top-40 -right-[12%] h-[760px] w-[360px] -rotate-[28deg] rounded-full bg-gradient-to-b from-[#7cc0ff]/55 via-[#4f5bff]/20 to-transparent blur-3xl [animation-delay:-3s]" />
          {/* central glow + fading grid */}
          <div className="absolute top-[18%] left-1/2 h-[520px] w-[900px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(79,91,255,0.35),transparent)]" />
          <div className="mk-grid-bg absolute inset-0 [mask-image:radial-gradient(ellipse_at_50%_20%,black,transparent_65%)]" />
          {STARS.map(([x, y], i) => (
            <span
              key={i}
              className="mk-twinkle absolute size-[3px] rounded-full bg-white"
              style={{
                left: `${x}%`,
                top: `${y}%`,
                animationDelay: `${-(i % 5) * 0.8}s`,
              }}
            />
          ))}
        </div>

        <div className="mx-auto max-w-6xl px-4 text-center sm:px-6">
          <Eyebrow>{t("landing.hero.eyebrow")}</Eyebrow>
          <h1 className="mk-display mx-auto mt-7 max-w-5xl text-[2.6rem] leading-[1.06] font-semibold text-balance sm:text-6xl lg:text-[4.25rem]">
            <span className="text-white">{t("landing.hero.titleA")}</span>
            <br />
            <span className="mk-text-gradient">{t("landing.hero.titleB")}</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-base text-pretty text-white/65 sm:text-lg">
            {t("landing.hero.body")}
          </p>
          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button
              asChild
              size="lg"
              className="h-12 rounded-full bg-[#4f5bff] px-7 text-[15px] text-white shadow-[0_10px_40px_-8px_rgba(79,91,255,0.9)] hover:bg-[#5d68ff]"
            >
              <Link href="/apply">
                {t("landing.hero.apply")} <ArrowRight />
              </Link>
            </Button>
            <Button
              asChild
              size="lg"
              variant="outline"
              className="h-12 rounded-full border-white/15 bg-white/[0.04] px-7 text-[15px] text-white hover:bg-white/10 hover:text-white"
            >
              <Link href="/login">{t("landing.hero.signIn")}</Link>
            </Button>
          </div>
          <Link
            href="/apply/status"
            className="mt-5 inline-block text-sm text-white/55 underline-offset-4 hover:text-white hover:underline"
          >
            {t("landing.hero.status")}
          </Link>
        </div>

        <HeroMockup />
      </section>

      {/* ---------------- Capability pills ---------------- */}
      <section
        aria-label="Highlights"
        className="mx-auto max-w-6xl px-4 sm:px-6"
      >
        <ul className="flex flex-wrap items-center justify-center gap-3">
          {PILLS.map(({ key, icon: Icon }) => (
            <li
              key={key}
              className="mk-pill flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-medium text-white/85"
            >
              <Icon className="size-4 text-[#aab1ff]" />
              {t(`landing.pills.${key}`)}
            </li>
          ))}
        </ul>
      </section>

      {/* ---------------- Why (horizon arc) ---------------- */}
      <section className="relative isolate mt-20 overflow-hidden pt-24 pb-24">
        <div
          aria-hidden
          className="absolute top-0 left-1/2 -z-10 h-[720px] w-[170%] -translate-x-1/2 rounded-[100%] border-t border-[#8b93ff]/50 bg-[radial-gradient(ellipse_at_top,rgba(79,91,255,0.28),transparent_55%)] shadow-[0_-30px_90px_-20px_rgba(79,91,255,0.7)] [mask-image:linear-gradient(to_bottom,black_30%,transparent_70%)] sm:w-[130%]"
        />
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="mk-reveal flex flex-col items-center text-center">
            <Eyebrow lines={false}>{t("landing.why.eyebrow")}</Eyebrow>
            <p className="mk-display mt-6 max-w-3xl text-2xl leading-snug text-balance text-white sm:text-3xl">
              {t("landing.why.statementA")}{" "}
              <span className="rounded-md bg-[#4f5bff]/20 px-1.5 text-[#c7cdff]">
                {t("landing.why.statementHighlight")}
              </span>
              {t("landing.why.statementB")}
            </p>
          </div>
          <div className="mt-14 grid gap-4 md:grid-cols-3">
            {(["one", "two", "three"] as const).map((k, i) => (
              <article
                key={k}
                className="mk-reveal rounded-2xl border border-white/[0.08] bg-[#060818]/80 p-6 backdrop-blur sm:p-7"
              >
                <span className="mk-display mk-text-gradient text-6xl leading-none font-light">
                  {i + 1}
                </span>
                <h3 className="mt-6 text-lg font-semibold text-white">
                  {t(`landing.why.${k}.title`)}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-white/55">
                  {t(`landing.why.${k}.body`)}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ---------------- Features (bento) ---------------- */}
      <section
        id="features"
        className="mx-auto max-w-6xl scroll-mt-24 px-4 py-24 sm:px-6"
      >
        <SectionHeading
          eyebrow={t("landing.features.eyebrow")}
          title={t("landing.features.title")}
          highlight={t("landing.features.titleB")}
          body={t("landing.features.body")}
        />
        <div className="mt-14">
          <FeatureBento />
        </div>
      </section>

      {/* ---------------- How it works ---------------- */}
      <section
        id="how"
        className="relative mx-auto max-w-6xl scroll-mt-24 px-4 py-24 sm:px-6"
      >
        <p
          aria-hidden
          className="mk-display mk-outline-text pointer-events-none -mb-6 opacity-70 text-6xl leading-none font-bold select-none sm:-mb-10 sm:text-8xl md:text-9xl"
        >
          {t("landing.how.watermark")}
        </p>
        <SectionHeading
          align="left"
          eyebrow={t("landing.how.eyebrow")}
          title={t("landing.how.title")}
        />
        <div className="mt-14">
          <StepsPath />
        </div>
        <div className="mk-reveal mt-10 max-w-sm md:-mt-28 md:mr-0 md:ml-auto">
          <p className="text-sm leading-relaxed text-white/60">
            {t("landing.how.body")}
          </p>
          <Button
            asChild
            variant="outline"
            className="mt-5 rounded-full border-[#8b93ff]/40 bg-transparent text-white hover:bg-white/10 hover:text-white"
          >
            <Link href="/apply">
              {t("landing.how.cta")} <ArrowRight />
            </Link>
          </Button>
        </div>
      </section>

      {/* ---------------- Roles ---------------- */}
      <section className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
        <SectionHeading
          eyebrow={t("landing.roles.eyebrow")}
          title={t("landing.roles.title")}
          body={t("landing.roles.body")}
        />
        <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {ROLES.map(({ key, icon: Icon }) => (
            <article
              key={key}
              className="mk-reveal group relative overflow-hidden rounded-2xl border border-white/[0.08] bg-gradient-to-b from-white/[0.05] to-transparent p-6 transition-colors hover:border-[#8b93ff]/40"
            >
              <div
                aria-hidden
                className="absolute -right-10 -bottom-10 size-32 rounded-full bg-[#4f5bff]/0 blur-2xl transition-colors duration-500 group-hover:bg-[#4f5bff]/30"
              />
              <span className="flex size-11 items-center justify-center rounded-xl bg-gradient-to-br from-[#6c7cff] to-[#4f5bff] text-white shadow-[0_8px_24px_-6px_rgba(79,91,255,0.8)]">
                <Icon className="size-5" />
              </span>
              <h3 className="mt-5 font-semibold text-white">
                {t(`landing.roles.${key}.title`)}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-white/55">
                {t(`landing.roles.${key}.body`)}
              </p>
            </article>
          ))}
        </div>
      </section>

      {/* ---------------- Security ---------------- */}
      <section
        id="security"
        className="scroll-mt-24 border-y border-white/[0.06] bg-[#070920]"
      >
        <div className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
          <SectionHeading
            eyebrow={t("landing.security.eyebrow")}
            title={t("landing.security.title")}
            body={t("landing.security.body")}
          />
          <div className="mt-14">
            <SecurityGrid />
          </div>
        </div>
      </section>

      {/* ---------------- CTA + contact ---------------- */}
      <section
        id="contact"
        className="mx-auto max-w-6xl scroll-mt-24 px-4 py-24 sm:px-6"
      >
        <div className="mk-reveal relative isolate overflow-hidden rounded-[28px] border border-white/10 bg-gradient-to-br from-[#10153f] via-[#0a0d2c] to-[#070920] p-8 sm:p-12">
          <div
            aria-hidden
            className="mk-grid-bg absolute inset-0 -z-10 [mask-image:radial-gradient(ellipse_at_30%_0%,black,transparent_70%)]"
          />
          <div
            aria-hidden
            className="absolute -top-32 -left-20 -z-10 size-[420px] rounded-full bg-[radial-gradient(closest-side,rgba(79,91,255,0.55),transparent)] blur-2xl"
          />
          <div
            aria-hidden
            className="absolute -right-24 -bottom-40 -z-10 size-[420px] rounded-full bg-[radial-gradient(closest-side,rgba(47,140,255,0.35),transparent)] blur-2xl"
          />
          <div className="grid items-center gap-10 lg:grid-cols-[1.2fr_1fr]">
            <div>
              <h2 className="mk-display text-3xl font-semibold text-balance text-white sm:text-5xl">
                {t("landing.cta.title")}
              </h2>
              <p className="mt-4 max-w-md text-white/65">
                {t("landing.cta.body")}
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Button
                  asChild
                  size="lg"
                  className="h-12 rounded-full bg-white px-7 text-[15px] text-[#0a0b1e] hover:bg-white/90"
                >
                  <Link href="/apply">
                    {t("landing.cta.apply")} <ArrowRight />
                  </Link>
                </Button>
                <Button
                  asChild
                  size="lg"
                  variant="outline"
                  className="h-12 rounded-full border-white/20 bg-transparent px-7 text-[15px] text-white hover:bg-white/10 hover:text-white"
                >
                  <Link href="/apply/status">{t("landing.cta.status")}</Link>
                </Button>
              </div>
            </div>
            <div className="rounded-2xl p-6 mk-glass">
              <p className="mb-4 text-xs font-medium tracking-wide text-white/50 uppercase">
                {t("landing.contact.title")}
              </p>
              <Suspense>
                <SchoolContact />
              </Suspense>
              <p className="mt-5 border-t border-white/10 pt-4 text-xs text-white/45">
                {t("landing.contact.hours")}
              </p>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
