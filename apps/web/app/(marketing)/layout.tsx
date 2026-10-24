import { Sora } from "next/font/google";
import { MarketingFooter } from "@/components/marketing/marketing-footer";
import { MarketingNav } from "@/components/marketing/marketing-nav";

const display = Sora({ subsets: ["latin"], variable: "--font-display", weight: ["400", "500", "600", "700"] });

/** Marketing pages always use the dark brand surface, independent of the app theme. */
export default function MarketingLayout({ children }: LayoutProps<"/">) {
  return (
    <div className={`${display.variable} mk dark min-h-svh bg-[#03040f] text-white [color-scheme:dark]`}>
      <MarketingNav />
      {children}
      <MarketingFooter />
    </div>
  );
}
