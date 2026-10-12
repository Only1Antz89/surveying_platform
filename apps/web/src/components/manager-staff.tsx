"use client";

import { useState } from "react";
import Link from "@/components/workspace-link";
import {
  Search,
  Plus,
  ArrowLeft,
  Check,
  MapPin,
  Mail,
  Phone,
  X,
  ExternalLink
} from "lucide-react";
import "./manager-staff.css";

interface SurveyorItem {
  id: string;
  name: string;
  initials: string;
  avatarColor: "blue" | "green" | "coral" | "purple" | "amber";
  role: string;
  base: string;
  state: string;
  stateTone: "green" | "blue" | "amber";
  services: string[];
  load: number;
  rics: string;
  membership: string;
  since: string;
  email: string;
  phone: string;
  radius: number;
  coverage: string;
}

const initialSurveyors: SurveyorItem[] = [
  {
    id: "sc",
    name: "Sophie Carter",
    initials: "SC",
    avatarColor: "blue",
    role: "RICS Level 2 surveyor",
    base: "Watford",
    state: "Available",
    stateTone: "green",
    services: ["Level 1 Home Survey", "Level 2 Home Survey", "Residential Valuation"],
    load: 2,
    rics: "0091842",
    membership: "AssocRICS",
    since: "2018",
    email: "sophie.carter@cliftonsurveyors.example",
    phone: "020 7946 0281",
    radius: 35,
    coverage: "Watford, St Albans, Hemel Hempstead and North West London"
  },
  {
    id: "al",
    name: "Amit Lal",
    initials: "AL",
    avatarColor: "green",
    role: "Building surveyor",
    base: "North London",
    state: "On site · N14",
    stateTone: "blue",
    services: ["Level 1 Home Survey", "Level 2 Home Survey", "Level 3 Building Survey"],
    load: 3,
    rics: "0102756",
    membership: "MRICS",
    since: "2015",
    email: "amit.lal@cliftonsurveyors.example",
    phone: "020 7946 0282",
    radius: 24,
    coverage: "North London, Enfield, Barnet and Finchley"
  },
  {
    id: "mk",
    name: "Marcus Keane",
    initials: "MK",
    avatarColor: "coral",
    role: "Chartered surveyor · Drone certified",
    base: "Croydon",
    state: "Traffic risk · A23",
    stateTone: "amber",
    services: ["Level 2 Home Survey", "Level 3 Building Survey", "Drone Roof Survey", "Land & Planning Review"],
    load: 4,
    rics: "0116394",
    membership: "MRICS",
    since: "2012",
    email: "marcus.keane@cliftonsurveyors.example",
    phone: "020 7946 0283",
    radius: 38,
    coverage: "Croydon, Bromley, Sutton and South London"
  },
  {
    id: "so",
    name: "Stephen Osei",
    initials: "SO",
    avatarColor: "purple",
    role: "Chartered surveyor",
    base: "Watford",
    state: "On site · St Albans",
    stateTone: "blue",
    services: ["Level 1 Home Survey", "Level 2 Home Survey", "Level 3 Building Survey", "Residential Valuation"],
    load: 4,
    rics: "0084127",
    membership: "MRICS",
    since: "2011",
    email: "stephen.osei@cliftonsurveyors.example",
    phone: "020 7946 0284",
    radius: 35,
    coverage: "Watford, St Albans, Harrow and West London"
  },
  {
    id: "mc",
    name: "Maya Chen",
    initials: "MC",
    avatarColor: "blue",
    role: "Building surveyor",
    base: "North London",
    state: "On site · N14",
    stateTone: "blue",
    services: ["Level 1 Home Survey", "Level 2 Home Survey", "Residential Valuation"],
    load: 2,
    rics: "0120841",
    membership: "AssocRICS",
    since: "2020",
    email: "maya.chen@cliftonsurveyors.example",
    phone: "020 7946 0285",
    radius: 22,
    coverage: "North London, Enfield and Haringey"
  },
  {
    id: "do",
    name: "Daniel Okafor",
    initials: "DO",
    avatarColor: "amber",
    role: "Chartered surveyor · Drone certified",
    base: "Croydon",
    state: "On site · Croydon",
    stateTone: "blue",
    services: ["Level 2 Home Survey", "Level 3 Building Survey", "Drone Roof Survey", "Land & Planning Review"],
    load: 1,
    rics: "0097350",
    membership: "MRICS",
    since: "2017",
    email: "daniel.okafor@cliftonsurveyors.example",
    phone: "020 7946 0286",
    radius: 40,
    coverage: "Croydon, Bromley, Kingston and South London"
  },
  {
    id: "ns",
    name: "Niamh Shah",
    initials: "NS",
    avatarColor: "green",
    role: "Valuation surveyor",
    base: "Watford",
    state: "On site · WD17",
    stateTone: "blue",
    services: ["Level 1 Home Survey", "Level 2 Home Survey", "Residential Valuation"],
    load: 2,
    rics: "0131108",
    membership: "AssocRICS",
    since: "2021",
    email: "niamh.shah@cliftonsurveyors.example",
    phone: "020 7946 0287",
    radius: 30,
    coverage: "Watford, St Albans and North West London"
  },
  {
    id: "mco",
    name: "Marcus Cole",
    initials: "MC",
    avatarColor: "coral",
    role: "Land & building surveyor",
    base: "North London",
    state: "In inspection · N14",
    stateTone: "amber",
    services: ["Level 3 Building Survey", "Drone Roof Survey", "Land & Planning Review"],
    load: 3,
    rics: "0108420",
    membership: "MRICS",
    since: "2016",
    email: "marcus.cole@cliftonsurveyors.example",
    phone: "020 7946 0288",
    radius: 28,
    coverage: "North London, Enfield and East Hertfordshire"
  }
];

