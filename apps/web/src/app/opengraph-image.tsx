import { ImageResponse } from "next/og";

export const alt = "Surveynt: survey intelligence, from site to report";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Social sharing card, drawn from the brand mark so links look right on LinkedIn, Slack and X. */
export default function OpenGraphImage() {
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 80, background: "#0f1b2d", color: "#ffffff", fontFamily: "sans-serif" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
        <svg width="96" height="96" viewBox="0 0 64 64">
          <rect width="64" height="64" rx="14" fill="#ffffff" />
          <path d="M27.6 18.5 15.7 39" fill="none" stroke="#0f1b2d" strokeWidth="6" strokeLinecap="square" />
          <path d="m36.4 18.5 11.9 20.5" fill="none" stroke="#3b82f6" strokeWidth="6" strokeLinecap="square" />
          <path d="M20 45h24" fill="none" stroke="#4b6585" strokeWidth="6" strokeLinecap="square" />
          <circle cx="32" cy="14" r="8" fill="#3b82f6" />
          <circle cx="13" cy="45" r="8" fill="#0f1b2d" />
          <circle cx="51" cy="45" r="8" fill="#3b82f6" />
        </svg>
        <div style={{ fontSize: 64, fontWeight: 700, letterSpacing: -1 }}>Surveynt</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <div style={{ fontSize: 68, fontWeight: 700, lineHeight: 1.1, maxWidth: 940 }}>Survey intelligence, from site to report.</div>
        <div style={{ fontSize: 32, color: "#9fb3cc" }}>Quotes, bookings, fieldwork and RICS reports in one workspace for surveying practices.</div>
      </div>
    </div>,
    size,
  );
}
