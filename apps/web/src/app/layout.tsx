import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Surveynt", template: "%s · Surveynt" },
  description: "Survey intelligence, from site to report.",
};

function Document({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) return <Document>{children}</Document>;
  return <ClerkProvider appearance={{ variables: { colorPrimary: "#3b82f6", colorForeground: "#0f1b2d", colorMutedForeground: "#64748b", colorBackground: "#ffffff", colorBorder: "#e5e7eb", borderRadius: "8px", fontFamily: "var(--font-geist-sans)" } }}><Document>{children}</Document></ClerkProvider>;
}
