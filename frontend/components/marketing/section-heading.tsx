import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Pill label flanked by fading hairlines, as used above every section heading. */
export function Eyebrow({ children, className, lines = true }: { children: ReactNode; className?: string; lines?: boolean }) {
  return (
    <div className={cn("flex items-center justify-center gap-3", className)}>
      {lines && <span aria-hidden className="h-px w-10 bg-gradient-to-r from-transparent to-white/30 sm:w-16" />}
      <span className="mk-pill rounded-full px-3.5 py-1 text-xs font-medium text-white/80">{children}</span>
      {lines && <span aria-hidden className="h-px w-10 bg-gradient-to-l from-transparent to-white/30 sm:w-16" />}
    </div>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  highlight,
  body,
  align = "center",
  className,
}: {
  eyebrow: ReactNode;
  title: ReactNode;
  highlight?: ReactNode;
  body?: ReactNode;
  align?: "center" | "left";
  className?: string;
}) {
  return (
    <div className={cn("mk-reveal flex flex-col gap-4", align === "center" ? "items-center text-center" : "items-start", className)}>
      <Eyebrow lines={align === "center"}>{eyebrow}</Eyebrow>
      <h2 className="mk-display max-w-3xl text-3xl font-semibold text-balance text-white sm:text-4xl md:text-[2.75rem] md:leading-[1.12]">
        {title}
        {highlight && (
          <>
            {" "}
            <span className="mk-text-gradient">{highlight}</span>
          </>
        )}
      </h2>
      {body && <p className={cn("max-w-2xl text-base text-pretty text-white/60 sm:text-lg", align === "center" && "mx-auto")}>{body}</p>}
    </div>
  );
}
