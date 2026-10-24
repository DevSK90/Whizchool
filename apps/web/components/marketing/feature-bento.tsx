import type { ReactNode } from "react";
import { BellRing, CalendarCheck, Check, FileText, GraduationCap, Smartphone, UserPlus, Wallet, type LucideIcon } from "lucide-react";
import { serverT as t } from "@/i18n/server";
import { cn } from "@/lib/utils";

function Tile({
  icon: Icon,
  title,
  body,
  children,
  className,
  glow = "left",
}: {
  icon: LucideIcon;
  title: string;
  body: string;
  children?: ReactNode;
  className?: string;
  glow?: "left" | "right" | "none";
}) {
  return (
    <article className={cn("mk-reveal group relative flex flex-col overflow-hidden rounded-3xl border border-white/[0.08] bg-[#070920] p-6 sm:p-7", className)}>
      {glow !== "none" && (
        <div
          aria-hidden
          className={cn(
            "pointer-events-none absolute -top-24 size-72 rounded-full bg-[radial-gradient(closest-side,rgba(79,91,255,0.35),transparent)] blur-2xl transition-opacity duration-500 group-hover:opacity-100",
            glow === "left" ? "-left-20 opacity-70" : "-right-20 opacity-60",
          )}
        />
      )}
      <div className="relative">
        <span className="flex size-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.06] text-[#aab1ff]">
          <Icon className="size-5" />
        </span>
        <h3 className="mk-display mt-5 text-xl font-semibold text-white">{title}</h3>
        <p className="mt-2 max-w-md text-sm leading-relaxed text-white/55">{body}</p>
      </div>
      {children && <div className="relative mt-6 flex-1">{children}</div>}
    </article>
  );
}

const MARKS = [
  { name: "Kavindu Perera", mark: 81, grade: "A" },
  { name: "Nethmi Silva", mark: 74, grade: "B" },
  { name: "Arjun Krishnan", mark: 66, grade: "B" },
  { name: "Fathima Ismail", mark: 58, grade: "C" },
];

