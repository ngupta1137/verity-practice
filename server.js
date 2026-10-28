// Verity Practice Server (Node.js + Express)
// Product: Verity Practice | Features: Right Doc & Send Check
// Lineage: Verity-pattern prototype (adapted from ngupta1137/verity)

import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { RightDocEngine } from './src/engine/retrieval.js';
import { validateSendCheck } from './src/engine/gatekeeper.js';
import { checkStaleness, detectConflicts } from './src/engine/conflicts.js';
import { compareDocumentVersions } from './src/engine/diff.js';
import { AuditLedger } from './src/engine/audit.js';
import { runEvaluation } from './src/eval/runner.js';
import { evaluatePolicy, runSafetyTriage } from './src/engine/policy.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = process.env.PORT || 3000;

const app = express();
app.use(cors());
app.use(express.json());

// Serve static frontend assets
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(path.join(__dirname, 'src/ui')));

// In-Memory Data Store (Initialized from seeded data files)
function loadJSON(relPath) {
  const candidates = [
    path.resolve(process.cwd(), relPath),
    path.resolve(__dirname, relPath),
    path.resolve(__dirname, '..', relPath),
    path.resolve(__dirname, '../..', relPath)
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    }
  }
  console.warn(`[WARN] loadJSON: Could not find ${relPath}`);
  return [];
}

let documents = loadJSON('data/documents.json');
let patients = loadJSON('data/synthetic_patients.json');
let seededAudit = loadJSON('data/audit_log.json');
if (!Array.isArray(seededAudit) || seededAudit.length === 0) {
  seededAudit = loadJSON('data/seed_audit_log.json');
}
function validateSeedIntegrity(patientsList, docsList) {
  const violations = [];
  for (const pat of patientsList) {
    for (const ad of (pat.assigned_documents || [])) {
      const match = docsList.find(d => d.doc_id === ad.doc_id && Number(d.version) === Number(ad.version));
      if (!match) {
        violations.push(`Patient ${pat.patient_id} (${pat.name}) has assigned document ${ad.doc_id} v${ad.version} which does not exist in library.`);
      }
    }
  }
  if (violations.length > 0) {
    console.error('[CRITICAL] Seed Integrity Violations Detected:\n' + violations.join('\n'));
  }
  return violations;
}

validateSeedIntegrity(patients, documents);

let dsmesRecords = loadJSON('data/dsmes_records.json');

// Seeded Exposure Review Queue (Workstream 5)
let exposureQueue = [
  {
    exposure_id: 'EXP-2026-001',
    patient_id: 'SYNTH-PAT-103',
    patient_name: 'Maria Santos',
    patient_dob: '1995-03-22',
    doc_id: 'DOC-GEST-001',
    version: 1,
    doc_title: 'Gestational Diabetes Meal Planning: Strict Low-Carbohydrate Approach (Legacy 2023)',
    withdrawn_reason: 'Guideline conflict resolution: Withdrawn due to <175g carb restriction violating ADA/ACOG consensus minimum maternal carb RDA.',
    delivered_date: '2026-10-22T14:15:00Z',
    exposure_status: 'PENDING_REVIEW',
    reviewed_by: null,
    reviewed_at: null,
    notes: null
  }
];

const auditLedger = new AuditLedger(seededAudit);
const rightDocEngine = new RightDocEngine(documents);


// -------------------------------------------------------------
// API Endpoints
// -------------------------------------------------------------

// 1. Documents API
app.get('/api/documents', (req, res) => {
  const { status, program, audience, search } = req.query;
  let result = [...documents];

  if (status) result = result.filter(d => d.status === status);
  if (program) result = result.filter(d => d.program === program);
  if (audience) result = result.filter(d => d.audience === audience);
  if (search) {
    const q = search.toLowerCase();
    result = result.filter(d => 
      d.title.toLowerCase().includes(q) ||
      d.doc_id.toLowerCase().includes(q) ||
      (d.tags && d.tags.some(t => t.toLowerCase().includes(q)))
    );
  }

  res.json({ total: result.length, documents: result });
});

app.get('/api/documents/:id', (req, res) => {
  const doc = documents.find(d => d.doc_id === req.params.id);
  if (!doc) return res.status(404).json({ error: 'Document not found' });
  
  // Find all versions of this document or related supersedes
  const versions = documents.filter(d => 
    d.doc_id === doc.doc_id || 
    (doc.supersedes && d.doc_id === doc.supersedes.split(' ')[0]) ||
    (d.superseded_by && d.superseded_by === doc.doc_id)
  );

  res.json({ document: doc, versions });
});

