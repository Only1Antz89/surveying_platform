import Link from "next/link";
import { BrandMark } from "@surveynt/ui";

export const metadata = { title: "Page not found" };

/** Shown for unknown addresses and for records a route reports as missing. */
export default function NotFound() {
  return <main className="system-page">
    <section className="panel system-panel" aria-labelledby="not-found-title">
      <BrandMark />
      <span className="eyebrow">404</span>
      <h1 id="not-found-title">This page could not be found</h1>
      <p>The link may be mistyped, or the record may have been archived or moved. Nothing has been changed.</p>
      <div className="action-row"><Link className="button button-primary" href="/">Go to Surveynt</Link><Link className="button button-secondary" href="/sign-in">Sign in</Link></div>
    </section>
  </main>;
}
