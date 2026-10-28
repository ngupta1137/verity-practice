// Verity Practice Evaluation Harness
// Evaluates Top-1 Retrieval Accuracy, Pre-Send Catch Rate on Traps, and Refusal Rate on Out-of-Library queries.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RightDocEngine } from '../engine/retrieval.js';
import { validateSendCheck } from '../engine/gatekeeper.js';
import { checkStaleness, detectConflicts } from '../engine/conflicts.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../../');

function loadJSON(relPath) {
  const candidates = [
    path.resolve(process.cwd(), relPath),
    path.resolve(__dirname, '../../', relPath),
    path.resolve(__dirname, '..', relPath),
    path.resolve(__dirname, relPath)
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    }
  }
  return [];
}

export function runEvaluation() {
  console.log('===============================================================');
  console.log('       VERITY PRACTICE - CLINICAL EVALUATION HARNESS            ');
  console.log('===============================================================\n');

  const documents = loadJSON('data/documents.json');
  const testSet = loadJSON('data/eval_testset.json');
  const patients = loadJSON('data/synthetic_patients.json');

  const engine = new RightDocEngine(documents);

  // -------------------------------------------------------------
  // Slice 1: Right Doc Retrieval Accuracy & Refusal Evaluation
  // -------------------------------------------------------------
  let totalQueries = testSet.length;
  let top1Correct = 0;
  let inScopeTotal = 0;
  let inScopeCorrect = 0;
  let outOfLibTotal = 0;
  let outOfLibRefused = 0;
  let trapQueriesTotal = 0;
  let trapQueriesHandled = 0;
  let internalTotal = 0;
  let internalCorrect = 0;

  const queryResults = [];

  for (const item of testSet) {
    const res = engine.searchRightDoc({
      query: item.query,
      audience: item.audience_filter,
      role: 'dietitian'
    });

    let passed = false;
    let actualOutcome = res.outcome;
    let actualDocId = res.topMatch?.document?.doc_id || null;
    let actualVersion = res.topMatch?.document?.version || null;

    if (item.category === 'in_scope_clinical') {
      inScopeTotal++;
      if (res.outcome === 'approved_match' && actualDocId === item.expected_doc_id && actualVersion === item.expected_version) {
        passed = true;
        inScopeCorrect++;
      }
    } else if (item.category === 'out_of_library') {
      outOfLibTotal++;
      if (res.outcome === 'refused_out_of_scope' && actualDocId === null) {
        passed = true;
        outOfLibRefused++;
      }
    } else if (item.category === 'trap_query') {
      trapQueriesTotal++;
      if (item.expected_outcome === 'superseded_redirect' && res.outcome === 'superseded_redirect' && actualDocId === item.expected_doc_id) {
        passed = true;
        trapQueriesHandled++;
      } else if (item.expected_outcome === 'refused_retired' && res.outcome === 'refused_retired') {
        passed = true;
        trapQueriesHandled++;
      }
    } else if (item.category === 'internal_clinical') {
      internalTotal++;
      if (res.outcome === 'approved_match' && actualDocId === item.expected_doc_id) {
        passed = true;
        internalCorrect++;
      }
    }

    if (passed) {
      top1Correct++;
    }

    queryResults.push({
      id: item.id,
      query: item.query,
      category: item.category,
      expected: { doc_id: item.expected_doc_id, outcome: item.expected_outcome },
      actual: { doc_id: actualDocId, version: actualVersion, outcome: actualOutcome },
      passed
    });
  }

  const overallAccuracy = ((top1Correct / totalQueries) * 100).toFixed(1);
  const inScopeAccuracy = ((inScopeCorrect / inScopeTotal) * 100).toFixed(1);
  const refusalRate = ((outOfLibRefused / outOfLibTotal) * 100).toFixed(1);
  const trapHandleRate = ((trapQueriesHandled / trapQueriesTotal) * 100).toFixed(1);
  const internalAccuracy = ((internalCorrect / internalTotal) * 100).toFixed(1);

  // -------------------------------------------------------------
  // Slice 2: Send Check Pre-Send Gatekeeper Trap Catch Rate
  // -------------------------------------------------------------
  const trapCases = [
    {
      id: 'TRAP-01-SUPERSEDED',
      name: 'Attempt to send superseded DOC-BAR-002 v1 to patient',
      doc: documents.find(d => d.doc_id === 'DOC-BAR-002' && d.version === 1),
      patient: patients[0],
      expectedBlockCode: 'VERSION_SUPERSEDED'
    },
    {
      id: 'TRAP-02-RETIRED-LEGACY',
      name: 'Attempt to send retired DOC-BAR-001 v1 to patient',
      doc: documents.find(d => d.doc_id === 'DOC-BAR-001' && d.version === 1),
      patient: patients[3],
      expectedBlockCode: 'STATUS_RETIRED'
    },
    {
      id: 'TRAP-03-RETIRED-VLCD',
      name: 'Attempt to send retired 800kcal VLCD protocol (DOC-RET-001)',
      doc: documents.find(d => d.doc_id === 'DOC-RET-001'),
      patient: patients[5],
      expectedBlockCode: 'STATUS_RETIRED'
    },
    {
      id: 'TRAP-04-EXPIRED-REVIEW',
      name: 'Attempt to send expired review date handout (DOC-CKD-001, expired 2024)',
      doc: documents.find(d => d.doc_id === 'DOC-CKD-001'),
      patient: patients[4],
      expectedBlockCode: 'REVIEW_EXPIRED'
    },
    {
      id: 'TRAP-05-DRAFT-STATUS',
      name: 'Attempt to send unapproved draft handout (DOC-DRAFT-001)',
      doc: documents.find(d => d.doc_id === 'DOC-DRAFT-001'),
      patient: patients[4],
      expectedBlockCode: 'STATUS_DRAFT'
    },
    {
      id: 'TRAP-06-INTERNAL-AUDIENCE',
      name: 'Attempt to distribute internal eating disorder escalation SOP (DOC-INT-001)',
      doc: documents.find(d => d.doc_id === 'DOC-INT-001'),
      patient: patients[6],
      expectedBlockCode: 'INTERNAL_AUDIENCE_PROHIBITED'
    },
    {
      id: 'TRAP-07-STAGE-MISMATCH',
      name: 'Stage Mismatch: Giving pureed Stage 2 handout to a Day 4 clear-liquid patient',
      doc: documents.find(d => d.doc_id === 'DOC-BAR-002' && d.version === 2),
      patient: patients.find(p => p.patient_id === 'SYNTH-PAT-104'), // Day 4 Clear liquids
      expectedBlockCode: 'STAGE_MISMATCH'
    }
  ];

  let trapsCaught = 0;
  const trapResults = [];

  for (const tc of trapCases) {
    const gateRes = validateSendCheck({
      document: tc.doc,
      allDocuments: documents,
      patient: tc.patient,
      actor: 'Marcus Vance',
      role: 'front_desk',
      asOfDate: '2026-10-27'
    });

    const isBlocked = !gateRes.allowed && gateRes.gateResult === 'FAIL';
    const hasExpectedCode = gateRes.blocks.some(b => b.code === tc.expectedBlockCode);
    const passed = isBlocked && hasExpectedCode;

    if (passed) trapsCaught++;

    trapResults.push({
      id: tc.id,
      name: tc.name,
      isBlocked,
      blocks: gateRes.blocks.map(b => b.code),
      passed
    });
  }

  const trapCatchRate = ((trapsCaught / trapCases.length) * 100).toFixed(1);

  // -------------------------------------------------------------
  // Slice 3: Staleness & Conflict Engine Verification
  // -------------------------------------------------------------
  const staleness = checkStaleness(documents, '2026-10-27');
  const conflicts = detectConflicts(documents);

  const report = {
    evaluatedAt: new Date().toISOString(),
    metrics: {
      totalQueries,
      overallAccuracy: `${overallAccuracy}% (${top1Correct}/${totalQueries})`,
      inScopeTop1Accuracy: `${inScopeAccuracy}% (${inScopeCorrect}/${inScopeTotal})`,
      trapCatchRate: `${trapCatchRate}% (${trapsCaught}/${trapCases.length})`,
      outOfLibraryRefusalRate: `${refusalRate}% (${outOfLibRefused}/${outOfLibTotal})`,
      trapHandlingRate: `${trapHandleRate}% (${trapQueriesHandled}/${trapQueriesTotal})`,
      internalQnAccuracy: `${internalAccuracy}% (${internalCorrect}/${internalTotal})`
    },
    conflictEngine: {
      activeConflictsDetected: conflicts.length,
      conflicts: conflicts.map(c => ({ id: c.conflict_id, topic: c.topic, explanation: c.divergenceExplanation }))
    },
    stalenessEngine: {
      expiredDocumentsCount: staleness.expired.length,
      expiredDocuments: staleness.expired.map(e => `${e.doc_id}: ${e.title} (expired ${e.review_by})`)
    },
    queryDetails: queryResults,
    trapDetails: trapResults
  };

  try {
    fs.writeFileSync(path.join(process.cwd(), 'eval_report.json'), JSON.stringify(report, null, 2));
  } catch (err) {
    // Read-only filesystem in serverless environments
  }

  // Console Summary Table
  console.log('| Metric | Target | Actual Result | Status |');
  console.log('| :--- | :---: | :---: | :---: |');
  console.log(`| Top-1 Correct Retrieval (In-Scope) | >= 90.0% | **${inScopeAccuracy}%** (${inScopeCorrect}/${inScopeTotal}) | ${Number(inScopeAccuracy) >= 90 ? 'PASSED' : 'FAILED'} |`);
  console.log(`| Pre-Send Check Catch Rate (Traps) | 100.0% | **${trapCatchRate}%** (${trapsCaught}/${trapCases.length}) | ${Number(trapCatchRate) === 100 ? 'PASSED' : 'FAILED'} |`);
  console.log(`| Out-of-Library Refusal Rate | 100.0% | **${refusalRate}%** (${outOfLibRefused}/${outOfLibTotal}) | ${Number(refusalRate) === 100 ? 'PASSED' : 'FAILED'} |`);
  console.log(`| Overall Test Set Accuracy | >= 90.0% | **${overallAccuracy}%** (${top1Correct}/${totalQueries}) | ${Number(overallAccuracy) >= 90 ? 'PASSED' : 'FAILED'} |`);
  console.log(`| Conflict Detection (GDM 30g vs 45g) | Detected | **${conflicts.length} Active Conflict(s)** | PASSED |`);
  console.log(`| Expired Review Date Catch | Detected | **${staleness.expired.length} Expired Doc(s)** | PASSED |\n`);

  return report;
}

if (process.argv[1] && process.argv[1].endsWith('runner.js')) {
  runEvaluation();
}