export function FeatureBento() {
  const ui = (k: string) => t(`landing.features.ui.${k}` as "landing.features.ui.view");
  return (
    <div className="grid gap-4 md:grid-cols-6">
      {/* Results — large */}
      <Tile icon={FileText} title={t("landing.features.results.title")} body={t("landing.features.results.body")} className="md:col-span-4">
        <div className="grid gap-3 sm:grid-cols-[1.4fr_1fr]" aria-hidden>
          <div className="rounded-2xl border border-white/[0.07] bg-white/[0.03] p-4">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-white/80">{ui("markSheet")}</p>
              <span className="flex items-center gap-1 rounded-full bg-emerald-400/15 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
                <Check className="size-3" /> {ui("submitted")}
              </span>
            </div>
            <ul className="mt-3 space-y-2">
              {MARKS.map((m) => (
                <li key={m.name} className="flex items-center gap-3 text-xs">
                  <span className="flex-1 truncate text-white/70">{m.name}</span>
                  <span className="w-10 rounded-md bg-white/[0.06] py-1 text-center text-white tabular">{m.mark}</span>
                  <span className="w-4 text-center font-semibold text-[#aab1ff]">{m.grade}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="flex flex-col justify-between rounded-2xl border border-white/[0.07] bg-white/[0.03] p-4">
            <p className="text-xs text-white/50">{ui("classAvg")}</p>
            <div className="flex h-24 items-end gap-2">
              {[52, 61, 58, 70, 66, 76].map((h, i) => (
                <div key={i} className={cn("flex-1 rounded-t-[4px]", i === 5 ? "bg-gradient-to-t from-[#4f5bff] to-[#a5b4ff]" : "bg-white/[0.09]")} style={{ height: `${h}%` }} />
              ))}
            </div>
            <div className="flex gap-2">
              <span className="flex-1 rounded-full bg-white px-3 py-1.5 text-center text-[11px] font-medium text-[#0a0b1e]">{ui("approve")}</span>
              <span className="flex-1 rounded-full border border-white/15 px-3 py-1.5 text-center text-[11px] text-white/80">{ui("view")}</span>
            </div>
          </div>
        </div>
      </Tile>

      {/* Attendance */}
      <Tile icon={CalendarCheck} title={t("landing.features.attendance.title")} body={t("landing.features.attendance.body")} className="md:col-span-2" glow="right">
        <div className="space-y-2" aria-hidden>
          {[
            { n: "Sanduni", s: "present" },
            { n: "Ravindu", s: "absent" },
            { n: "Imesha", s: "late" },
          ].map((r) => (
            <div key={r.n} className="flex items-center justify-between rounded-xl border border-white/[0.07] bg-white/[0.03] px-3 py-2 text-xs">
              <span className="text-white/75">{r.n}</span>
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[10px] font-medium",
                  r.s === "present" && "bg-emerald-400/15 text-emerald-300",
                  r.s === "absent" && "bg-rose-400/15 text-rose-300",
                  r.s === "late" && "bg-amber-400/15 text-amber-300",
                )}
              >
                {ui(r.s)}
              </span>
            </div>
          ))}
          <div className="flex items-center justify-between rounded-xl border border-[#4f5bff]/40 bg-[#4f5bff]/10 px-3 py-2 text-xs">
            <span className="flex items-center gap-2 text-white/85">
              <BellRing className="size-3.5 text-[#aab1ff]" /> {ui("smsParents")}
            </span>
            <span className="relative h-4 w-7 rounded-full bg-[#4f5bff]">
              <span className="absolute top-0.5 right-0.5 size-3 rounded-full bg-white" />
            </span>
          </div>
        </div>
      </Tile>

      {/* Fees */}
      <Tile icon={Wallet} title={t("landing.features.fees.title")} body={t("landing.features.fees.body")} className="md:col-span-2" glow="none">
        <ul className="space-y-2" aria-hidden>
          {[
            { m: "Oct 2026", a: "19,000", paid: false },
            { m: "Sep 2026", a: "17,500", paid: true },
            { m: "Aug 2026", a: "17,500", paid: true },
          ].map((r) => (
            <li key={r.m} className="flex items-center justify-between rounded-xl border border-white/[0.07] bg-white/[0.03] px-3 py-2 text-xs">
              <span className="text-white/75">
                {ui("invoice")} · {r.m}
              </span>
              <span className="flex items-center gap-2">
                <span className="text-white tabular">{r.a}</span>
                <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", r.paid ? "bg-emerald-400/15 text-emerald-300" : "bg-amber-400/15 text-amber-300")}>
                  {r.paid ? ui("paid") : ui("due")}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </Tile>

      {/* Admissions */}
      <Tile icon={UserPlus} title={t("landing.features.admissions.title")} body={t("landing.features.admissions.body")} className="md:col-span-2" glow="left">
        <div className="flex items-center gap-2" aria-hidden>
          {[
            { k: "new", n: 9 },
            { k: "interview", n: 7 },
            { k: "enrolled", n: 5 },
          ].map((s, i) => (
            <div key={s.k} className="flex flex-1 items-center gap-2">
              <div className={cn("flex-1 rounded-xl border px-3 py-3 text-center", i === 2 ? "border-[#4f5bff]/40 bg-[#4f5bff]/10" : "border-white/[0.07] bg-white/[0.03]")}>
                <p className="mk-display text-xl font-semibold text-white">{s.n}</p>
                <p className="text-[10px] text-white/50">{ui(s.k)}</p>
              </div>
              {i < 2 && <span className="h-px w-3 bg-white/20" />}
            </div>
          ))}
        </div>
      </Tile>

      {/* Parent portal */}
      <Tile icon={Smartphone} title={t("landing.features.portal.title")} body={t("landing.features.portal.body")} className="md:col-span-2" glow="right">
        <div className="mx-auto w-40 rounded-[26px] border border-white/15 bg-[#0b0d26] p-2 shadow-[0_20px_60px_-20px_rgba(79,91,255,0.6)]" aria-hidden>
          <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-white/15" />
          <div className="space-y-1.5 rounded-[18px] bg-white/[0.03] p-2.5">
            <div className="flex items-center gap-2">
              <span className="flex size-6 items-center justify-center rounded-full bg-[#4f5bff]/30 text-[9px] font-semibold text-[#c7cdff]">KP</span>
              <span className="text-[10px] font-medium text-white">Kavindu · 10-A</span>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <div className="rounded-lg bg-white/[0.05] p-1.5 text-center">
                <GraduationCap className="mx-auto size-3 text-[#aab1ff]" />
                <p className="text-[11px] font-semibold text-white">70.6</p>
              </div>
              <div className="rounded-lg bg-white/[0.05] p-1.5 text-center">
                <CalendarCheck className="mx-auto size-3 text-[#aab1ff]" />
                <p className="text-[11px] font-semibold text-white">96%</p>
              </div>
            </div>
            <div className="rounded-lg bg-[#4f5bff] py-1.5 text-center text-[10px] font-medium text-white">LKR 19,000 · Pay</div>
          </div>
        </div>
      </Tile>
    </div>
  );
}
