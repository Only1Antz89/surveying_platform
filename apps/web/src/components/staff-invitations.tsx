"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { platformRoles, platformRoleLabels } from "@surveynt/domain";
type Invitation = {
  id: string;
  email: string;
  role: (typeof platformRoles)[number];
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  delivered: boolean;
};
export function StaffInvitations({
  invitations,
  configured,
}: {
  invitations: Invitation[];
  configured: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [open, setOpen] = useState(false),
    [notice, setNotice] = useState("");
  async function send(url: string, method: string, body?: unknown) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const r = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const j = await r.json();
      if (!r.ok) throw Error(j.error?.message ?? "Invitation failed.");
      setOpen(false);
      setNotice(
        method === "DELETE" ? "Invitation revoked." : "Invitation sent.",
      );
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel" style={{ marginBottom: 24 }}>
      <div className="panel-header">
        <div>
          <h2>Staff invitations</h2>
          <p>
            Invite new colleagues. Roles take effect after verified acceptance.
          </p>
        </div>
        <button
          className="button button-primary"
          disabled={!configured || busy}
          onClick={() => setOpen(!open)}
        >
          Invite staff
        </button>
      </div>
      {!configured ? (
        <p className="console-notice">
          Clerk account synchronisation needs configuration before invitations
          can be sent. Existing verified accounts can still be granted access
          below.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="console-error">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="console-notice">
          {notice}
        </p>
      ) : null}
      {open ? (
        <form
          className="panel-body console-form"
          onSubmit={(e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            void send("/api/platform/staff-invitations", "POST", {
              email: form.get("email"),
              role: form.get("role"),
            });
          }}
        >
          <div className="field">
            <label htmlFor="invite-email">Work email</label>
            <input
              id="invite-email"
              className="input"
              name="email"
              type="email"
              required
            />
          </div>
          <div className="field">
            <label htmlFor="invite-role">Platform role</label>
            <select
              id="invite-role"
              className="select"
              name="role"
              defaultValue="support"
            >
              {platformRoles.map((r) => (
                <option key={r} value={r}>
                  {platformRoleLabels[r]}
                </option>
              ))}
            </select>
          </div>
          <div className="toolbar">
            <button className="button button-primary" disabled={busy}>
              Send invitation
            </button>
            <button
              type="button"
              className="button button-secondary"
              onClick={() => setOpen(false)}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}
      <div className="data-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Email</th>
              <th>Role</th>
              <th>Status</th>
              <th>Expires</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {invitations.map((i) => (
              <tr key={i.id}>
                <td data-label="Email">{i.email}</td>
                <td data-label="Role">{platformRoleLabels[i.role]}</td>
                <td data-label="Status">
                  {i.revokedAt
                    ? "Revoked"
                    : i.acceptedAt
                      ? "Accepted"
                      : new Date(i.expiresAt) < new Date()
                        ? "Expired"
                        : !i.delivered
                          ? "Delivery incomplete"
                          : "Pending"}
                </td>
                <td data-label="Expires">
                  {new Date(i.expiresAt).toLocaleDateString("en-GB", {
                    timeZone: "Europe/London",
                  })}
                </td>
                <td data-label="Actions">
                  {!i.acceptedAt && !i.revokedAt ? (
                    <div className="toolbar">
                      <button
                        className="button button-quiet"
                        disabled={busy || !configured}
                        onClick={() =>
                          void send(
                            `/api/platform/staff-invitations/${i.id}`,
                            "POST",
                          )
                        }
                      >
                        Resend
                      </button>
                      <button
                        className="button button-quiet"
                        disabled={busy}
                        onClick={() =>
                          void send(
                            `/api/platform/staff-invitations/${i.id}`,
                            "DELETE",
                          )
                        }
                      >
                        Revoke
                      </button>
                    </div>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!invitations.length ? (
        <div className="empty-state compact">
          <strong>No staff invitations</strong>
          <span>New invitations will appear here.</span>
        </div>
      ) : null}
    </section>
  );
}
