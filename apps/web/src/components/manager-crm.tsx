"use client";

import { useState } from "react";
import Link from "@/components/workspace-link";
import {
  Search,
  Plus,
  Mail,
  Phone,
  ChevronRight,
  X
} from "lucide-react";
import "./manager-crm.css";

interface ClientItem {
  id: string;
  name: string;
  initials: string;
  email: string;
  phone: string;
  address: string;
  jobs: string[];
  jobType: string;
  activity: string;
  status: "active" | "followup" | "enquiry" | "complete" | "booked";
  statusLabel: string;
}

const initialClients: ClientItem[] = [
  {
    id: "cli_1",
    name: "Alex Harper",
    initials: "AH",
    email: "alex.harper@example.test",
    phone: "020 7946 0142",
    address: "14 Elmwood Road · Chiswick W4 3AA",
    jobs: ["CS-24081"],
    jobType: "RICS Level 2 Home Survey",
    activity: "Documents received · 11:06 today",
    status: "active",
    statusLabel: "Active case"
  },
  {
    id: "cli_2",
    name: "Priya Patel",
    initials: "PP",
    email: "priya.patel@example.test",
    phone: "020 7946 0178",
    address: "8 The Grove · Ealing W5 2AB",
    jobs: ["CS-24084"],
    jobType: "Residential Valuation",
    activity: "Access confirmation due today",
    status: "followup",
    statusLabel: "Follow-up due"
  },
  {
    id: "cli_3",
    name: "Morgan Lewis",
    initials: "ML",
    email: "morgan.lewis@example.test",
    phone: "020 7946 0191",
    address: "22 Birch Avenue · Acton W3 7QJ",
    jobs: ["CS-24076"],
    jobType: "Level 3 Building Survey",
    activity: "Report review · due today",
    status: "active",
    statusLabel: "Active case"
  },
  {
    id: "cli_4",
    name: "Samira Khan",
    initials: "SK",
    email: "samira.khan@example.test",
    phone: "020 7946 0129",
    address: "Roof access call · London W4",
    jobs: ["CS-24089"],
    jobType: "Roof & Chimney Follow-up",
    activity: "Follow-up call · 16:15 today",
    status: "followup",
    statusLabel: "Follow-up due"
  },
  {
    id: "cli_5",
    name: "Jamie Morgan",
    initials: "JM",
    email: "jamie.morgan@example.test",
    phone: "020 7946 0134",
    address: "6 Linden Gardens · Hammersmith W6 0PH",
    jobs: ["CS-24091"],
    jobType: "RICS Level 2 Home Survey",
    activity: "Survey booked · tomorrow 09:30",
    status: "booked",
    statusLabel: "Booked"
  },
  {
    id: "cli_6",
    name: "Taylor Bennett",
    initials: "TB",
    email: "taylor.bennett@example.test",
    phone: "020 7946 0165",
    address: "31 St Mary’s Road · Ealing W5 5RA",
    jobs: ["CS-24094"],
    jobType: "Drone Roof Inspection",
    activity: "Drone visit booked · tomorrow 12:00",
    status: "booked",
    statusLabel: "Booked"
  },
  {
    id: "cli_7",
    name: "Nadia Wilson",
    initials: "NW",
    email: "nadia.wilson@example.test",
    phone: "020 7946 0118",
    address: "4 Oakfield Close · Richmond TW9 2AB",
    jobs: ["CS-24096"],
    jobType: "Residential Valuation",
    activity: "Valuation booked · tomorrow 15:00",
    status: "enquiry",
    statusLabel: "New enquiry"
  },
  {
    id: "cli_8",
    name: "Olivia Reed",
    initials: "OR",
    email: "olivia.reed@example.test",
    phone: "020 7946 0186",
    address: "17 Willow Lane · Brentford TW8 0AA",
    jobs: ["CS-24078"],
    jobType: "Level 2 Home Survey",
    activity: "Report issued · 7 October",
    status: "complete",
    statusLabel: "Complete"
  }
];