// 2. Version Diff API
app.post('/api/documents/diff', (req, res) => {
  const { oldDocId, oldVersion, newDocId, newVersion } = req.body;
  const oldDoc = documents.find(d => d.doc_id === oldDocId && Number(d.version) === Number(oldVersion));
  const newDoc = documents.find(d => d.doc_id === newDocId && Number(d.version) === Number(newVersion));

  if (!oldDoc || !newDoc) {
    return res.status(404).json({ error: 'One or both versions not found for comparison' });
  }

  const diffResult = compareDocumentVersions(oldDoc, newDoc);
  res.json(diffResult);
});

// 3. Feature: Right Doc (Context-Aware Document Finder with Inline Send Check)
app.post('/api/right-doc', (req, res) => {
  const { query, audience = 'patient', role = 'dietitian', patientContext, patient_id } = req.body;
  if (!query) return res.status(400).json({ error: 'Search query is required' });

  // Workstream 4: Action-Level Permissions - Front desk cannot run free-text clinical search for patient delivery
  if (role === 'front_desk') {
    return res.status(403).json({
      outcome: 'refused_role_permission',
      error: 'Front Desk is not authorized to run clinical search for patient delivery. Front Desk can only deliver RD-assigned educational materials.',
      role_restriction: true
    });
  }

  const result = rightDocEngine.searchRightDoc({
    query,
    audience,
    role,
    patientContext
  });

  const selectedPatient = (patient_id && patients.find(p => p.patient_id === patient_id)) || 
                          (patientContext?.patient_id && patients.find(p => p.patient_id === patientContext.patient_id)) || 
                          null;

  function attachInlineSendCheck(matchObj) {
    if (!matchObj || !matchObj.document) return matchObj;
    const doc = matchObj.document;
    const check = validateSendCheck({
      document: doc,
      allDocuments: documents,
      patient: selectedPatient,
      patientContext,
      actor: req.body.actor || 'Elena Gomez, RD',
      role
    });
    return {
      ...matchObj,
      sendCheck: {
        allowed: check.allowed,
        gateResult: check.gateResult,
        status: check.status,
        blocks: check.blocks,
        warnings: check.warnings,
        passes: check.passes,
        document_validity: check.document_validity,
        patient_applicability: check.patient_applicability,
        delivery_authorization: check.delivery_authorization,
        outcome: check.outcome,
        summary: check.summary
      }
    };
  }

  if (result.topMatch) {
    result.topMatch = attachInlineSendCheck(result.topMatch);
  }
  if (Array.isArray(result.matches)) {
    result.matches = result.matches.map(attachInlineSendCheck);
  }

  // Log search in audit ledger
  auditLedger.logEvent({
    actor: req.body.actor || 'Elena Gomez, RD',
    role,
    action: 'SEARCH_RIGHT_DOC',
    doc_id: result.topMatch?.document?.doc_id || 'NONE',
    version: result.topMatch?.document?.version || 0,
    doc_title: result.topMatch?.document?.title || 'No match',
    patient_context: query,
    status: result.outcome === 'approved_match' ? 'APPROVED' : 'REFUSED',
    gate_result: result.outcome === 'approved_match' ? (result.topMatch?.sendCheck?.allowed ? 'PASS' : 'GATE_INTERCEPT') : 'REFUSED',
    details: result.message
  });

  res.json(result);
});

