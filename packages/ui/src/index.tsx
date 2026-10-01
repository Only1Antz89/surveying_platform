import type { ButtonHTMLAttributes, ReactNode } from "react";

export function BrandMark({ compact = false, variant = "reversed" }: { compact?: boolean; variant?: "primary" | "reversed" }) {
  return (
    <span className={`brand-mark brand-mark-${variant}`} aria-label="Surveynt">
      <svg className="brand-symbol" viewBox="0 0 40 36" aria-hidden="true">
        <path className="brand-edge brand-edge-neutral" d="M17.2 8.4 7.5 25.2" />
        <path className="brand-edge brand-edge-accent" d="m22.8 8.4 9.7 16.8" />
        <path className="brand-edge brand-edge-base" d="M11 29h18" />
        <circle className="brand-node brand-node-top" cx="20" cy="5.5" r="5.5" />
        <circle className="brand-node brand-node-left" cx="6" cy="29" r="5.5" />
        <circle className="brand-node brand-node-right" cx="34" cy="29" r="5.5" />
      </svg>
      {compact ? null : <strong>Surveynt</strong>}
    </span>
  );
}

export function StatusDot({ tone = "blue", children }: { tone?: "blue" | "green" | "amber" | "slate" | "red"; children: ReactNode }) {
  return <span className={`status status-${tone}`}><i aria-hidden="true" />{children}</span>;
}

export function Button({ className = "", variant = "primary", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "quiet" }) {
  return <button className={`button button-${variant} ${className}`} {...props} />;
}
