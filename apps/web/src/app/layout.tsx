import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { AppearanceProvider } from "@/components/appearance-provider";
import { ModalKeyboard } from "@/components/modal-keyboard";
import { appearanceBootstrap } from "@/lib/appearance";
import "./globals.css";
import "./surveynt.css";
import "./workspace-ui.css";

export const metadata: Metadata = {
  title: { default: "Surveynt", template: "%s · Surveynt" },
  description: "Survey intelligence, from site to report.",
  icons: { icon: "/favicon.svg" },
};

function Document({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <head><script dangerouslySetInnerHTML={{ __html: appearanceBootstrap }} /></head>
      <body><AppearanceProvider>{children}</AppearanceProvider><ModalKeyboard /></body>
    </html>
  );
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <Document>{children}</Document>;
}