// 4. Feature: Send Check (Deterministic Pre-Send Verification)
app.post('/api/send-check', (req, res) => {
  const { doc_id, version, patient_id, actor = 'Elena Gomez, RD', role = 'dietitian', recipient_verification } = req.body;
  const doc = documents.find(d => d.doc_id === doc_id && (version ? Number(d.version) === Number(version) : true));
  const patient = patients.find(p => p.patient_id === patient_id) || null;

  if (!doc) return res.status(404).json({ error: 'Document not found for Send Check' });

  const check = validateSendCheck({
    document: doc,
    allDocuments: documents,
    patient,
    actor,
    role
  });

  // Action-level permission enforcement for Front Desk (Workstream 4)
  if (role === 'front_desk') {
    if (doc.audience === 'internal' || doc.status === 'draft') {
      check.allowed = false;
      check.gateResult = 'FAIL';
      check.delivery_authorization = 'denied';
      check.status = 'BLOCKED';
      check.blocks.unshift({
        code: 'FRONT_DESK_DRAFT_INTERNAL_BLOCK',
        message: `DENIED: Front Desk is not authorized to deliver internal administrative SOPs or draft documents ("${doc.title}").`
      });
    }

    if (patient) {
      const isAssigned = (patient.assigned_documents || []).some(ad => ad.doc_id === doc.doc_id);
      if (!isAssigned) {
        check.allowed = false;
        check.gateResult = 'FAIL';
        check.delivery_authorization = 'denied';
        check.status = 'BLOCKED';
        check.blocks.unshift({
          code: 'FRONT_DESK_UNASSIGNED_DOC_BLOCK',
          message: `DENIED: Document "${doc.doc_id}" has NOT been assigned to patient ${patient.name} by a Registered Dietitian. Front Desk can only deliver RD-assigned educational materials.`
        });
      }
    }

    if (recipient_verification && patient) {
      const providedDob = (recipient_verification.date_of_birth || recipient_verification.dob || req.body.recipient_dob || '').trim();
      const expectedDob = (patient.date_of_birth || '').trim();
      const providedName = (recipient_verification.name || req.body.recipient_name || '').trim();
      const expectedName = (patient.name || '').trim();

      const isNameMatch = !providedName || providedName.toLowerCase() === expectedName.toLowerCase();
      const isDobMatch = providedDob === expectedDob;

      if (!providedDob || !isDobMatch || !isNameMatch) {
        check.allowed = false;
        check.gateResult = 'FAIL';
        check.delivery_authorization = 'denied';
        check.status = 'BLOCKED';
        check.blocks.unshift({
          code: 'FRONT_DESK_IDENTIFIER_MISMATCH',
          message: 'DENIED: Front Desk patient verification failed. Identifiers do not match.'
        });
      }
    }
  }

  if (!check.allowed || check.blocks.length > 0) {
    check.summary = `DELIVERY PROHIBITED: ${check.blocks.map(b => b.message).join(' | ')}`;
    check.outcome = 'BLOCK_DELIVERY';
    check.delivery_authorization = 'denied';
    check.status = 'BLOCKED';
    check.gateResult = 'FAIL';
  }

  // Log pre-send check event
  auditLedger.logEvent({
    actor,
    role,
    action: check.allowed ? 'PRE_SEND_CHECK_PASS' : 'PRE_SEND_CHECK_FAIL',
    doc_id: doc.doc_id,
    version: doc.version,
    doc_title: doc.title,
    patient_id,
    recipient_name: patient?.name,
    patient_context: patient ? `${patient.name} (${patient.patient_stage})` : 'Context unspecified',
    status: check.status,
    gate_result: check.gateResult,
    details: check.summary
  });

  res.json(check);
});

