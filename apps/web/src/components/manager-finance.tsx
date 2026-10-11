"use client";

import { useState } from "react";
import Link from "@/components/workspace-link";
import {
  Search,
  Plus,
  Bot,
  Eye,
  X
} from "lucide-react";
import "./manager-finance.css";

interface InvoiceRecord {
  id: string;
  invoiceNumber: string;
  jobReference: string;
  client: string;
  issued: string;
  due: string;
  amount: number;
  status: "Overdue" | "Due soon" | "Outstanding" | "Paid";
  tone: "overdue" | "due" | "outstanding" | "paid";
}

const initialInvoices: InvoiceRecord[] = [
  {
    id: "inv_1",
    invoiceNumber: "INV-1048",
    jobReference: "CS-24076",
    client: "Morgan Lewis",
    issued: "24 Sep 2026",
    due: "24 Sep 2026",
    amount: 850,
    status: "Overdue",
    tone: "overdue"
  },
  {
    id: "inv_2",
    invoiceNumber: "INV-1041",
    jobReference: "CS-24078",
    client: "Olivia Reed",
    issued: "24 Sep 2026",
    due: "2 Oct 2026",
    amount: 400,
    status: "Overdue",
    tone: "overdue"
  },
  {
    id: "inv_3",
    invoiceNumber: "INV-1052",
    jobReference: "CS-24084",
    client: "Priya Patel",
    issued: "28 Sep 2026",
    due: "12 Oct 2026",
    amount: 620,
    status: "Due soon",
    tone: "due"
  },
  {
    id: "inv_4",
    invoiceNumber: "INV-1054",
    jobReference: "CS-24081",
    client: "Alex Harper",
    issued: "1 Oct 2026",
    due: "15 Oct 2026",
    amount: 795,
    status: "Outstanding",
    tone: "outstanding"
  },
  {
    id: "inv_5",
    invoiceNumber: "INV-1046",
    jobReference: "CS-24091",
    client: "Jamie Morgan",
    issued: "25 Sep 2026",
    due: "9 Oct 2026",
    amount: 695,
    status: "Paid",
    tone: "paid"
  },
  {
    id: "inv_6",
    invoiceNumber: "INV-1039",
    jobReference: "CS-24094",
    client: "Taylor Bennett",
    issued: "22 Sep 2026",
    due: "6 Oct 2026",
    amount: 480,
    status: "Paid",
    tone: "paid"
  }
];

