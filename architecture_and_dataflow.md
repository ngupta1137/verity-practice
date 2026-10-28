# Verity-RD Architecture & Data Flow Specification
**System:** Clinical Knowledge Search & Distribution Governance Platform  
**Lineage:** Verity-pattern prototype (`ngupta1137/verity` adaptation)  
**Classification:** Prototype Architecture Specification  

---

### 1. High-Level System Architecture

```mermaid
flowchart TB
    subgraph Client["Presentation Layer (Browser SPA)"]
        UI_Finder["Right-Document Finder<br/>(Context-Aware Search)"]
        UI_PreSend["Pre-Send Gatekeeper Modal<br/>(Safety & Version Check)"]
        UI_Library["Document Library & Governance<br/>(Metadata, Diffs, Review)"]
        UI_Dashboard["Practice Owner Dashboard<br/>(Audit Log, Conflicts, Alerts)"]
        UI_QA["Grounded Clinical Q&A<br/>(Staff Internal Reference)"]
    end

    subgraph Gateway["API & Policy Enforcement Layer (Node.js Service)"]
        Router["REST API Router & Session Context"]
        Guard["PHI Redaction & Safety Pre-Check<br/>(Strip Names, MRNs, Phone, DOB)"]
        Gatekeeper["Deterministic Pre-Send Engine<br/>(Status, Version, Review Date, Stage)"]
        AuditService["Tamper-Evident Audit Logger<br/>(Append-Only Action History)"]
    end

    subgraph CoreEngine["Verity Core Engine (Deterministic + Hybrid)"]
        DocRegistry["Document & Version Registry<br/>(Lineage, Diffs, Governance)"]
        FilterEngine["Role & Audience Scoping<br/>(Patient vs Internal, Program Filter)"]
        HybridRetriever["Hybrid Retrieval Engine<br/>(BM25 + Clinical Synonym + N-Gram)"]
        ConflictEngine["Staleness & Conflict Detector<br/>(Review Expiry & Guideline Clashes)"]
    end

    subgraph LLMBoundary["LLM & Gateway Boundary (Isolated)"]
        GatewayAdapter["Model Gateway Adapter<br/>(Local Deterministic / Cloud Provider)"]
        PromptSanitizer["Prompt Sanitizer<br/>(No PHI, Context Chunks Only)"]
        QAComposer["Grounded Answer Composer<br/>(Strict Citation Required)"]
    end

    subgraph Storage["Persistence & Registry (Local / Fast Storage)"]
        DocStore[("Synthetic Document Store<br/>(25+ Seed Handouts & Guides)")]
        AuditStore[("Audit Ledger<br/>(Sends, Blocks, Reviews)")]
        MetaStore[("Clinical Metadata Registry<br/>(Programs, Stages, Conditions)")]
    end

    Client --> Router
    Router --> Guard
    Guard --> Gatekeeper
    Guard --> FilterEngine
    FilterEngine --> HybridRetriever
    HybridRetriever --> DocRegistry
    Gatekeeper --> DocRegistry
    Gatekeeper --> AuditService
    AuditService --> AuditStore
    DocRegistry --> DocStore
    DocRegistry --> MetaStore
    ConflictEngine --> DocRegistry
    HybridRetriever --> GatewayAdapter
    GatewayAdapter --> PromptSanitizer
    PromptSanitizer --> QAComposer
    QAComposer --> Router
```

---

### 2. Runtime Data Flow Maps

#### Flow A: Right-Document Finder & Pre-Send Check

```mermaid
sequenceDiagram
    autonumber
    actor Staff as Elena Gomez, RD (Staff Clinician)
    participant UI as Verity-RD Browser App
    participant Guard as PHI Scrubber & Safety Guard
    participant Engine as Hybrid Retrieval Engine
    participant Gate as Pre-Send Gatekeeper
    participant Audit as Audit Ledger

    Staff->>UI: Enter patient query ("Bariatric post-op week 2, pureed stage, lactose intolerant")
    UI->>Guard: Submit query string + context
    Guard->>Guard: Scrub potential identifiers (Names, MRNs, Phone, DOB)
    Guard->>Engine: Search approved documents (Audience = Patient, Status = Approved)
    Engine->>Engine: Score BM25 + Clinical Taxonomy (Program: Bariatric, Stage: Stage 2 Pureed)
    Engine-->>UI: Return Top-1 Document (DOC-BAR-002 v2: "Bariatric Stage 2 Pureed Diet Guide") + Citations
    
    Staff->>UI: Click "Give to Patient" (Patient: SYNTH-PAT-104)
    UI->>Gate: Verify Pre-Send (Doc ID: DOC-BAR-002, Version: 2, Patient Stage: Week 2)
    Gate->>Gate: Check 1: Status == 'approved' (PASS)
    Gate->>Gate: Check 2: Version == Latest (PASS, v2 is latest)
    Gate->>Gate: Check 3: Review Date >= Today (PASS, valid thru 2027)
    Gate->>Gate: Check 4: Stage/Condition matches patient (PASS, Stage 2 matches Week 2)
    Gate->>Audit: Record SUCCESSFUL_SEND (Staff: Elena, Patient: SYNTH-PAT-104, Doc: DOC-BAR-002 v2)
    Gate-->>UI: Green Approval: Document delivered & logged
```

#### Flow B: Trap Interception (Superseded or Retired Document Attempt)