// 5. Final Send Execution
app.post('/api/send', (req, res) => {
  const { doc_id, version, patient_id, actor = 'Elena Gomez, RD', role = 'dietitian', recipient_verification } = req.body;
  const doc = documents.find(d => d.doc_id === doc_id && (version ? Number(d.version) === Number(version) : true));
  const patient = patients.find(p => p.patient_id === patient_id);

  if (!doc) return res.status(404).json({ error: 'Document not found' });

  // Front Desk Action-Level Permissions Check (Workstream 4)
  if (role === 'front_desk') {
    const inputDob = (recipient_verification?.date_of_birth || recipient_verification?.dob || req.body.recipient_dob || '').trim();
    const inputName = (recipient_verification?.name || req.body.recipient_name || '').trim();
    const patDob = (patient?.date_of_birth || '').trim();
    const patName = (patient?.name || '').trim();

    const isNameMatch = !inputName || inputName.toLowerCase() === patName.toLowerCase();
    const isDobMatch = inputDob === patDob;

    if (!inputDob || !isDobMatch || !isNameMatch) {
      const failMsg = 'DENIED: Front Desk patient verification failed. Identifiers do not match.';
      auditLedger.logEvent({
        actor,
        role,
        action: 'SEND_BLOCKED',
        doc_id: doc.doc_id,
        version: doc.version,
        doc_title: doc.title,
        patient_id,
        recipient_name: patient?.name,
        patient_context: patient ? `${patient.name} (Verification Failed)` : 'Unspecified',
        status: 'BLOCKED',
        gate_result: 'FAIL',
        details: failMsg
      });

      return res.status(403).json({
        success: false,
        blocked: true,
        message: 'Identifiers do not match.'
      });
    }

    const isAssigned = (patient?.assigned_documents || []).some(ad => ad.doc_id === doc.doc_id);
    if (!isAssigned) {
      const unassignedMsg = `DENIED: Document "${doc.doc_id}" has NOT been assigned to patient ${patient?.name} by a Registered Dietitian. Front Desk can only deliver RD-assigned educational materials.`;
      auditLedger.logEvent({
        actor,
        role,
        action: 'SEND_BLOCKED',
        doc_id: doc.doc_id,
        version: doc.version,
        doc_title: doc.title,
        patient_id,
        recipient_name: patient?.name,
        status: 'BLOCKED',
        gate_result: 'FAIL',
        details: unassignedMsg
      });

      return res.status(403).json({
        success: false,
        blocked: true,
        message: unassignedMsg
      });
    }

    if (doc.audience === 'internal' || doc.status === 'draft') {
      const draftMsg = `DENIED: Front Desk is not authorized to deliver internal administrative SOPs or draft documents ("${doc.title}").`;
      auditLedger.logEvent({
        actor,
        role,
        action: 'SEND_BLOCKED',
        doc_id: doc.doc_id,
        version: doc.version,
        doc_title: doc.title,
        patient_id,
        recipient_name: patient?.name,
        status: 'BLOCKED',
        gate_result: 'FAIL',
        details: draftMsg
      });

      return res.status(403).json({
        success: false,
        blocked: true,
        message: draftMsg
      });
    }
  }

  // Re-run Send Check to guarantee gatekeeper cannot be bypassed
  const check = validateSendCheck({
    document: doc,
    allDocuments: documents,
    patient,
    actor,
    role
  });

  if (!check.allowed) {
    auditLedger.logEvent({
      actor,
      role,
      action: 'SEND_BLOCKED',
      doc_id: doc.doc_id,
      version: doc.version,
      doc_title: doc.title,
      patient_id,
      recipient_name: patient?.name,
      patient_context: patient ? `${patient.name} (${patient.patient_stage})` : 'Unspecified',
      status: 'BLOCKED',
      gate_result: 'FAIL',
      details: check.summary
    });

    return res.status(403).json({
      success: false,
      blocked: true,
      checkResult: check,
      message: check.summary
    });
  }

  // Workstream 6: Cryptographic Content Hash (SHA-256)
  const contentToHash = JSON.stringify({
    doc_id: doc.doc_id,
    version: doc.version,
    title: doc.title,
    sections: doc.sections || []
  });
  const content_hash = crypto.createHash('sha256').update(contentToHash).digest('hex');

  // Record successful delivery in append-only audit ledger
  const event = auditLedger.logEvent({
    actor,
    role,
    action: 'SEND_COMPLETED',
    doc_id: doc.doc_id,
    version: doc.version,
    content_hash,
    doc_title: doc.title,
    patient_id,
    recipient_name: patient ? patient.name : 'Patient',
    verified_identifiers: role === 'front_desk' ? ['Full Name', 'Date of Birth'] : ['Clinician Assigned'],
    patient_context: patient ? `${patient.name} (${patient.patient_stage})` : 'General Patient',
    status: 'APPROVED',
    gate_result: 'PASS',
    details: `Successfully dispatched approved v${doc.version} (SHA256: ${content_hash.substring(0, 12)}...) to patient ${patient_id}.`
  });

  // Workstream 7: De-Risk Billing and Encounter Evidence
  // Clinical CPT: Draft note only; never derive billable units from a handout send
  const hasPriorMnt = dsmesRecords.some(r => r.patient_id === (patient ? patient.patient_id : patient_id));
  const isInitialStage = patient?.patient_stage?.toLowerCase().includes('initial') || 
                         patient?.patient_stage?.toLowerCase().includes('stage 1') ||
                         patient?.patient_stage?.toLowerCase().includes('intake') ||
                         patient?.patient_stage?.toLowerCase().includes('new');
  const isInitial = !hasPriorMnt || isInitialStage;
  const defaultCpt = isInitial ? '97802' : '97803';
  const mntRecord = {
    record_id: `MNT-${Date.now()}`,
    patient_id: patient ? patient.patient_id : patient_id,
    patient_name: patient ? patient.name : 'Outpatient',
    program: doc.program,
    condition: doc.condition || (patient ? patient.condition : 'Clinical Nutrition'),
    education_delivered: doc.title,
    doc_id: doc.doc_id,
    version: doc.version,
    content_hash,
    delivered_by: actor,
    delivered_at: event.timestamp,
    billing_cpt_code: defaultCpt,
    cpt_description: defaultCpt === '97802' 
      ? 'MNT Initial assessment and intervention, individual (each 15 min)' 
      : 'MNT Re-assessment and intervention, individual (each 15 min)',
    billing_status: 'Draft, needs billing review',
    billing_units: null, // De-risked: Never derive billable units from a handout send
    duration_minutes: null,
    channel: req.body.channel || 'In-Clinic Handout & Patient Portal',
    pre_send_verified: true,
    claim_status: 'Draft encounter note only; billing units require clinical encounter review'
  };

  dsmesRecords.unshift(mntRecord);
  try {
    const dsmesPath = path.resolve(process.cwd(), 'data/dsmes_records.json');
    if (fs.existsSync(path.dirname(dsmesPath))) {
      fs.writeFileSync(dsmesPath, JSON.stringify(dsmesRecords, null, 2), 'utf8');
    }
  } catch (err) {}


  res.json({
    success: true,
    blocked: false,
    receipt: {
      eventId: event.event_id,
      timestamp: event.timestamp,
      document: { id: doc.doc_id, version: doc.version, title: doc.title },
      patient: patient ? { id: patient.patient_id, name: patient.name } : { id: patient_id },
      actor: { name: actor, role },
      mntRecord,
      message: `Document ${doc.doc_id} v${doc.version} safely delivered and recorded in DSMES/MNT billing ledger.`
    }
  });
});

