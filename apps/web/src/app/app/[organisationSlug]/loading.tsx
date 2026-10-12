/** Shown inside the workspace shell while a page's records load. */
export default function Loading() {
  return <main className="page" aria-busy="true" aria-live="polite">
    <p className="sr-only">Loading…</p>
    <div className="loading-skeleton" aria-hidden="true"><span className="loading-line wide" /><span className="loading-line" /><span className="loading-block" /><span className="loading-block" /></div>
  </main>;
}
