import {
  BellRing,
  CalendarCheck,
  CheckCircle2,
  ClipboardList,
  FileText,
  GraduationCap,
  LayoutDashboard,
  Users,
  Wallet,
} from "lucide-react";
import { LogoMark } from "@/components/brand/logo";
import { serverT as t } from "@/i18n/server";
import { cn } from "@/lib/utils";

const BARS = [72, 58, 55, 48, 49, 47, 52, 44, 42, 46];
const MONTHS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O"];
const SIDEBAR = [LayoutDashboard, Users, GraduationCap, CalendarCheck, ClipboardList, FileText, Wallet];

/** Product preview built from real Whizchool screens (static markup, decorative). */
export function HeroMockup() {
  return (
    <div className="relative mx-auto mt-16 w-full max-w-5xl px-2 [perspective:1600px] sm:mt-20" aria-hidden>
      {/* glow under the frame */}
      <div className="absolute inset-x-10 -top-6 h-40 rounded-full bg-[radial-gradient(closest-side,var(--mk-glow),transparent)] opacity-40 blur-2xl" />

      <div className="relative rounded-[22px] border border-white/10 bg-white/[0.04] p-1.5 shadow-[0_40px_120px_-30px_rgba(79,91,255,0.55)] [transform:rotateX(8deg)] sm:p-2">
        <div className="grid grid-cols-[44px_1fr] overflow-hidden rounded-2xl border border-white/[0.06] bg-[#080a1f] sm:grid-cols-[56px_1fr]">
          {/* sidebar */}
          <div className="flex flex-col items-center gap-3 border-r border-white/[0.06] py-4">
            <LogoMark className="size-7" />
            <div className="mt-2 flex flex-col gap-2.5">
              {SIDEBAR.map((Icon, i) => (
                <span key={i} className={cn("flex size-8 items-center justify-center rounded-lg text-white/35", i === 0 && "bg-[#4f5bff]/20 text-[#aab1ff]")}>
                  <Icon className="size-4" />
                </span>
              ))}
            </div>
          </div>

          {/* content */}
          <div className="min-w-0 p-3 sm:p-5">
            <div className="mb-4 flex items-center justify-between">
              <p className="text-sm font-medium text-white">{t("landing.mockup.dashboard")}</p>
              <div className="flex items-center gap-1.5">
                <span className="h-6 w-24 rounded-full bg-white/[0.05] sm:w-40" />
                <span className="size-6 rounded-full bg-gradient-to-br from-[#8b93ff] to-[#4f5bff]" />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 sm:gap-3">
              <Stat label={t("landing.mockup.students")} value="646" delta="+153" />
              <Stat label={t("landing.mockup.attendance")} value="95.7%" delta="26/30" />
              <Stat label={t("landing.mockup.collected")} value="9.26M" delta="LKR" />
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-[1.6fr_1fr]">
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 sm:p-4">
                <p className="text-xs text-white/50">{t("landing.mockup.feeCollection")}</p>
                <div className="mt-3 flex h-28 items-end gap-1.5 sm:h-36 sm:gap-2.5">
                  {BARS.map((h, i) => (
                    <div key={i} className="flex h-full flex-1 flex-col items-center justify-end gap-1.5">
                      <div
                        className={cn("w-full max-w-6 rounded-t-[4px]", i === BARS.length - 1 ? "bg-gradient-to-t from-[#2f8cff] to-[#8bc4ff]" : "bg-white/[0.09]")}
                        style={{ height: `${h}%` }}
                      />
                      <span className="text-[9px] text-white/35">{MONTHS[i]}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="hidden flex-col gap-2 sm:flex">
                {[
                  { icon: BellRing, title: t("landing.mockup.smsTitle"), body: t("landing.mockup.smsBody") },
                  { icon: CheckCircle2, title: t("landing.mockup.paid"), body: t("landing.mockup.paidBody") },
                  { icon: FileText, title: t("landing.mockup.reportCard"), body: t("landing.mockup.rank") },
                ].map((r) => (
                  <div key={r.title} className="flex items-center gap-2.5 rounded-xl border border-white/[0.06] bg-white/[0.02] p-2.5">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.06] text-[#aab1ff]">
                      <r.icon className="size-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium text-white/90">{r.title}</p>
                      <p className="truncate text-[11px] text-white/45">{r.body}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* floating cards */}
      <div className="mk-float absolute top-10 -left-4 hidden w-60 rounded-2xl p-4 [--mk-rotate:-7deg] lg:block mk-glass-strong xl:-left-14">
        <div className="flex items-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-full bg-[#4f5bff]/25 text-xs font-semibold text-[#c7cdff]">KP</span>
          <div>
            <p className="text-sm font-medium text-white">Kavindu Perera</p>
            <p className="text-[11px] text-white/50">{t("landing.mockup.reportCard")}</p>
          </div>
        </div>
        <div className="mt-4 flex items-end justify-between">
          <div>
            <p className="text-[11px] text-white/50">{t("landing.mockup.average")}</p>
            <p className="mk-display text-2xl font-semibold text-white">70.56</p>
          </div>
          <span className="rounded-full bg-emerald-400/15 px-2 py-0.5 text-[11px] font-medium text-emerald-300">{t("landing.mockup.rank")}</span>
        </div>
        <div className="mt-3 flex gap-1.5">
          {["A", "A", "A", "B", "B", "B", "C", "C"].map((g, i) => (
            <span key={i} className="flex size-6 items-center justify-center rounded-md bg-white/[0.07] text-[11px] font-semibold text-white/80">
              {g}
            </span>
          ))}
        </div>
      </div>

      <div className="mk-float absolute top-28 -right-4 hidden w-56 rounded-2xl p-4 [--mk-rotate:6deg] [animation-delay:-3s] lg:block mk-glass-strong xl:-right-12">
        <span className="flex size-9 items-center justify-center rounded-full bg-emerald-400/15 text-emerald-300">
          <CheckCircle2 className="size-5" />
        </span>
        <p className="mt-3 text-sm font-medium text-white">{t("landing.mockup.paid")}</p>
        <p className="text-[11px] text-white/50">{t("landing.mockup.paidBody")}</p>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10">
          <div className="h-full w-full rounded-full bg-gradient-to-r from-[#4f5bff] to-[#2f8cff]" />
        </div>
      </div>

      <div className="mk-float absolute -bottom-6 left-1/2 z-10 hidden -translate-x-1/2 items-center gap-3 rounded-full py-2 pr-5 pl-2 [animation-delay:-1.5s] md:flex mk-glass-strong">
        <span className="flex size-8 items-center justify-center rounded-full bg-[#4f5bff] text-white">
          <BellRing className="size-4" />
        </span>
        <div>
          <p className="text-xs font-medium text-white">{t("landing.mockup.smsTitle")}</p>
          <p className="text-[11px] text-white/50">{t("landing.mockup.smsBody")}</p>
        </div>
      </div>

      {/* fade into the page */}
      <div className="pointer-events-none absolute inset-x-0 -bottom-2 h-20 bg-gradient-to-t from-[#03040f] to-transparent" />
    </div>
  );
}

function Stat({ label, value, delta }: { label: string; value: string; delta: string }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-2.5 sm:p-3.5">
      <p className="truncate text-[10px] text-white/45 sm:text-xs">{label}</p>
      <p className="mk-display mt-1 text-base font-semibold text-white sm:text-xl">{value}</p>
      <p className="mt-0.5 text-[10px] text-[#8bc4ff] sm:text-[11px]">{delta}</p>
    </div>
  );
}
