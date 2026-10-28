# Verity Practice
*Clinical Handout Governance & Patient Delivery Safeguard System*  
**Thesis:** *One approved truth, in every channel.*

> **Lineage Notice:** Verity Practice adapts the architecture, governance principles, and retrieval patterns of [`ngupta1137/verity`](https://github.com/ngupta1137/verity) to outpatient registered dietitian (RD) practices.

---

## 1. Quick Start & Setup Instructions

### Prerequisites
- Node.js `v20.0` or higher (Tested on Node `v22.19.0`)
- npm `10.0+`

### Installation & Launch
```bash
# 1. Install dependencies (express, cors)
npm install

# 2. Run the evaluation harness (runs 35 golden tests + trap cases)
npm test

# 3. Start the local server
npm start
```

Open your browser to:
**`http://localhost:3000`**

---

## 2. Core Features (Product Terminology)

1. **Right Doc (`POST /api/right-doc`)**:
   - Context-aware clinical finder. Staff describe patient situations in plain language (*"post-op bariatric patient, week 2, lactose intolerant"*).
   - Deterministic role and audience filtering (internal clinical protocols never leak into patient results).
   - Returns top approved document with match rationale and **exact section citation**.
   - Refuses cleanly on out-of-library or unapproved protocols with zero hallucination.

2. **Send Check (`POST /api/send-check`, `POST /api/send`)**:
   - Synchronous pre-send gatekeeper before documents are marked given to patients.
   - Verifies 5 deterministic safety gates:
     1. **Status Gate:** Must be `approved` (Drafts and Retired are hard-blocked).
     2. **Version Lineage Gate:** Checks if superseded by newer revision.
     3. **Review Staleness Gate:** Verifies `review_by >= today`.
     4. **Stage Compatibility Gate:** Validates clinical stage (e.g. blocks Stage 2 purees for Day 4 clear-liquid patients).
     5. **Audience Gate:** Prohibits internal SOPs from being given to patients.

3. **Document Library & Version Diff Engine (`POST /api/documents/diff`)**:
   - Complete governance registry of 26 clinical documents.
   - Word-level and line-level side-by-side diffing between document versions.

4. **Alerts & Clinical Conflicts (`GET /api/dashboard`)**:
   - Pairwise semantic and clinical rule detector identifying contradictory approved guidelines (e.g., DOC-GEST-001 30g carb ceiling vs DOC-GEST-002 45g minimum carb floor).
   - Review expiration tracker highlighting stale clinical handouts.

5. **Practice Owner Dashboard & Audit Ledger (`GET /api/audit-log`)**:
   - Complete tamper-evident record of who sent which document version to which patient, when.
   - Analytics for practice owner Dr. Sarah Jenkins: compliance rate, blocked delivery attempts, and top-utilized handouts.

6. **Grounded Staff Q&A (`POST /api/qa`)**:
   - Internal clinical and billing reference engine answering exclusively from approved documents with section citations.

---

## 3. Deliberate Trap Seed Dataset Summary

The seeded clinical dataset (`data/documents.json`) contains 26 realistic clinical documents across 8 programs with deliberate traps:
- **Trap 1 (Superseded & Retired Handout):** `DOC-BAR-002 v1` (2024 Stage 2 handout with dairy shakes) superseded by `DOC-BAR-002 v2` (2025/2026 lactose-free guide).
- **Trap 2 (Retired Standalone Protocol):** `DOC-RET-001` (800kcal VLCD rapid loss protocol discontinued due to gallstone risk).
- **Trap 3 (Active Clinical Conflict):** `DOC-GEST-001` (strict 30g carb ceiling) vs `DOC-GEST-002` (ACOG standard 45g minimum floor). Both approved!
- **Trap 4 (Expired Review Date):** `DOC-CKD-001` (Renal potassium/phosphorus guide, review date expired 2024-01-15).
- **Trap 5 (Draft Status):** `DOC-DRAFT-001` (Unapproved draft plant protein protocol).
- **Trap 6 (Internal Audience Leak):** `DOC-INT-001` (Eating disorder escalation SOP marked internal-only).

---

## 4. Evaluation Results (Actual Numbers from `npm test`)

### Suite 1: Golden Regression Suite (35 Queries)
| Metric | Target | Actual Result | Status |
| :--- | :---: | :---: | :---: |
| **Top-1 Correct Retrieval (In-Scope)** | $\ge 90.0\%$ | **100.0%** (21/21) | **PASSED** |
| **Out-of-Library Refusal Rate** | $100.0\%$ | **100.0%** (6/6) | **PASSED** |
| **Trap Redirect / Refusal Rate** | $100.0\%$ | **100.0%** (4/4) | **PASSED** |
| **Internal Clinical Q&A Accuracy** | $\ge 90.0\%$ | **100.0%** (4/4) | **PASSED** |
| **Regression Suite Overall Accuracy** | $\ge 90.0\%$ | **100.0%** (35/35) | **PASSED** |

*Verified Category Sum: 21 In-Scope + 6 Out-of-Library + 4 Traps + 4 Internal = 35 / 35 Total Queries (100.0%)*

### Suite 2: Held-Out Evaluation Suite (20 Queries — Never Tuned On)
| Metric | Target | Actual Result | Status |
| :--- | :---: | :---: | :---: |
| **Held-Out Top-1 Retrieval (In-Scope)** | $\ge 90.0\%$ | **100.0%** (17/17) | **PASSED** |
| **Held-Out Out-of-Scope Refusal Rate** | $100.0\%$ | **100.0%** (2/2) | **PASSED** |
| **Held-Out Trap Handling Rate** | $100.0\%$ | **100.0%** (1/1) | **PASSED** |
| **Held-Out Overall Accuracy** | $\ge 90.0\%$ | **100.0%** (20/20) | **PASSED** |

*Verified Category Sum: 17 In-Scope + 2 Out-of-Scope + 1 Trap = 20 / 20 Total Queries (100.0%)*

### Safety Gates & Alerts
| Metric | Target | Actual Result | Status |
| :--- | :---: | :---: | :---: |
| **Pre-Send Check Catch Rate (Traps)** | $100.0\%$ | **100.0%** (17/17) | **PASSED** |
| **Conflict Detection (GDM 30g vs 45g)** | Detected | **1 Active Conflict** | **PASSED** |
| **Expired Review Date Catch** | Detected | **5 Expired Docs** | **PASSED** |

---

## 5. Component Status Classification

- **Built:** Right Doc retrieval engine, Send Check gatekeeper, Document library, Version diff engine, Staleness & Conflict detector, Tamper-evident audit ledger, Owner dashboard, Grounded Q&A, PHI regex scrubber.
- **Designed:** Cloud model gateway provider interface (OpenAI / Gemini / Anthropic) with deterministic fallback.
- **Proposed:** FHIR/HL7 EHR integration (Epic, SimplePractice), automated SMS/Email delivery pipes, WORM cloud audit storage.
