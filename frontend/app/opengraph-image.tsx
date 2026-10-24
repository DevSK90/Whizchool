import { ImageResponse } from "next/og";
import { serverT as t } from "@/i18n/server";

export const alt = `${t("common.appName")} — ${t("common.tagline")}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Shared by `/` and `/apply` (the only indexed pages); rendered once at build time.
export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 80,
          color: "#fff",
          background: "radial-gradient(circle at 78% 18%, #4f5bff 0%, rgba(79,91,255,0) 48%), radial-gradient(circle at 12% 100%, #2f8cff 0%, rgba(47,140,255,0) 42%), #03040f",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
          <svg width="76" height="76" viewBox="0 0 32 32">
            <rect width="32" height="32" rx="9" fill="#3b45cf" />
            <path d="M7.5 11.5 11 22l3.2-7.6L17.4 22 21 11.5" fill="none" stroke="#fbfbfe" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="24.5" cy="10" r="2.4" fill="#fbfbfe" />
          </svg>
          <span style={{ fontSize: 44, fontWeight: 700, letterSpacing: -1 }}>{t("common.appName")}</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div style={{ fontSize: 76, fontWeight: 700, lineHeight: 1.05, letterSpacing: -2, maxWidth: 960 }}>
            {`${t("landing.hero.titleA")} ${t("landing.hero.titleB")}`}
          </div>
          <div style={{ fontSize: 30, color: "rgba(255,255,255,0.72)", maxWidth: 900, lineHeight: 1.35 }}>{t("landing.metaDescription")}</div>
        </div>
      </div>
    ),
    size,
  );
}