// 6. Grounded Staff Q&A (Workstream 7: De-Risk Q&A, Labs Quoting-Only)
app.post('/api/qa', (req, res) => {
  const { query, role = 'dietitian' } = req.body;
  if (!query) return res.status(400).json({ error: 'Query is required' });

  const answer = rightDocEngine.answerStaffQuery({ query, role });
  res.json({
    ...answer,
    environment: 'Labs: internal, experimental',
    quoting_only: true,
    disclaimer: 'Labs internal experimental tool. Answers strictly quote approved clinical documents; no clinical advice synthesized.'
  });
});

// 7. Synthetic Patients API
app.get('/api/patients', (req, res) => {
  res.json({ patients });
});

// 8. DSMES / MNT Education Delivery Records API (Workstream 7: Renamed Encounter Evidence)
app.get('/api/dsmes-mnt', (req, res) => {
  const { patient_id } = req.query;
  let records = dsmesRecords;
  if (patient_id) {
    records = records.filter(r => r.patient_id === patient_id);
  }
  res.json({ records });
});

// 9. Conflict Resolution API (Workstream 5: Conflict Governance - No One-Click Resolve)
app.post('/api/conflicts/resolve', (req, res) => {
  const {
    conflict_id = 'CONF-DOC-GEST-001-DOC-GEST-002',
    decision,
    doc_to_retire = 'DOC-GEST-001',
    doc_to_unlock = 'DOC-GEST-002',
    written_rationale,
    resolution_note,
    reviewer_identity = 'Dr. Sarah Jenkins, RDN (Practice Owner & Clinical Director)',
    resulting_state = 'Withdraw DOC-GEST-001 (strict 30g ceiling); Approve and unlock DOC-GEST-002 (consensus >=175g/day); Queue exposed patients for review.',
    actor = 'Dr. Sarah Jenkins, RDN',
    role = 'owner'
  } = req.body;

  // Enforce role: Must be owner or clinical director
  if (role !== 'owner' && role !== 'clinical_director' && !actor.includes('Jenkins')) {
    return res.status(403).json({
      error: 'Permission Denied: Only the Practice Owner or Clinical Director can resolve clinical guideline conflicts.',
      role_restriction: true
    });
  }

  const rationale = written_rationale || resolution_note || req.body.rationale;
  if (!rationale || rationale.trim().length < 15) {
    return res.status(400).json({
      error: 'Conflict resolution requires a written clinical rationale explaining the decision and evidence base (minimum 15 characters).'
    });
  }

  const retireDoc = documents.find(d => d.doc_id === doc_to_retire);
  const unlockDoc = documents.find(d => d.doc_id === doc_to_unlock);

  if (retireDoc) {
    retireDoc.status = 'retired';
    retireDoc.retired_reason = `Withdrawn by Clinical Director (${reviewer_identity}): ${rationale}`;
    retireDoc.retired_date = new Date().toISOString().split('T')[0];
    retireDoc.conflict_resolved = true;
    retireDoc.conflict_locked = false;
  }

  if (unlockDoc) {
    unlockDoc.status = 'approved';
    unlockDoc.conflict_resolved = true;
    unlockDoc.conflict_locked = false;
  }

  // Workstream 5: Add any synthetic patient who previously received the withdrawn version to Exposure Queue
  for (const p of patients) {
    const gotWithdrawnInProfile = (p.assigned_documents || []).some(ad => ad.doc_id === doc_to_retire);
    const gotWithdrawnInAudit = auditLedger.getEntries(500).some(e => e.action === 'SEND_COMPLETED' && e.doc_id === doc_to_retire && (e.patient_id === p.patient_id || e.recipient_name === p.name));

    if ((gotWithdrawnInProfile || gotWithdrawnInAudit) && !exposureQueue.some(eq => eq.patient_id === p.patient_id && eq.doc_id === doc_to_retire)) {
      const deliveredEntry = auditLedger.getEntries(500).find(e => e.action === 'SEND_COMPLETED' && e.doc_id === doc_to_retire && (e.patient_id === p.patient_id || e.recipient_name === p.name));
      const delivered_date = deliveredEntry?.timestamp || '2026-10-22T14:15:00Z';
      exposureQueue.push({
        exposure_id: `EXP-${Date.now()}-${p.patient_id}`,
        patient_id: p.patient_id,
        patient_name: p.name,
        patient_dob: p.date_of_birth,
        doc_id: doc_to_retire,
        version: 1,
        doc_title: retireDoc ? retireDoc.title : doc_to_retire,
        withdrawn_reason: rationale,
        delivered_date,
        exposure_status: 'PENDING_REVIEW',
        reviewed_by: null,
        reviewed_at: null,
        notes: null
      });
    }
  }

  // Persist updated documents to data/documents.json
  try {
    const docPath = path.resolve(process.cwd(), 'data/documents.json');
    if (fs.existsSync(path.dirname(docPath))) {
      fs.writeFileSync(docPath, JSON.stringify(documents, null, 2), 'utf8');
    }
  } catch (err) {
    console.warn('Documents save notice:', err.message);
  }

  // Update RightDoc engine documents
  rightDocEngine.updateDocuments(documents);

  // Log to Audit Ledger
  const event = auditLedger.logEvent({
    actor: reviewer_identity || actor,
    role,
    action: 'CONFLICT_RESOLVED',
    doc_id: unlockDoc ? unlockDoc.doc_id : doc_to_unlock,
    version: unlockDoc ? unlockDoc.version : 1,
    doc_title: unlockDoc ? unlockDoc.title : 'Guideline Resolution',
    status: 'APPROVED',
    gate_result: 'PASS',
    details: `Decision: ${decision || 'WITHDRAW_A_KEEP_B'} | Resulting State: ${resulting_state} | Rationale: ${rationale}`
  });

  res.json({
    success: true,
    message: `Conflict ${conflict_id} resolved with recorded clinical rationale. Retired ${doc_to_retire}, unlocked ${doc_to_unlock}.`,
    auditEventId: event.event_id,
    reviewer_identity,
    decision: decision || 'WITHDRAW_A_KEEP_B',
    resulting_state,
    exposureQueueLength: exposureQueue.filter(e => e.exposure_status === 'PENDING_REVIEW').length,
    activeConflictsRemaining: detectConflicts(documents).length
  });
});

