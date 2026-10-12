"use client";

// Replaces the root layout when it fails, so it carries its own document and minimal styles.
const css = `:root{color-scheme:light dark;--bg:#f3f6fb;--surface:#fff;--ink:#102038;--muted:#5c6e85;--blue:#2563eb}
@media(prefers-color-scheme:dark){:root{--bg:#0b1421;--surface:#111e30;--ink:#edf3fc;--muted:#a2b3ca;--blue:#60a5fa}}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--ink);font:16px/1.5 system-ui,sans-serif;padding:16px}
section{max-width:480px;background:var(--surface);border-radius:12px;padding:32px}p{color:var(--muted)}
button{font:inherit;padding:10px 16px;border:0;border-radius:8px;background:var(--blue);color:#fff;cursor:pointer}
button:focus-visible{outline:3px solid var(--blue);outline-offset:3px}`;

export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <html lang="en"><body>
    <title>Surveynt is unavailable</title>
    <style>{css}</style>
    <section role="alert" aria-labelledby="global-error-title">
      <h1 id="global-error-title">Surveynt could not load</h1>
      <p>Your saved work is not affected. Please try again in a moment.</p>
      {error.digest ? <p>Reference: <code>{error.digest}</code></p> : null}
      <button type="button" onClick={() => retry()}>Try again</button>
    </section>
  </body></html>;
}
