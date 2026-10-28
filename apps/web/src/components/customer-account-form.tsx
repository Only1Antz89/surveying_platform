"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
type Account = {
  id: string;
  name: string;
  tradingName: string;
  region: string;
  practiceType: string;
  supportEmail: string;
};
export function CustomerAccountForm({
  account,
  disabled = false,
}: {
  account?: Account;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false);
  return (
    <form
      className="panel console-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        setSaved(false);
        const f = new FormData(e.currentTarget);
        const body = account
          ? {
              name: f.get("firmName"),
              tradingName: f.get("tradingName"),
              region: f.get("region"),
              practiceType: f.get("practiceType"),
              supportEmail: f.get("supportEmail"),
            }
          : {
              firmName: f.get("firmName"),
              ownerEmail: f.get("ownerEmail"),
              region: f.get("region"),
              practiceType: f.get("practiceType"),
              teamSize: f.get("teamSize"),
            };
        try {
          const r = await fetch(
            account
              ? `/api/platform/tenants/${account.id}`
              : "/api/platform/tenants",
            {
              method: account ? "PATCH" : "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            },
          );
          const j = await r.json();
          if (!r.ok)
            throw Error(j.error?.message ?? "Account could not be saved.");
          if (account) {
            setSaved(true);
            router.refresh();
          } else router.push(`/platform/tenants/${j.data.id}`);
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="panel-header">
        <div>
          <h2>{account ? "Account details" : "Create a customer account"}</h2>
          <p>
            {account
              ? "Changes are recorded in the account audit trail."
              : "The owner completes setup and billing. You remain a platform operator."}
          </p>
        </div>
      </div>
      <fieldset
        className="panel-body"
        disabled={disabled || busy}
        style={{ border: 0, margin: 0 }}
      >
        <div className="field">
          <label htmlFor="customer-name">Firm name</label>
          <input
            id="customer-name"
            className="input"
            name="firmName"
            defaultValue={account?.name}
            minLength={2}
            maxLength={160}
            required
          />
        </div>
        {account ? (
          <>
            <div className="field">
              <label htmlFor="customer-trading">Trading name</label>
              <input
                id="customer-trading"
                className="input"
                name="tradingName"
                defaultValue={account.tradingName}
                minLength={2}
                maxLength={160}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="customer-support">Support email</label>
              <input
                id="customer-support"
                className="input"
                name="supportEmail"
                type="email"
                defaultValue={account.supportEmail}
              />
            </div>
          </>
        ) : (
          <>
            <div className="field">
              <label htmlFor="customer-owner">Owner email</label>
              <input
                id="customer-owner"
                className="input"
                name="ownerEmail"
                type="email"
                required
              />
            </div>
            <div className="field">
              <label htmlFor="customer-size">Team size</label>
              <select id="customer-size" className="select" name="teamSize">
                {["1-5", "6-15", "16-50", "51+"].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </div>
          </>
        )}
        <div className="field">
          <label htmlFor="customer-type">Practice type</label>
          <select
            id="customer-type"
            className="select"
            name="practiceType"
            defaultValue={account?.practiceType ?? "multi-disciplinary"}
          >
            {[
              "multi-disciplinary",
              "residential-building-surveying",
              "commercial-building-surveying",
              "valuation",
            ].map((s) => (
              <option key={s} value={s}>
                {s.replaceAll("-", " ")}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="customer-region">Region</label>
          {account ? (
            <input
              id="customer-region"
              className="input"
              name="region"
              defaultValue={account.region}
              required
              minLength={2}
              maxLength={100}
            />
          ) : (
            <select
              id="customer-region"
              className="select"
              name="region"
              defaultValue="South West England"
            >
              {[
                "London",
                "South East England",
                "South West England",
                "Midlands",
                "North of England",
                "Wales",
                "Scotland",
                "Northern Ireland",
              ].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          )}
        </div>
        {error ? (
          <p role="alert" className="console-error">
            {error}
          </p>
        ) : null}
        {saved ? <p role="status">Account details saved.</p> : null}
        <button className="button button-primary" disabled={disabled || busy}>
          {busy
            ? "Saving…"
            : account
              ? "Save changes"
              : "Create account and invite owner"}
        </button>
      </fieldset>
    </form>
  );
}