// 10. Exposure Review Queue API (Workstream 5)
app.get('/api/conflicts/exposure-queue', (req, res) => {
  res.json({ queue: exposureQueue });
});

app.post('/api/conflicts/exposure-review', (req, res) => {
  const { exposure_id, patient_id, doc_id, reviewer = 'Dr. Sarah Jenkins, RDN', notes = 'Exposure reviewed; patient contacted and updated educational materials dispatched.' } = req.body;
  
  const item = exposureQueue.find(e => (exposure_id && e.exposure_id === exposure_id) || (e.patient_id === patient_id && (!doc_id || e.doc_id === doc_id)));
  if (!item) {
    return res.status(404).json({ error: 'Exposure record not found' });
  }

  item.exposure_status = 'EXPOSURE_REVIEWED';
  item.reviewed_by = reviewer;
  item.reviewed_at = new Date().toISOString();
  item.notes = notes;

  auditLedger.logEvent({
    actor: reviewer,
    role: 'owner',
    action: 'EXPOSURE_REVIEW_COMPLETED',
    doc_id: item.doc_id,
    version: item.version,
    doc_title: item.doc_title,
    patient_id: item.patient_id,
    recipient_name: item.patient_name,
    status: 'APPROVED',
    gate_result: 'PASS',
    details: `Exposure reviewed & patient contacted: ${notes}`
  });

  res.json({
    success: true,
    message: `Patient ${item.patient_name} exposure review marked completed.`,
    item
  });
});