export function ManagerStaff({ slug }: { slug: string }) {
  const [surveyors, setSurveyors] = useState<SurveyorItem[]>(initialSurveyors);
  const [selectedProfile, setSelectedProfile] = useState<SurveyorItem | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [locationFilter, setLocationFilter] = useState("all");
  const [showAddModal, setShowAddModal] = useState(false);
  const [toastMessage, setToastMessage] = useState("");

  const locations = ["all", "Watford", "North London", "Croydon"];

  const filteredSurveyors = surveyors.filter((person) => {
    const matchesSearch =
      person.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      person.role.toLowerCase().includes(searchTerm.toLowerCase()) ||
      person.services.some((s) => s.toLowerCase().includes(searchTerm.toLowerCase()));
    const matchesLocation = locationFilter === "all" || person.base === locationFilter;
    return matchesSearch && matchesLocation;
  });

  const handleBaseChange = (id: string, newBase: string) => {
    setSurveyors((prev) =>
      prev.map((person) => (person.id === id ? { ...person, base: newBase } : person))
    );
    showNotice(`Operating base updated to ${newBase}`);
  };

  const showNotice = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(""), 3500);
  };

  const handleAddSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const name = fd.get("name") as string;
    const role = fd.get("role") as string;
    const base = fd.get("base") as string;
    const email = fd.get("email") as string;

    const idNum = surveyors.length + 1;
    const newPerson: SurveyorItem = {
      id: `mem_${name.toLowerCase().replace(/[^a-z0-9]/g, "_")}_${idNum}`,
      name,
      initials: name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase(),
      avatarColor: "blue",
      role,
      base,
      state: "Available",
      stateTone: "green",
      services: ["Level 1 Home Survey", "Level 2 Home Survey"],
      load: 0,
      rics: `01${84000 + idNum}`,
      membership: "MRICS",
      since: "2024",
      email,
      phone: `020 7946 0${280 + idNum}`,
      radius: 30,
      coverage: `${base} and surrounding districts`
    };

    setSurveyors((prev) => [newPerson, ...prev]);
    setShowAddModal(false);
    showNotice(`${name} added to practice team.`);
  };

  if (selectedProfile) {
    return (
      <div className="manager-staff-container">
        {toastMessage && (
          <div className="manager-note-row" style={{ background: "#ecfdf5", borderColor: "#a7f3d0", color: "#065f46" }}>
            <strong>Notice:</strong> {toastMessage}
          </div>
        )}

        <div className="staff-profile-view">
          <div className="staff-back-nav">
            <button
              type="button"
              className="staff-back-btn"
              onClick={() => setSelectedProfile(null)}
            >
              <ArrowLeft size={14} /> Back to all surveyors
            </button>
            <span>WORKSPACE &rsaquo; SURVEYORS &rsaquo; {selectedProfile.name.toUpperCase()}</span>
          </div>

          <div className="manager-staff-header">
            <div className="manager-staff-title-group">
              <span className="manager-staff-eyebrow">SURVEYOR PROFILE · SAMPLE RECORD</span>
              <h1>Know who’s cleared for the work.</h1>
              <p>Qualifications, service capability and operating coverage in one surveyor record.</p>
            </div>
            <button
              className="manager-btn-secondary"
              onClick={() => showNotice("Surveyor record actions are illustrative in this demo.")}
            >
              More actions ⌄
            </button>
          </div>

          <div className="staff-profile-layout">
            <div className="staff-profile-main">
              {/* Identity Card */}
              <div className="staff-profile-card staff-hero-card">
                <div className="staff-hero-left">
                  <div className={`staff-hero-avatar ${selectedProfile.avatarColor}`}>
                    {selectedProfile.initials}
                    <div className="staff-online-badge" />
                  </div>
                  <div className="staff-hero-text">
                    <span className="manager-staff-eyebrow">
                      CLIFTON SURVEYORS · {selectedProfile.base.toUpperCase()}
                    </span>
                    <h2>{selectedProfile.name}</h2>
                    <p>{selectedProfile.role}</p>
                    <span className={`staff-status-badge ${selectedProfile.stateTone}`}>
                      <span className="staff-status-dot" />
                      {selectedProfile.state}
                    </span>
                  </div>
                </div>
                <button
                  className="manager-btn-primary"
                  onClick={() => showNotice(`Message sent to ${selectedProfile.name}.`)}
                >
                  <Mail size={15} /> Message surveyor
                </button>
              </div>

              {/* RICS Membership */}
              <div className="staff-profile-card">
                <div className="staff-profile-panel-head">
                  <div>
                    <small>PROFESSIONAL REGISTRATION</small>
                    <h3>RICS membership</h3>
                  </div>
                  <span className="staff-qual-chip">VERIFIED RECORD</span>
                </div>
                <div className="staff-credential-grid">
                  <div className="staff-credential-item">
                    <small>RICS NUMBER</small>
                    <strong>{selectedProfile.rics}</strong>
                    <span>Verified registration</span>
                  </div>
                  <div className="staff-credential-item">
                    <small>MEMBERSHIP CLASS</small>
                    <strong>{selectedProfile.membership}</strong>
                    <span>Joined {selectedProfile.since}</span>
                  </div>
                  <div className="staff-credential-item">
                    <small>REGISTER CHECK</small>
                    <strong>✓ Verified for demo</strong>
                    <span>Standard compliance check</span>
                  </div>
                </div>
              </div>

              {/* Service Capability */}
              <div className="staff-profile-card">
                <div className="staff-profile-panel-head">
                  <div>
                    <small>SERVICE CAPABILITY</small>
                    <h3>Services this surveyor can carry out</h3>
                  </div>
                  <span className="staff-qual-chip">{selectedProfile.services.length} services qualified</span>
                </div>
                <div className="staff-service-list">
                  {selectedProfile.services.map((svc) => (
                    <div className="staff-service-item" key={svc}>
                      <Check size={16} className="staff-service-check" />
                      <div>
                        <strong>{svc}</strong>
                        <small>
                          {svc.includes("Level 3")
                            ? "Detailed building structural inspection & diagnostic reporting"
                            : svc.includes("Drone")
                            ? "Certified CAA aerial roof capture and defect inspection"
                            : svc.includes("Valuation")
                            ? "Red Book residential valuation and market assessment"
                            : "Standard condition survey and defect risk overview"}
                        </small>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Operating Area & Map */}
              <div className="staff-profile-card">
                <div className="staff-profile-panel-head">
                  <div>
                    <small>OPERATING AREA</small>
                    <h3>Location coverage</h3>
                    <p>Primary base and approximate travel radius for new assignments.</p>
                  </div>
                  <span className="staff-qual-chip">{selectedProfile.radius} mile radius</span>
                </div>

                <div className="staff-map-preview">
                  <svg viewBox="0 0 500 240" className="staff-map-svg">
                    <defs>
                      <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
                        <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#cbd5e1" strokeWidth="0.75" />
                      </pattern>
                    </defs>
                    <rect width="500" height="240" fill="#f1f5f9" />
                    <rect width="500" height="240" fill="url(#grid)" />

                    {/* Coverage Radius circle */}
                    <circle
                      cx="250"
                      cy="120"
                      r={selectedProfile.radius * 2.2}
                      fill="#3b82f6"
                      fillOpacity="0.12"
                      stroke="#2563eb"
                      strokeWidth="2"
                      strokeDasharray="4 3"
                    />

                    {/* Center Base marker */}
                    <circle cx="250" cy="120" r="14" fill="#2563eb" stroke="#ffffff" strokeWidth="3" />
                    <text x="250" y="124" fill="#ffffff" fontSize="10" fontWeight="bold" textAnchor="middle">
                      {selectedProfile.initials}
                    </text>

                    {/* Base label */}
                    <rect x="200" y="142" width="100" height="22" rx="4" fill="#1e3a8a" />
                    <text x="250" y="157" fill="#ffffff" fontSize="10" fontWeight="bold" textAnchor="middle">
                      {selectedProfile.base} ({selectedProfile.radius} mi)
                    </text>
                  </svg>
                </div>

                <div className="manager-note-row" style={{ background: "#f8fafc", borderColor: "#e2e8f0", color: "#475569" }}>
                  <div>
                    <strong style={{ color: "#1e293b" }}>{selectedProfile.base}:</strong> {selectedProfile.coverage}
                  </div>
                </div>
              </div>
            </div>

            {/* Side column */}
            <div className="staff-profile-side">
              <div className="staff-profile-card">
                <span className="manager-staff-eyebrow">CONTACT</span>
                <div className="staff-side-item">
                  <div className="staff-side-icon"><Mail size={16} /></div>
                  <div className="staff-side-info">
                    <strong>Email</strong>
                    <a href={`mailto:${selectedProfile.email}`} style={{ color: "#2563eb" }}>{selectedProfile.email}</a>
                  </div>
                </div>
                <div className="staff-side-item">
                  <div className="staff-side-icon"><Phone size={16} /></div>
                  <div className="staff-side-info">
                    <strong>Phone</strong>
                    <span>{selectedProfile.phone}</span>
                  </div>
                </div>
              </div>

              <div className="staff-profile-card">
                <span className="manager-staff-eyebrow">TODAY’S CAPACITY</span>
                <div style={{ margin: "10px 0" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                    <span style={{ fontSize: 22, fontWeight: 700, color: "#0f172a" }}>
                      {selectedProfile.load} <small style={{ fontSize: 13, color: "#64748b" }}>/ 5 jobs</small>
                    </span>
                    <span style={{ fontSize: 12, color: "#64748b" }}>
                      {selectedProfile.load >= 4 ? "Near capacity" : "Available"}
                    </span>
                  </div>
                  <div className="staff-load-track" style={{ height: 8 }}>
                    <div
                      className="staff-load-fill"
                      style={{ width: `${selectedProfile.load * 20}%` }}
                    />
                  </div>
                </div>
                <small style={{ color: "#64748b", fontSize: 12, lineHeight: 1.4 }}>
                  Allocation algorithms respect daily cap and travel buffers.
                </small>
              </div>

              <div className="staff-profile-card">
                <span className="manager-staff-eyebrow">OPERATING HUB</span>
                <div className="staff-side-item">
                  <div className="staff-side-icon"><MapPin size={16} /></div>
                  <div className="staff-side-info">
                    <strong>{selectedProfile.base} Office</strong>
                    <span>Primary dispatch location</span>
                  </div>
                </div>
                <Link
                  href={`/app/${slug}/locations`}
                  className="manager-btn-secondary"
                  style={{ width: "100%", justifyContent: "center", marginTop: 10 }}
                >
                  View team coverage &rarr;
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="manager-staff-container">
      {toastMessage && (
        <div className="manager-note-row" style={{ background: "#ecfdf5", borderColor: "#a7f3d0", color: "#065f46" }}>
          <strong>Notice:</strong> {toastMessage}
        </div>
      )}

      {/* Main Header */}
      <div className="manager-staff-header">
        <div className="manager-staff-title-group">
          <span className="manager-staff-eyebrow">SURVEYORS &amp; COVERAGE</span>
          <h1>Put the right people near the work.</h1>
          <p>
            Skills, availability and primary operating base determine who can receive a job. Select a name to open their surveyor profile.
          </p>
        </div>
        <button
          className="manager-btn-primary"
          onClick={() => setShowAddModal(true)}
        >
          <Plus size={16} /> Add surveyor
        </button>
      </div>

      {/* Filter / Search Toolbar */}
      <div className="manager-staff-toolbar">
        <div className="manager-search-box">
          <Search size={16} color="#94a3b8" />
          <input
            type="text"
            placeholder="Search by surveyor name, role or skill"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <div className="manager-filter-pills">
          {locations.map((loc) => (
            <button
              key={loc}
              type="button"
              className={`manager-filter-pill ${locationFilter === loc ? "active" : ""}`}
              onClick={() => setLocationFilter(loc)}
            >
              {loc === "all" ? "All locations" : loc}
            </button>
          ))}
        </div>
      </div>

      {/* Staff Table */}
      <div className="manager-staff-panel">
        <div className="manager-staff-table-wrap">
          <table className="manager-staff-table">
            <thead>
              <tr>
                <th>SURVEYOR</th>
                <th>QUALIFICATIONS</th>
                <th>PRIMARY BASE</th>
                <th>TODAY</th>
                <th>WORKLOAD</th>
              </tr>
            </thead>
            <tbody>
              {filteredSurveyors.map((person) => (
                <tr key={person.id}>
                  <td>
                    <div className="staff-person-cell">
                      <div className={`staff-avatar-circle ${person.avatarColor}`}>
                        {person.initials}
                      </div>
                      <div className="staff-person-info">
                        <button
                          type="button"
                          className="staff-name-btn"
                          onClick={() => setSelectedProfile(person)}
                        >
                          {person.name}
                          <ExternalLink size={12} />
                        </button>
                        <span className="staff-role-label">{person.role}</span>
                      </div>
                    </div>
                  </td>
                  <td>
                    <div className="staff-qual-chips">
                      {person.services.slice(0, 3).map((s) => (
                        <span className="staff-qual-chip" key={s}>
                          {s.replace(" Home Survey", "").replace("Residential ", "")}
                        </span>
                      ))}
                      {person.services.length > 3 && (
                        <span className="staff-qual-chip">+{person.services.length - 3}</span>
                      )}
                    </div>
                  </td>
                  <td>
                    <select
                      className="staff-base-select"
                      value={person.base}
                      onChange={(e) => handleBaseChange(person.id, e.target.value)}
                    >
                      <option value="Watford">Watford</option>
                      <option value="North London">North London</option>
                      <option value="Croydon">Croydon</option>
                    </select>
                  </td>
                  <td>
                    <span className={`staff-status-badge ${person.stateTone}`}>
                      <span className="staff-status-dot" />
                      {person.state}
                    </span>
                  </td>
                  <td>
                    <div className="staff-load-group">
                      <span className="staff-load-text">{person.load} jobs</span>
                      <div className="staff-load-track">
                        <div
                          className="staff-load-fill"
                          style={{ width: `${person.load * 20}%` }}
                        />
                      </div>
                    </div>
                  </td>
                </tr>
              ))}
              {filteredSurveyors.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ textAlign: "center", padding: "32px", color: "#64748b" }}>
                    No surveyors found matching your search.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Coverage Check Row */}
      <div className="manager-note-row">
        <div>
          <strong>Coverage check:</strong> Drone Roof Survey currently has one certified surveyor available across all locations.
        </div>
        <Link href={`/app/${slug}/locations`}>
          Review coverage &rarr;
        </Link>
      </div>

      {/* Add Surveyor Modal */}
      {showAddModal && (
        <div className="manager-modal-overlay">
          <div className="manager-modal">
            <div className="manager-modal-header">
              <h3>Add surveyor</h3>
              <button
                className="manager-modal-close"
                onClick={() => setShowAddModal(false)}
              >
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleAddSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div className="manager-form-field">
                <label>Full name</label>
                <input name="name" required placeholder="e.g. Thomas Wright" />
              </div>
              <div className="manager-form-field">
                <label>Professional role</label>
                <input name="role" required placeholder="e.g. Chartered Building Surveyor" />
              </div>
              <div className="manager-form-field">
                <label>Primary operating base</label>
                <select name="base">
                  <option value="Watford">Watford</option>
                  <option value="North London">North London</option>
                  <option value="Croydon">Croydon</option>
                </select>
              </div>
              <div className="manager-form-field">
                <label>Email address</label>
                <input name="email" type="email" required placeholder="thomas@cliftonsurveyors.example" />
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
                  Save surveyor
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
