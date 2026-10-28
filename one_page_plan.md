# Verity for Dietitians (Verity-RD)
## One-Page Product & Engineering Plan
**Project:** Clinical Handout Governance & Patient Delivery Safeguard System  
**Pattern Lineage:** Verity-pattern prototype (adapted from `ngupta1137/verity`)  
**Role:** Principal Product Engineer  
**Status:** In-Progress / Baseline Execution  

---

### 1. Executive Summary & Objective
Registered Dietitian (RD) owners of multi-clinician practices (3–10 dietitians + front desk) face clinical liability, patient safety hazards, and compliance risks when staff distribute outdated, mismatched, or unapproved handouts. 

**Objective:** Build a demo-ready, browser-accessible prototype that adapts Verity’s core thesis—*"One approved truth, in every channel"*—to clinical document distribution. The system eliminates wrong-document delivery through deterministic pre-send verification, plain-language patient-context matching with section-level citations, automated conflict/staleness detection, and a verifiable audit trail for practice owners.

---

### 2. Users & Core Pain Points

| Persona | Role & Context | Core Pain Point | System Solution |
| :--- | :--- | :--- | :--- |
| **Dr. Sarah Jenkins, MS, RDN, LDN** | Practice Owner & Clinical Director (4 locations + telehealth) | Cannot see what materials team members hand out; dreads patients receiving outdated clinical advice or expired protocols. | **Owner Governance Dashboard:** Real-time visibility into sent materials, blocked sends, review queues, and conflict alerts. |
| **Elena Gomez, RD** | Staff Dietitian (seeing 7–10 patients/day across Bariatrics & Diabetes) | Rushed between visits; searches through messy shared Google Drive folders or desktop downloads; risks giving Stage 1 post-op handout to a Stage 2 patient. | **Right-Document Finder & Pre-Send Check:** Plain-language context search ("post-op bariatric week 2 lactose intolerant") that returns verified approved docs with exact section citations and blocks stage mismatches. |
| **Marcus Vance** | Front Desk / Patient Care Coordinator | Hands out intake packets and basic program guides; lacks clinical judgment to verify if a handout has been superseded or retired. | **Automated Pre-Send Gatekeeper:** Hard block on drafts, retired protocols, or superseded versions; clear green/red status before printing or emailing. |

---

### 3. Decisions & Trade-Offs

1. **Deterministic Pre-Send Gates vs. LLM-Only Recommendations:**
   - *Decision:* Pre-send verification is **100% deterministic** (code rules: document status == `approved`, version == latest, `review_date >= today`, strict stage/condition compatibility). The LLM is NEVER allowed to bypass a safety gate.
   - *Rationale:* Clinical compliance requires zero hallucination. If a document is retired or expired, the send is blocked immediately with a verifiable rule string.

2. **Hybrid Search (Deterministic Clinical Metadata + Semantic Text Match):**
   - *Decision:* Two-stage retrieval. Stage 1 filters by role entitlement and audience (patient vs. internal); Stage 2 scores clinical relevance using token overlap, synonym expansion, and section-level semantic matching.
   - *Rationale:* Out-of-scope or internal-only documents must never leak into patient-facing search results.

3. **Verbatim Text & Exact Section Provenance:**
   - *Decision:* In grounded Q&A and document discovery, every answer and recommendation cites the exact document ID, version number, section heading, and text snippet.
   - *Rationale:* Adheres to Verity principle: "Legal/clinical verbatim is NEVER generated." Clinicians must verify the primary source.

4. **Self-Contained Local Runtime with Zero API Key Blocker:**
   - *Decision:* Full-stack Node.js engine with zero external vector DB or cloud dependencies required for standard demo execution, plus an optional Gateway adapter for live LLM providers.
   - *Rationale:* Enables instant offline evaluation, deterministic replay of golden test sets, and zero setup friction for evaluators.

---

### 4. Options Considered

