import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { AppearanceProvider } from "@/components/appearance-provider";
import { ModalKeyboard } from "@/components/modal-keyboard";
import { ResponsiveTables } from "@/components/responsive-tables";
import { appearanceBootstrap } from "@/lib/appearance";
import { siteUrl } from "@/lib/site-url";
import { shareMetadata, siteDescription, siteTitle } from "@/lib/share-metadata";
import "./globals.css";
import "./surveynt.css";
import "./workspace-ui.css";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: { default: siteTitle, template: "%s · Surveynt" },
  description: siteDescription,
  applicationName: "Surveynt",
  openGraph: shareMetadata("/").openGraph,
  twitter: shareMetadata("/").twitter,
};

function Document({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <head><script dangerouslySetInnerHTML={{ __html: appearanceBootstrap }} /></head>
      <body><AppearanceProvider>{children}</AppearanceProvider><ModalKeyboard /><ResponsiveTables /></body>
    </html>
  );
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <Document>{children}</Document>;
}
