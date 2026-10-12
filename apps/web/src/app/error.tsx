"use client";
import Link from "next/link";

/** Recoverable failure inside the app: the shell stays, and the user can retry or leave. */
export default function ErrorPage({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <main className="system-page">
    <section className="panel system-panel" role="alert" aria-labelledby="error-title">
      <span className="eyebrow">Something went wrong</span>
      <h1 id="error-title">This page could not be loaded</h1>
      <p>Your saved work is not affected. Try again, and if it keeps happening, contact support with the reference below.</p>
      {error.digest ? <p className="form-help">Reference: <code>{error.digest}</code></p> : null}
      <div className="action-row"><button type="button" className="button button-primary" onClick={() => retry()}>Try again</button><Link className="button button-secondary" href="/">Go to Surveynt</Link></div>
    </section>
  </main>;
}
