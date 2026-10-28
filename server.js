// Verity Practice Server (Node.js + Express)
// Product: Verity Practice | Features: Right Doc & Send Check
// Lineage: Verity-pattern prototype (adapted from ngupta1137/verity)

import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { RightDocEngine } from './src/engine/retrieval.js';
import { validateSendCheck } from './src/engine/gatekeeper.js';
import { checkStaleness, detectConflicts } from './src/engine/conflicts.js';
import { compareDocumentVersions } from './src/engine/diff.js';
import { AuditLedger } from './src/engine/audit.js';
import { runEvaluation } from './src/eval/runner.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = process.env.PORT || 3000;

const app = express();
app.use(cors());
app.use(express.json());

// Serve static frontend assets
app.use(express.static(path.join(__dirname, 'src/ui')));

// In-Memory Data Store (Initialized from seeded data files)
function loadJSON(relPath) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, relPath), 'utf8'));
}

let documents = loadJSON('data/documents.json');
let patients = loadJSON('data/synthetic_patients.json');
let seededAudit = loadJSON('data/audit_log.json');

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

// 3. Feature: Right Doc (Context-Aware Document Finder)
app.post('/api/right-doc', (req, res) => {
  const { query, audience = 'patient', role = 'dietitian', patientContext } = req.body;
  if (!query) return res.status(400).json({ error: 'Search query is required' });

  const result = rightDocEngine.searchRightDoc({
    query,
    audience,
    role,
    patientContext
  });

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
    gate_result: result.outcome === 'approved_match' ? 'PASS' : 'REFUSED',
    details: result.message
  });

  res.json(result);
});

// 4. Feature: Send Check (Deterministic Pre-Send Verification)
app.post('/api/send-check', (req, res) => {
  const { doc_id, version, patient_id, actor = 'Elena Gomez, RD', role = 'dietitian' } = req.body;
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

  // Log pre-send check event
  auditLedger.logEvent({
    actor,
    role,
    action: check.allowed ? 'PRE_SEND_CHECK_PASS' : 'PRE_SEND_CHECK_FAIL',
    doc_id: doc.doc_id,
    version: doc.version,
    doc_title: doc.title,
    patient_id,
    patient_context: patient ? `${patient.name} (${patient.patient_stage})` : 'Context unspecified',
    status: check.status,
    gate_result: check.gateResult,
    details: check.summary
  });

  res.json(check);
});

// 5. Final Send Execution
app.post('/api/send', (req, res) => {
  const { doc_id, version, patient_id, actor = 'Elena Gomez, RD', role = 'dietitian' } = req.body;
  const doc = documents.find(d => d.doc_id === doc_id && (version ? Number(d.version) === Number(version) : true));
  const patient = patients.find(p => p.patient_id === patient_id);

  if (!doc) return res.status(404).json({ error: 'Document not found' });

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

  // Record successful delivery
  const event = auditLedger.logEvent({
    actor,
    role,
    action: 'SEND_COMPLETED',
    doc_id: doc.doc_id,
    version: doc.version,
    doc_title: doc.title,
    patient_id,
    patient_context: patient ? `${patient.name} (${patient.patient_stage})` : 'General Patient',
    status: 'APPROVED',
    gate_result: 'PASS',
    details: `Successfully dispatched approved v${doc.version} to patient ${patient_id}.`
  });

  res.json({
    success: true,
    blocked: false,
    receipt: {
      eventId: event.event_id,
      timestamp: event.timestamp,
      document: { id: doc.doc_id, version: doc.version, title: doc.title },
      patient: patient ? { id: patient.patient_id, name: patient.name } : { id: patient_id },
      actor: { name: actor, role },
      message: `Document ${doc.doc_id} v${doc.version} safely delivered and recorded in audit ledger.`
    }
  });
});

// 6. Grounded Staff Q&A
app.post('/api/qa', (req, res) => {
  const { query, role = 'dietitian' } = req.body;
  if (!query) return res.status(400).json({ error: 'Query is required' });

  const answer = rightDocEngine.answerStaffQuery({ query, role });
  res.json(answer);
});

// 7. Synthetic Patients API
app.get('/api/patients', (req, res) => {
  res.json({ patients });
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

// Start Server
app.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`  VERITY PRACTICE SERVER RUNNING ON http://localhost:${PORT}`);
  console.log(`  Thesis: "One approved truth, in every channel."`);
  console.log(`  Features: Right Doc & Send Check`);
  console.log(`======================================================\n`);
});
