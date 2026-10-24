import { Archive, CreditCard, History, ShieldCheck, UsersRound } from "lucide-react";
import { serverT as t } from "@/i18n/server";
import { cn } from "@/lib/utils";

const ITEMS = [
  { key: "access", icon: UsersRound },
  { key: "audit", icon: History },
  { key: "payments", icon: CreditCard },
  { key: "records", icon: Archive },
] as const;

/** 2×2 grid of guarantees around a central shield, with glowing corner accents. */
export function SecurityGrid() {
  return (
    <div className="mk-reveal relative mx-auto max-w-4xl">
      {/* corner glows */}
      <span aria-hidden className="absolute -top-px -right-px h-24 w-px bg-gradient-to-b from-[#c084fc] to-transparent" />
      <span aria-hidden className="absolute -top-px -right-px h-px w-40 bg-gradient-to-l from-[#c084fc] to-transparent" />
      <span aria-hidden className="absolute -bottom-px -left-px h-24 w-px bg-gradient-to-t from-[#c084fc] to-transparent" />
      <span aria-hidden className="absolute -bottom-px -left-px h-px w-40 bg-gradient-to-r from-[#c084fc] to-transparent" />

      <div className="grid overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.06] sm:grid-cols-2" style={{ gap: "1px" }}>
        {ITEMS.map(({ key, icon: Icon }, i) => (
          <div
            key={key}
            className={cn(
              "flex flex-col items-center bg-[#0a0c24] px-6 py-10 text-center sm:px-10",
              i < 2 ? "sm:pb-14" : "sm:pt-14",
            )}
          >
            <span className="flex size-12 items-center justify-center rounded-full border border-white/10 bg-white/[0.06] text-white/85">
              <Icon className="size-5" />
            </span>
            <h3 className="mt-4 font-semibold text-white">{t(`landing.security.${key}.title`)}</h3>
            <p className="mt-2 max-w-xs text-sm leading-relaxed text-white/55">{t(`landing.security.${key}.body`)}</p>
          </div>
        ))}
      </div>

      {/* central shield */}
      <div aria-hidden className="absolute top-1/2 left-1/2 hidden -translate-x-1/2 -translate-y-1/2 sm:block">
        <div className="flex size-24 items-center justify-center rounded-full border border-white/10 bg-[#0a0c24] shadow-[0_0_0_10px_rgba(10,12,36,1),0_0_60px_rgba(79,91,255,0.45)]">
          <span className="flex size-14 items-center justify-center rounded-full bg-gradient-to-b from-white/15 to-white/5 text-white">
            <ShieldCheck className="size-7" />
          </span>
        </div>
      </div>
    </div>
  );
}