| Dimension | Option A (Discarded) | Option B (Discarded) | Option C (Selected - Verity Adaptation) |
| :--- | :--- | :--- | :--- |
| **Document Storage & Governance** | Generic Cloud Drive (Google Drive/Dropbox folders) | Heavy Enterprise EHR / DMS (SharePoint / Epic Willow) | **Verity Knowledge Unit & Document Registry**: Structured metadata (program, condition, stage, audience, status, review date) with lineage & diff engine. |
| **Matching Engine** | Pure Keyword Search (Ctrl+F) | Unbounded LLM RAG with vector DB alone | **Deterministic Policy + Context-Aware Ranked Search**: Hard gates for status & role + BM25/synonym matching + section citation extraction. |
| **Pre-Send Verification** | Human honor code / verbal policy | Post-hoc audit log scraping | **Synchronous Gatekeeper**: Blocks send action if expired, superseded, or mismatched; records telemetry to owner audit log. |

---

### 5. Recommendation
Deploy **Verity-RD** as a lightweight web application combining:
- **Clinical Document Library**: Metadata tagging, version lineage, draft/approval workflow, and side-by-side diffing.
- **Context-Aware Finder**: Clinician inputs patient facts; engine returns top approved document with match rationale and section citation.
- **Pre-Send Verification Gate**: Deterministic blocker catching traps (superseded, retired, expired, stage-mismatch).
- **Conflict & Staleness Detector**: Automated pair-wise semantic conflict detection and 30-day review horizon alerts.
- **Owner Dashboard & Audit Trail**: Full ledger of who sent what, blocked attempts, and document utilization.
- **Grounded Staff Q&A**: Strict citation-backed answers with guaranteed refusal on out-of-library topics.

---

### 6. Risks & Mitigations

| Risk | Impact | Mitigation Strategy |
| :--- | :--- | :--- |
| **Clinician Alarm Fatigue** | Staff ignore warnings or find workarounds | Distinguish **Hard Blocks** (superseded, retired, expired, stage conflict) from **Soft Advisories** (supplementary handout available). Clear, actionable explanation for every block. |
| **Subtle Clinical Conflicts** | Two handouts recommend different protein or carb targets without triggering keyword alerts | Topical pairwise clustering on key clinical vectors (macronutrient targets, restrictions, timing) flagging numerical or guidance divergence for owner review. |
| **PHI Leakage in Context Queries** | Clinician accidentally pastes patient name or MRN into search bar | Client-side and server-side regex scrubber redacting Names, DOBs, MRNs, and Phone Numbers *before* logging or LLM exposure. |
| **Cold-Start Document Upload Friction** | Dietitians find metadata tagging tedious | Auto-extraction of program, stage, condition, and review dates during ingestion, requiring only 1-click confirmation by owner. |

---

### 7. Success Measures

| Metric | Target | Evaluation Method |
| :--- | :--- | :--- |
| **Top-1 Approved Document Retrieval** | $\ge 90\%$ on Golden Test Set | 30+ realistic clinical scenarios evaluated against curated ground truth. |
| **Trap Catch Rate (Pre-Send Gate)** | **$100\%$** | Automated test suite exercising superseded, retired, expired, and stage-mismatched attempts. |
| **Out-of-Library Refusal Rate** | **$100\%$** | Adversarial questions outside practice scope must yield explicit refusal, zero hallucinations. |
| **Audit Log Completeness** | **$100\%$** of send attempts | Every transaction records timestamp, user, document ID/version, patient ID, and outcome. |
| **Demo Setup Time** | $< 60$ seconds | Single command start (`npm start` or `node server.js`) on local machine. |

---

### 8. What is Out of Scope (Boundaries)
- **Direct EHR / Billing Integration:** No direct HL7/FHIR pipes into Epic, AthenaHealth, or SimplePractice for this prototype. Patient records are synthetic.
- **Direct Patient Portal Messaging:** The prototype validates the send action and records the audit event; actual SMS/Email delivery pipes are mock-dispatched.
- **Legal HIPAA Compliance Certification:** Architectural design implements HIPAA-aware patterns (RBAC, audit logging, PHI redaction, encryption documentation), but is explicitly labeled as a concept prototype. Production BAA, penetration testing, and access reviews are documented as future enterprise requirements.
