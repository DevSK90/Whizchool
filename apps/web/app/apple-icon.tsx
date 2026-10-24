import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#3b45cf" }}>
        <svg width="132" height="132" viewBox="4 4 24 24">
          <path d="M7.5 11.5 11 22l3.2-7.6L17.4 22 21 11.5" fill="none" stroke="#fbfbfe" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="24.5" cy="10" r="2.4" fill="#fbfbfe" />
        </svg>
      </div>
    ),
    size,
  );
}
