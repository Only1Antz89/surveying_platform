import type { ButtonHTMLAttributes, ReactNode } from "react";

export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <span className="brand-mark" aria-label="FIELDNOTE">
      <span className="brand-symbol" aria-hidden="true"><i /><i /><i /></span>
      {compact ? null : <strong>FIELDNOTE</strong>}
    </span>
  );
}

export function StatusDot({ tone = "blue", children }: { tone?: "blue" | "green" | "amber" | "slate" | "red"; children: ReactNode }) {
  return <span className={`status status-${tone}`}><i aria-hidden="true" />{children}</span>;
}

export function Button({ className = "", variant = "primary", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "quiet" }) {
  return <button className={`button button-${variant} ${className}`} {...props} />;
}