export function ManagerCrm({ slug }: { slug: string }) {
  const [clients, setClients] = useState<ClientItem[]>(initialClients);
  const [selectedClient, setSelectedClient] = useState<ClientItem>(initialClients[0]);
  const [filter, setFilter] = useState<string>("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [showAddModal, setShowAddModal] = useState(false);
  const [toastMessage, setToastMessage] = useState("");

  const filteredClients = clients.filter((c) => {
    const matchesFilter =
      filter === "all" ||
      (filter === "enquiry" && c.status === "enquiry") ||
      (filter === "active" && (c.status === "active" || c.status === "booked")) ||
      (filter === "followup" && c.status === "followup");
    const matchesSearch =
      c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.address.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.jobs.some((j) => j.toLowerCase().includes(searchTerm.toLowerCase()));
    return matchesFilter && matchesSearch;
  });

  const showNotice = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(""), 3500);
  };

  const handleAddSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const name = fd.get("name") as string;
    const email = fd.get("email") as string;
    const phone = fd.get("phone") as string;
    const address = fd.get("address") as string;
    const jobType = fd.get("service") as string;

    const newClient: ClientItem = {
      id: "cli_" + Date.now(),
      name,
      initials: name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase(),
      email,
      phone,
      address,
      jobs: ["CS-" + Math.floor(24100 + Math.random() * 900)],
      jobType,
      activity: "New enquiry registered just now",
      status: "enquiry",
      statusLabel: "New enquiry"
    };

    setClients((prev) => [newClient, ...prev]);
    setSelectedClient(newClient);
    setShowAddModal(false);
    showNotice(`Client ${name} registered in CRM suite.`);
  };

  return (
    <div className="manager-crm-container">
      {toastMessage && (
        <div style={{ background: "#ecfdf5", border: "1px solid #a7f3d0", color: "#065f46", padding: "12px 16px", borderRadius: 6, fontSize: 13 }}>
          <strong>Notice:</strong> {toastMessage}
        </div>
      )}

      {/* Header */}
      <div className="manager-crm-header">
        <div className="manager-crm-title-group">
          <span className="manager-crm-eyebrow">CLIENT RELATIONSHIPS · CRM SUITE</span>
          <h1>Know who’s behind every job.</h1>
          <p>Client contact, property and case history in one searchable place.</p>
        </div>
        <button
          className="manager-btn-primary"
          onClick={() => setShowAddModal(true)}
        >
          <Plus size={16} /> New client
        </button>
      </div>

      {/* 4 Summary Cards */}
      <div className="manager-crm-kpis">
        <div className="manager-crm-kpi-card">
          <small>ACTIVE CLIENTS</small>
          <b>38</b>
        </div>
        <div className="manager-crm-kpi-card">
          <small>NEW ENQUIRIES</small>
          <b>6</b>
        </div>
        <div className="manager-crm-kpi-card">
          <small>AWAITING INSTRUCTION</small>
          <b>4</b>
        </div>
        <div className="manager-crm-kpi-card">
          <small>FOLLOW-UPS DUE</small>
          <b style={{ color: "#d97706" }}>3</b>
        </div>
      </div>

      {/* Toolbar */}
      <div className="manager-crm-toolbar">
        <div className="manager-search-box">
          <Search size={16} color="#94a3b8" />
          <input
            type="text"
            placeholder="Search clients, addresses or case references"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <div className="manager-crm-filters">
          {[
            { id: "all", label: "All relationships" },
            { id: "enquiry", label: "Enquiries" },
            { id: "active", label: "Active jobs" },
            { id: "followup", label: "Follow-up due" }
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`manager-crm-filter-btn ${filter === tab.id ? "active" : ""}`}
              onClick={() => setFilter(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* 2-Column Layout */}
      <div className="manager-crm-layout">
        {/* Left Column: Client List */}
        <div className="manager-crm-list-panel">
          <div className="manager-crm-list-header">
            <span>CLIENT &amp; CONTACT</span>
            <span>LINKED CASE</span>
            <span>STATUS</span>
            <span></span>
          </div>
          <div>
            {filteredClients.map((client) => (
              <button
                key={client.id}
                type="button"
                className={`manager-crm-row ${selectedClient.id === client.id ? "selected" : ""}`}
                onClick={() => setSelectedClient(client)}
              >
                <div className="crm-client-cell">
                  <div className="crm-avatar">{client.initials}</div>
                  <div className="crm-client-info">
                    <strong>{client.name}</strong>
                    <small>{client.email}</small>
                  </div>
                </div>
                <div className="crm-job-info">
                  <strong>{client.jobs[0]}</strong>
                  <small>{client.address}</small>
                </div>
                <div>
                  <span className={`crm-badge ${client.status}`}>
                    {client.statusLabel}
                  </span>
                </div>
                <div>
                  <ChevronRight size={16} color="#94a3b8" />
                </div>
              </button>
            ))}
            {filteredClients.length === 0 && (
              <div style={{ textAlign: "center", padding: "32px", color: "#64748b" }}>
                No clients found matching your search.
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Record Detail */}
        <div className="manager-crm-detail-panel">
          <div className="crm-detail-top">
            <div className="crm-detail-avatar">{selectedClient.initials}</div>
            <div className="crm-detail-title">
              <small>CLIENT RECORD</small>
              <h2>{selectedClient.name}</h2>
            </div>
          </div>

          <p style={{ margin: 0, fontSize: 13.5, color: "#475569" }}>
            {selectedClient.address}
          </p>

          <div className="crm-contact-grid">
            <a href={`mailto:${selectedClient.email}`}>
              <Mail size={15} /> {selectedClient.email}
            </a>
            <a href={`tel:${selectedClient.phone}`}>
              <Phone size={15} /> {selectedClient.phone}
            </a>
          </div>

          <div className="crm-linked-job-card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <small>LINKED PROPERTY &amp; JOB · {selectedClient.jobs[0]}</small>
              <span className={`crm-badge ${selectedClient.status}`}>
                {selectedClient.statusLabel}
              </span>
            </div>
            <strong>{selectedClient.jobType}</strong>
            <span>{selectedClient.address}</span>
            <Link
              href={`/app/${slug}/jobs`}
              className="manager-btn-secondary"
              style={{ width: "fit-content", marginTop: 6 }}
            >
              Open job record &rarr;
            </Link>
          </div>

          <div>
            <span style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: 10 }}>
              RECENT ACTIVITY
            </span>
            <div className="crm-activity-item">
              <div className="crm-activity-dot" />
              <div className="crm-activity-info">
                <strong>{selectedClient.activity}</strong>
                <small>Activity retained with client instruction</small>
              </div>
            </div>
          </div>

          <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 6, padding: "12px 14px", fontSize: 12, color: "#64748b" }}>
            <strong style={{ color: "#1e293b", display: "block", marginBottom: 4 }}>
              Case record boundary
            </strong>
            Contact details, appointments, property intelligence and survey evidence stay securely attached to this client instruction.
          </div>
        </div>
      </div>

      {/* Add Client Modal */}
      {showAddModal && (
        <div className="manager-modal-overlay">
          <div className="manager-modal">
            <div className="manager-modal-header">
              <h3>Create client instruction</h3>
              <button
                className="manager-modal-close"
                onClick={() => setShowAddModal(false)}
              >
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleAddSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div className="manager-form-field">
                <label>Client name</label>
                <input name="name" required placeholder="e.g. David & Sarah Jenkins" />
              </div>
              <div className="manager-form-field">
                <label>Email address</label>
                <input name="email" type="email" required placeholder="d.jenkins@example.test" />
              </div>
              <div className="manager-form-field">
                <label>Phone number</label>
                <input name="phone" required placeholder="020 7946 0882" />
              </div>
              <div className="manager-form-field">
                <label>Property address</label>
                <input name="address" required placeholder="e.g. 54 Church Road, Wimbledon SW19 5DQ" />
              </div>
              <div className="manager-form-field">
                <label>Service requested</label>
                <select name="service">
                  <option value="RICS Level 2 Home Survey">RICS Level 2 Home Survey</option>
                  <option value="Level 3 Building Survey">Level 3 Building Survey</option>
                  <option value="Residential Valuation">Residential Valuation</option>
                  <option value="Drone Roof Inspection">Drone Roof Inspection</option>
                </select>
              </div>
              <div className="manager-modal-actions">
                <button
                  type="button"
                  className="manager-btn-secondary"
                  onClick={() => setShowAddModal(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="manager-btn-primary">
                  Save client
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
