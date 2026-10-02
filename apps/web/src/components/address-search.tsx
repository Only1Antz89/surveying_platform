"use client";

import { KeyboardEvent, useId, useState } from "react";
import { MapPin, Search } from "lucide-react";
import type { AddressCandidate, AddressSearchResponse } from "@/lib/property-identity";

export type AddressSelection = { lookupId: string; candidate: AddressCandidate };

const precisionLabels: Record<AddressCandidate["precision"], string> = {
  postcode: "Approximate: postcode centre",
  building: "Building-level match",
  street: "Street-level match",
  area: "Area only: too imprecise",
};

/**
 * Submit-only address search. It deliberately never searches per keystroke
 * (provider usage policies), and manual entry stays available whatever the
 * provider state.
 */
export function AddressSearch({ initialQuery = "", onSelect, disabled = false, label = "Find an address or postcode" }: { initialQuery?: string; onSelect: (selection: AddressSelection) => void; disabled?: boolean; label?: string }) {
  const inputId = useId();
  const [query, setQuery] = useState(initialQuery);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AddressSearchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function search() {
    if (loading || query.trim().length < 3) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const response = await fetch(`/api/v1/address/search?q=${encodeURIComponent(query.trim())}`);
      const payload = await response.json();
      if (!response.ok) setError(payload?.error?.message ?? "Address search is unavailable. Enter the address manually.");
      else setResult(payload.data as AddressSearchResponse);
    } catch {
      setError("Address search is unavailable. Enter the address manually.");
    } finally {
      setLoading(false);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      void search();
    }
  }

  const statusMessage = loading ? "Searching…" : error ?? result?.message ?? (result?.status === "matched" ? `${result.candidates.length} ${result.candidates.length === 1 ? "result" : "results"}. Check the match before using it.` : null);

  return <div className="address-search">
    <label htmlFor={inputId}>{label}</label>
    <div className="address-search-row">
      <input id={inputId} className="input" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={onKeyDown} maxLength={200} placeholder="For example, BS8 4JX or 18 Royal York Crescent, Bristol" disabled={disabled} autoComplete="off" />
      <button type="button" className="button button-secondary" onClick={() => void search()} disabled={disabled || loading || query.trim().length < 3}><Search size={14} />{loading ? "Searching…" : "Search"}</button>
    </div>
    <p className="form-help" aria-live="polite">{statusMessage ?? "Search runs only when you press Search. You can always type the address yourself."}</p>
    {result?.demo ? <p className="address-demo-label">Demo results: not live address records.</p> : null}
    {result?.candidates.length ? <ul className="address-results">
      {result.candidates.map((candidate) => <li key={`${candidate.source}-${candidate.index}`}>
        <button type="button" className="address-result" onClick={() => result.lookupId && onSelect({ lookupId: result.lookupId, candidate })} disabled={candidate.precision === "area" || !result.lookupId}>
          <MapPin size={14} aria-hidden="true" />
          <span><strong>{candidate.label}</strong><span className="cell-sub">{precisionLabels[candidate.precision]}</span></span>
        </button>
      </li>)}
    </ul> : null}
    {result?.attribution.length ? <p className="attribution">{result.attribution.join(" ")}</p> : null}
  </div>;
}
