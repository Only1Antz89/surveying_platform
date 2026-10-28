"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
export function ProvisioningRecovery({
  requests,
}: {
  requests: { id: string; name: string; ownerEmail: string; state: string }[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(""),
    [error, setError] = useState("");
  if (!requests.length) return null;
  return (
    <section className="panel" style={{ marginBottom: 24 }}>
      <div className="panel-header">
        <div>
          <h2>Customer setup needs attention</h2>
          <p>
            Resume interrupted requests without creating duplicate customer
            accounts.
          </p>
        </div>
      </div>
      {error ? (
        <p role="alert" className="console-error">
          {error}
        </p>
      ) : null}
      {requests.map((r) => (
        <div className="toolbar" key={r.id}>
          <strong>{r.name}</strong>
          <span>
            {r.ownerEmail} · {r.state}
          </span>
          <button
            className="button button-secondary"
            disabled={Boolean(busy)}
            onClick={async () => {
              setBusy(r.id);
              setError("");
              try {
                const response = await fetch(
                  `/api/platform/tenants/provisioning/${r.id}/retry`,
                  { method: "POST" },
                );
                const payload = await response.json();
                if (!response.ok)
                  throw Error(
                    payload.error?.message ?? "Could not resume setup.",
                  );
                router.push(`/platform/tenants/${payload.data.id}`);
                router.refresh();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy("");
              }
            }}
          >
            {busy === r.id ? "Resuming…" : "Resume setup"}
          </button>
        </div>
      ))}
    </section>
  );
}