```mermaid
sequenceDiagram
    autonumber
    actor Staff as Marcus (Front Desk Coordinator)
    participant UI as Verity-RD Browser App
    participant Gate as Pre-Send Gatekeeper
    participant Audit as Audit Ledger

    Staff->>UI: Selects older saved file: "DOC-BAR-001 v1 (Post-Op General Meal Plan)"
    Staff->>UI: Attempt to mark given to Patient SYNTH-PAT-109
    UI->>Gate: Validate Pre-Send (Doc: DOC-BAR-001 v1, Patient: SYNTH-PAT-109)
    Gate->>Gate: Check 1: Status == 'retired' -> FAIL!
    Gate->>Gate: Check 2: Superseded by DOC-BAR-002 v2 -> FAIL!
    Gate->>Audit: Record BLOCKED_SEND (Staff: Marcus, Reason: "SUPERSEDED_AND_RETIRED")
    Gate-->>UI: HARD BLOCK (Red Alert): "Action Blocked: DOC-BAR-001 v1 is RETIRED and replaced by DOC-BAR-002 v2. Click here to use approved v2."
    UI-->>Staff: Blocks distribution, auto-routes to current approved handout
```

---

### 3. LLM Call Boundaries & Data Isolation

To prevent hallucination, data leakage, and compliance breaches, the LLM is strictly isolated within defined boundaries:

| Task / Flow | LLM Involvement? | What Data the LLM Sees | Fallback / Deterministic Rule |
| :--- | :--- | :--- | :--- |
| **Pre-Send Verification Gate** | **NO (100% Deterministic)** | **None.** No data sent to LLM. | Rule engine checks boolean logic (`status == 'approved'`, `version == latest`, `review_date >= today`, `stage == patient_stage`). |
| **Document Discovery / Ranking** | **NO (Hybrid Deterministic)** | **None.** No patient identifiers. | BM25 + clinical taxonomic mapping + n-gram keyword overlap. |
| **Grounded Staff Q&A** | **YES (Optional Composer)** | Redacted staff query + Exact text chunks of approved documents only. **Zero PHI.** | Model must cite exact Document ID and Section. If confidence < 0.85 or evidence insufficient, deterministic refusal triggers: *"No approved document contains this guidance."* |
| **Metadata Tag Extraction** | **YES (Assisted Ingestion)** | Unstructured document text (PDF/DOCX). | Dietitian/Owner must review and confirm extracted metadata before publishing. |
| **Conflict Detection** | **HYBRID (Deterministic + LLM)** | Pairs of document text sections within the same clinical program. | Cosine similarity flags overlapping scopes; rule checks numerical divergences (e.g., protein g/day, carb limits). |

---

### 4. Component Status Matrix (Built vs. Designed vs. Proposed)

| Component | Status | Implementation Details |
| :--- | :--- | :--- |
| **Document Library & Metadata Registry** | **BUILT** | Full registry with Program, Condition, Stage, Audience, Owner, Version, Status, and Review-by date. |
| **Version Lineage & Visual Diff Engine** | **BUILT** | Track superseded versions, retain searchable retired docs with clear warnings, word/line level diffing. |
| **Deterministic Pre-Send Gatekeeper** | **BUILT** | Hard blocks on Draft, Retired, Superseded, Expired, and Stage-mismatched deliveries. |
| **Context-Aware Finder with Citations** | **BUILT** | Plain-language search mapping patient context to approved docs with section citations and match rationale. |
| **Staleness & Clinical Conflict Engine** | **BUILT** | Automated monitor for overdue review dates and pairwise semantic/numerical conflict detection. |
| **Tamper-Evident Audit Ledger** | **BUILT** | Structured event logging of all searches, checks, sends, and blocked attempts. |
| **Practice Owner Analytics Dashboard** | **BUILT** | Metrics for review queue, blocked sends, top documents, and staff compliance rate. |
| **Grounded Clinical Q&A with Refusal** | **BUILT** | Strict citation-backed retrieval; explicit refusal on out-of-scope/unapproved queries. |
| **Deterministic PHI Scrubber** | **BUILT** | Multi-pattern regex redacting names, MRNs, phone numbers, and dates of birth. |
| **Cloud Model Gateway (OpenAI/Anthropic/Gemini)** | **DESIGNED** | Standardized pluggable gateway interface with local deterministic mock fallback. |
| **EHR FHIR/HL7 Bi-directional Sync** | **PROPOSED** | Future integration with Epic, AthenaHealth, or SimplePractice patient records. |
| **Automated Patient SMS/Email Dispatch** | **PROPOSED** | SendGrid / Twilio integration to deliver approved PDF links to patients. |
| **Hardware-Encrypted Audit Storage (WORM)** | **PROPOSED** | Write-Once-Read-Many cloud storage (AWS S3 Object Lock) for legal audit compliance. |

---

### 5. HIPAA-Aware Production Roadmap

While this prototype is designed with HIPAA awareness, a commercial production deployment requires the following operational and architectural controls:

1. **Business Associate Agreements (BAAs):**
   - Execute BAAs with hosting provider (AWS, GCP, or Azure Healthcare), database providers, and any cloud LLM API providers (e.g., OpenAI Zero Data Retention BAA or AWS Bedrock HIPAA-eligible endpoints).
2. **Encryption Standards:**
   - **At Rest:** AES-256 encryption on all document storage volumes and database instances.
   - **In Transit:** TLS 1.3 enforced on all REST endpoints and internal microservice communication.
3. **Identity & Access Management (IAM):**
   - Integration with practice Identity Provider (Google Workspace / Microsoft Entra ID) with enforced Multi-Factor Authentication (MFA).
   - Strict Role-Based Access Control (RBAC): Dietitian, Front Desk, Clinical Director / Owner.
4. **Audit Trail Immutability & Retention:**
   - Write audit logs to an append-only, tamper-evident log stream with 6-year retention (HIPAA standard §164.312(b)).
5. **Periodic Access Reviews:**
   - Quarterly automated access reviews and credential revocation workflows for departing staff members.
