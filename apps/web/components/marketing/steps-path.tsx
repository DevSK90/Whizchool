import { ChevronRight } from "lucide-react";
import { serverT as t } from "@/i18n/server";
import { cn } from "@/lib/utils";

const STEPS = ["one", "two", "three", "four"] as const;
// Vertical offset of each step on desktop (px) — the cards climb along the curve.
const OFFSETS = [216, 132, 60, 0];

/** Four admission steps rising along a glowing curve (stacked list on small screens). */
export function StepsPath() {
  return (
    <div className="relative">
      {/* curve behind the steps (desktop) */}
      <svg aria-hidden className="pointer-events-none absolute inset-x-0 top-0 hidden h-[260px] w-full md:block" viewBox="0 0 1000 260" preserveAspectRatio="none" fill="none">
        <defs>
          <linearGradient id="mk-path" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor="#4f5bff" stopOpacity="0" />
            <stop offset="0.2" stopColor="#4f5bff" stopOpacity="0.8" />
            <stop offset="1" stopColor="#8bc4ff" stopOpacity="0.9" />
          </linearGradient>
        </defs>
        {/* smooth curve through the four step-node centres (x≈col start+22, y=offset+22) */}
        <path d="M -20 250 Q 0 244 22 238 C 70.7 221.7 188.7 180 272 154 C 355.3 128 438.7 104 522 82 C 605.3 60 690.7 35 772 22 C 853.3 9 970 7 1010 4" stroke="url(#mk-path)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </svg>

      <ol className="relative grid gap-5 md:grid-cols-4 md:gap-4">
        {STEPS.map((s, i) => (
          <li key={s} className="mk-reveal relative" style={{ ["--mk-offset" as string]: `${OFFSETS[i]}px` }}>
            <div className="md:mt-[var(--mk-offset)]">
              <span
                className={cn(
                  "relative z-10 flex size-11 items-center justify-center rounded-full border text-sm font-semibold",
                  i === STEPS.length - 1 ? "border-[#8bc4ff]/50 bg-[#4f5bff] text-white shadow-[0_0_30px_rgba(79,91,255,0.7)]" : "border-white/15 bg-[#0d1030] text-white",
                )}
              >
                0{i + 1}
              </span>
              <div className="mt-3 rounded-2xl p-4 mk-glass-strong">
                <h3 className="font-semibold text-white">{t(`landing.how.steps.${s}.title`)}</h3>
                <ul className="mt-2 space-y-1.5">
                  {(["a", "b"] as const).map((k) => (
                    <li key={k} className="flex items-start gap-1.5 text-sm text-white/60">
                      <ChevronRight className="mt-0.5 size-3.5 shrink-0 text-[#8b93ff]" />
                      {t(`landing.how.steps.${s}.${k}`)}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
