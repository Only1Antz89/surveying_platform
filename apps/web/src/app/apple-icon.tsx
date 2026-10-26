import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/** Home-screen icon for iPhone and iPad, matching icon.svg. */
export default function AppleIcon() {
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#ffffff" }}>
      <svg width="150" height="150" viewBox="0 0 64 64">
        <path d="M27.6 18.5 15.7 39" fill="none" stroke="#0f1b2d" strokeWidth="6" strokeLinecap="square" />
        <path d="m36.4 18.5 11.9 20.5" fill="none" stroke="#3b82f6" strokeWidth="6" strokeLinecap="square" />
        <path d="M20 45h24" fill="none" stroke="#4b6585" strokeWidth="6" strokeLinecap="square" />
        <circle cx="32" cy="14" r="8" fill="#3b82f6" />
        <circle cx="13" cy="45" r="8" fill="#0f1b2d" />
        <circle cx="51" cy="45" r="8" fill="#3b82f6" />
      </svg>
    </div>,
    size,
  );
}
