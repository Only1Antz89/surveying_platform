"use client";

import { useEffect, useState } from "react";
import { CheckCircle2 } from "lucide-react";

export function ActionButton({ children, message, className = "button button-secondary" }: { children: React.ReactNode; message: string; className?: string }) {
  const [toast, setToast] = useState(false);
  useEffect(() => { if (!toast) return; const id = window.setTimeout(() => setToast(false), 2400); return () => window.clearTimeout(id); }, [toast]);
  return <><button className={className} onClick={() => setToast(true)}>{children}</button>{toast ? <div className="toast" role="status"><CheckCircle2 size={16} />{message}</div> : null}</>;
}