export function ManagerFinance({ slug }: { slug: string }) {
  const [invoices, setInvoices] = useState<InvoiceRecord[]>(initialInvoices);
  const [filter, setFilter] = useState<string>("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [toastMessage, setToastMessage] = useState("");

  const filteredInvoices = invoices.filter((inv) => {
    const matchesFilter =
      filter === "all" ||
      (filter === "outstanding" && (inv.status === "Outstanding" || inv.status === "Due soon")) ||
      (filter === "overdue" && inv.status === "Overdue") ||
      (filter === "paid" && inv.status === "Paid");

    const matchesSearch =
      inv.invoiceNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
      inv.client.toLowerCase().includes(searchTerm.toLowerCase()) ||
      inv.jobReference.toLowerCase().includes(searchTerm.toLowerCase());

    return matchesFilter && matchesSearch;
  });

  const showNotice = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(""), 3500);
  };

  const handleCreateSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const client = fd.get("client") as string;
    const amount = Number(fd.get("amount") || 750);
    const jobReference = fd.get("job") as string;

    const newInv: InvoiceRecord = {
      id: "inv_" + Date.now(),
      invoiceNumber: "INV-" + Math.floor(1060 + Math.random() * 50),
      jobReference,
      client,
      issued: "Today",
      due: "23 Oct 2026",
      amount,
      status: "Outstanding",
      tone: "outstanding"
    };

    setInvoices((prev) => [newInv, ...prev]);
    setShowCreateModal(false);
    showNotice(`Invoice ${newInv.invoiceNumber} created for £${amount}.`);
  };

  return (
    <div className="manager-fin-container">
      {toastMessage && (
        <div style={{ background: "#ecfdf5", border: "1px solid #a7f3d0", color: "#065f46", padding: "12px 16px", borderRadius: 6, fontSize: 13 }}>
          <strong>Notice:</strong> {toastMessage}
        </div>
      )}

      {/* Header */}
      <div className="manager-fin-header">
        <div className="manager-fin-title-group">
          <span className="manager-fin-eyebrow">BUSINESS FINANCE · SAMPLE DATA</span>
          <h1>See what’s billed and what’s due.</h1>
          <p>Track fees against client instructions, follow payments and keep the case record in view.</p>
        </div>
        <button
          className="manager-btn-primary"
          onClick={() => setShowCreateModal(true)}
        >
          <Plus size={16} /> Create invoice
        </button>
      </div>

      {/* 4 KPIs */}
      <div className="manager-fin-kpis">
        <div className="manager-fin-kpi-card">
          <small>INVOICED THIS MONTH</small>
          <b>£18,420</b>
          <span>Across 24 sample invoices</span>
        </div>
        <div className="manager-fin-kpi-card">
          <small>RECEIVED THIS MONTH</small>
          <b>£13,860</b>
          <span>75% of invoiced value</span>
        </div>
        <div className="manager-fin-kpi-card">
          <small>OUTSTANDING</small>
          <b>£2,665</b>
          <span>4 invoices awaiting payment</span>
        </div>
        <div className="manager-fin-kpi-card alert">
          <small>OVERDUE</small>
          <b>£1,250</b>
          <span>2 client balances need follow-up</span>
        </div>
      </div>

      {/* 2-Column: Cash Flow Chart + Collections */}
      <div className="manager-fin-grid">
        {/* Cash Flow Panel */}
        <div className="manager-fin-card">
          <div className="manager-fin-card-head">
            <div>
              <small>CASH FLOW · OCTOBER 2026</small>
              <h2>Invoices and receipts</h2>
            </div>
            <div className="cashflow-legend">
              <div className="cashflow-legend-item">
                <span className="cashflow-legend-dot billed" />
                <span>Invoiced</span>
              </div>
              <div className="cashflow-legend-item">
                <span className="cashflow-legend-dot received" />
                <span>Received</span>
              </div>
            </div>
          </div>

          <div className="cashflow-chart">
            <div className="cashflow-y-axis">
              <span>£6k</span>
              <span>£4k</span>
              <span>£2k</span>
              <span>£0</span>
            </div>
            <div className="cashflow-bars-grid">
              {[
                { week: "1–4 Oct", billed: 72, received: 48 },
                { week: "5–11 Oct", billed: 88, received: 62 },
                { week: "12–18 Oct", billed: 62, received: 55 },
                { week: "19–25 Oct", billed: 53, received: 41 },
                { week: "26–31 Oct", billed: 38, received: 30 }
              ].map((w) => (
                <div key={w.week} className="cashflow-col">
                  <div className="cashflow-bars-pair">
                    <div className="cashflow-bar billed" style={{ height: `${w.billed}%` }} />
                    <div className="cashflow-bar received" style={{ height: `${w.received}%` }} />
                  </div>
                  <small>{w.week}</small>
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#64748b", borderTop: "1px solid #f1f5f9", paddingTop: 10 }}>
            <span>Sample totals · illustrative only</span>
            <strong style={{ color: "#0f172a" }}>£18,420 invoiced</strong>
          </div>
        </div>

        {/* Collections Panel */}
        <div className="manager-fin-card">
          <div className="manager-fin-card-head">
            <div>
              <small>COLLECTIONS</small>
              <h2>Next actions</h2>
            </div>
            <span style={{ background: "#fee2e2", color: "#991b1b", padding: "2px 8px", borderRadius: 9999, fontSize: 11, fontWeight: 700 }}>
              3 items
            </span>
          </div>

          <div className="collection-list">
            <div className="collection-item overdue">
              <div className="collection-info">
                <strong>CS-24076 · Morgan Lewis</strong>
                <small>Building survey · 14 days overdue</small>
              </div>
              <span className="collection-amount">£850</span>
            </div>
            <div className="collection-item overdue">
              <div className="collection-info">
                <strong>CS-24078 · Olivia Reed</strong>
                <small>Level 2 survey · 6 days overdue</small>
              </div>
              <span className="collection-amount">£400</span>
            </div>
            <div className="collection-item due">
              <div className="collection-info">
                <strong>CS-24084 · Priya Patel</strong>
                <small>Residential valuation · due 12 Oct</small>
              </div>
              <span className="collection-amount">£620</span>
            </div>
          </div>

          <div className="fin-assist-box">
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <Bot size={20} color="#2563eb" />
              <div className="fin-assist-text">
                <strong>SurvAI finance brief</strong>
                <small>Two sample invoices are overdue. Review linked case records before reminders.</small>
              </div>
            </div>
            <button
              className="manager-btn-secondary"
              style={{ fontSize: 11, padding: "4px 10px" }}
              onClick={() => showNotice("SurvAI: Draft reminder prepared for Morgan Lewis.")}
            >
              Review
            </button>
          </div>
        </div>
      </div>

      {/* Invoice Ledger Panel */}
      <div className="manager-invoice-panel">
        <div className="manager-invoice-top">
          <div>
            <h2>Invoices</h2>
            <small style={{ color: "#64748b", fontSize: 12 }}>Client &amp; Job fee ledger</small>
          </div>
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <div className="manager-search-box" style={{ maxWidth: 280 }}>
              <Search size={15} color="#94a3b8" />
              <input
                type="text"
                placeholder="Search client, job or invoice"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              {[
                { id: "all", label: "All" },
                { id: "outstanding", label: "Outstanding" },
                { id: "overdue", label: "Overdue" },
                { id: "paid", label: "Paid" }
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  className={`manager-jobs-filter-btn ${filter === tab.id ? "active" : ""}`}
                  style={{ padding: "6px 12px", fontSize: 12 }}
                  onClick={() => setFilter(tab.id)}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="invoice-table-wrap">
          <table className="invoice-table">
            <thead>
              <tr>
                <th>INVOICE / JOB</th>
                <th>CLIENT</th>
                <th>ISSUED</th>
                <th>DUE DATE</th>
                <th>AMOUNT</th>
                <th>STATUS</th>
                <th>ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {filteredInvoices.map((inv) => (
                <tr key={inv.id}>
                  <td>
                    <strong style={{ color: "#2563eb", fontFamily: "monospace" }}>{inv.invoiceNumber}</strong>
                    <Link href={`/app/${slug}/jobs`} style={{ fontSize: 12, color: "#64748b", display: "block", textDecoration: "none" }}>{inv.jobReference}</Link>
                  </td>
                  <td>
                    <strong style={{ color: "#0f172a" }}>{inv.client}</strong>
                  </td>
                  <td>{inv.issued}</td>
                  <td>{inv.due}</td>
                  <td>
                    <strong style={{ color: "#0f172a", fontSize: 14 }}>
                      £{inv.amount.toLocaleString()}
                    </strong>
                  </td>
                  <td>
                    <span className={`invoice-status-chip ${inv.tone}`}>
                      {inv.status}
                    </span>
                  </td>
                  <td>
                    <button
                      className="manager-btn-secondary"
                      style={{ padding: "4px 10px", fontSize: 12 }}
                      onClick={() => showNotice(`Viewing invoice ${inv.invoiceNumber}.`)}
                    >
                      <Eye size={12} /> View
                    </button>
                  </td>
                </tr>
              ))}
              {filteredInvoices.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ textAlign: "center", padding: "32px", color: "#64748b" }}>
                    No invoices match your filter or search.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create Invoice Modal */}
      {showCreateModal && (
        <div className="manager-modal-overlay">
          <div className="manager-modal">
            <div className="manager-modal-header">
              <h3>Create new invoice</h3>
              <button
                className="manager-modal-close"
                onClick={() => setShowCreateModal(false)}
              >
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleCreateSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div className="manager-form-field">
                <label>Client name</label>
                <input name="client" required placeholder="e.g. James Bell" />
              </div>
              <div className="manager-form-field">
                <label>Job reference</label>
                <input name="job" required placeholder="e.g. CS-24102" />
              </div>
              <div className="manager-form-field">
                <label>Fee amount (£)</label>
                <input name="amount" type="number" required placeholder="850" />
              </div>
              <div className="manager-modal-actions">
                <button
                  type="button"
                  className="manager-btn-secondary"
                  onClick={() => setShowCreateModal(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="manager-btn-primary">
                  Save invoice
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