// 11. Owner Demo Data Reset API (Item 7: Demo Reset)
app.post('/api/demo/reset', (req, res) => {
  const { role, actor } = req.body || {};
  if (role !== 'owner' && role !== 'clinical_director') {
    return res.status(403).json({ success: false, message: 'Permission Denied: Only the Practice Owner or Clinical Director can reset demo data.' });
  }

  // Restore seed documents
  documents = loadJSON('data/documents.json');
  const g1 = documents.find(d => d.doc_id === 'DOC-GEST-001');
  if (g1) {
    g1.status = 'approved';
    g1.conflict_locked = true;
    g1.conflict_resolved = false;
  }
  const g2 = documents.find(d => d.doc_id === 'DOC-GEST-002');
  if (g2) {
    g2.status = 'approved';
    g2.conflict_locked = true;
    g2.conflict_resolved = false;
  }
  try {
    const docPath = path.resolve(process.cwd(), 'data/documents.json');
    if (fs.existsSync(docPath)) {
      fs.writeFileSync(docPath, JSON.stringify(documents, null, 2), 'utf8');
    }
  } catch (err) {}

  // Restore seed synthetic patients
  patients = loadJSON('data/synthetic_patients.json');
  validateSeedIntegrity(patients, documents);

  // Restore SEEDED demo history (8-10 audit events: successful sends, blocked attempts, past delivery of DOC-GEST-001 to Maria Santos)
  const seedAudit = loadJSON('data/seed_audit_log.json') || [];
  auditLedger.resetToSeed(seedAudit);

  // Reset exposure queue to empty
  exposureQueue = [];

  // Reset DSMES records to clean seed
  dsmesRecords = loadJSON('data/dsmes_records.json');

  // Re-index retrieval engine
  rightDocEngine.updateDocuments(documents);

  res.json({
    success: true,
    message: 'Demo data successfully reset: seed documents, synthetic patients, conflict CONF-001 re-locked, and seeded demo audit history restored.',
    activeConflicts: detectConflicts(documents).length,
    eventsCount: auditLedger.getEntries().length
  });
});


// 8. Owner Dashboard & Analytics
app.get('/api/dashboard', (req, res) => {
  const stats = auditLedger.getOwnerDashboardStats(documents);
  res.json(stats);
});

// 9. Full Audit Log
app.get('/api/audit-log', (req, res) => {
  res.json({ entries: auditLedger.getEntries(200) });
});

// 10. Run Evaluation Endpoint
app.get('/api/eval', (req, res) => {
  const report = runEvaluation();
  res.json(report);
});

app.get('/api/eval/run', (req, res) => {
  const report = runEvaluation();
  res.json(report);
});

app.post('/api/eval/run', (req, res) => {
  const report = runEvaluation();
  res.json(report);
});

// Start Server (only when not running inside Vercel serverless environment)
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`\n======================================================`);
    console.log(`  VERITY PRACTICE SERVER RUNNING ON http://localhost:${PORT}`);
    console.log(`  Thesis: "One approved truth, in every channel."`);
    console.log(`  Features: Right Doc & Send Check`);
    console.log(`======================================================\n`);
  });
}

export default app;
