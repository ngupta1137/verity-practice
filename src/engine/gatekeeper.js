// Verity Practice: Send Check Gatekeeper Engine
// Feature: Send Check (Deterministic Pre-Send Verification)

export function validateSendCheck({
  document,
  allDocuments = [],
  patient = null,
  patientContext = null,
  actor = 'Elena Gomez, RD',
  role = 'dietitian',
  asOfDate = new Date().toISOString().split('T')[0]
}) {
  const asOf = new Date(asOfDate);
  const blocks = [];
  const warnings = [];
  const passes = [];

  if (!document) {
    return {
      allowed: false,
      gateResult: 'FAIL',
      reason: 'No document specified for Send Check.',
      blocks: ['Document not found in registry.'],
      warnings: [],
      passes: []
    };
  }

  // 1. Audience Gate: Internal-only cannot go to patients
  if (document.audience === 'internal') {
    blocks.push({
      code: 'INTERNAL_AUDIENCE_PROHIBITED',
      message: `BLOCKED: "${document.title}" is marked for INTERNAL CLINICAL USE ONLY. Staff SOPs and internal escalation protocols cannot be distributed to patients.`
    });
  } else {
    passes.push({ code: 'AUDIENCE_VALID', message: 'Document audience is approved for patient delivery.' });
  }

  // 2. Status Gate: Must be 'approved'
  if (document.status === 'draft') {
    blocks.push({
      code: 'STATUS_DRAFT',
      message: `BLOCKED: Document status is DRAFT (v${document.version}). Only APPROVED documents may be given to patients.`
    });
  } else if (document.status === 'retired') {
    blocks.push({
      code: 'STATUS_RETIRED',
      message: `BLOCKED: Document is RETIRED. ${document.retired_reason || 'Archived by Clinical Director'}. Never distribute retired materials.`
    });
  } else if (document.status === 'approved') {
    passes.push({ code: 'STATUS_APPROVED', message: 'Document status is APPROVED.' });
  } else {
    blocks.push({
      code: 'STATUS_UNKNOWN',
      message: `BLOCKED: Document has invalid or unknown status "${document.status}".`
    });
  }

  // 3. Version Lineage Gate: Check if superseded
  const newerApproved = allDocuments.find(d => 
    (d.doc_id === document.doc_id && d.version > document.version && d.status === 'approved') ||
    (document.superseded_by && d.doc_id === document.superseded_by && d.status === 'approved' && (!document.superseded_version || d.version >= document.superseded_version))
  );

  if (document.superseded_by || newerApproved) {
    const latestDoc = newerApproved || allDocuments.find(d => d.doc_id === document.superseded_by && d.status === 'approved');
    blocks.push({
      code: 'VERSION_SUPERSEDED',
      message: `BLOCKED: Version v${document.version} is superseded. Current approved version is v${latestDoc ? latestDoc.version : 'latest'} (${latestDoc ? latestDoc.title : document.superseded_by}).`,
      currentVersion: latestDoc ? latestDoc.version : null,
      currentDocId: latestDoc ? latestDoc.doc_id : document.superseded_by
    });
  } else {
    passes.push({ code: 'VERSION_LATEST', message: `Document is the latest approved version (v${document.version}).` });
  }

  // 4. Staleness / Expiration Gate: Check review_by date
  if (document.review_by) {
    const reviewDate = new Date(document.review_by);
    if (reviewDate < asOf) {
      blocks.push({
        code: 'REVIEW_EXPIRED',
        message: `BLOCKED: Document expired on ${document.review_by} and is overdue for clinical review. Locked until re-approved by Clinical Director.`
      });
    } else {
      const daysUntilExpiry = Math.ceil((reviewDate - asOf) / (1000 * 60 * 60 * 24));
      if (daysUntilExpiry <= 30) {
        warnings.push({
          code: 'REVIEW_DUE_SOON',
          message: `ADVISORY: Document review date is approaching in ${daysUntilExpiry} days (${document.review_by}). Consider scheduling re-approval.`
        });
      }
      passes.push({ code: 'REVIEW_DATE_VALID', message: `Document review date is valid through ${document.review_by}.` });
    }
  }

  // 5. Patient Stage & Condition Compatibility Gate
  const patientStage = patient?.patient_stage || patientContext?.stage;
  const patientProgram = patient?.program || patientContext?.program;
  const patientCondition = patient?.condition || patientContext?.condition;

  if (patientStage && document.patient_stage) {
    const isStageCompatible = checkStageCompatibility(document.patient_stage, patientStage);
    if (!isStageCompatible.compatible) {
      if (isStageCompatible.severity === 'BLOCK') {
        blocks.push({
          code: 'STAGE_MISMATCH',
          message: `BLOCKED: Clinical Stage Mismatch. Patient is at "${patientStage}", but handout is calibrated for "${document.patient_stage}". ${isStageCompatible.reason}`
        });
      } else {
        warnings.push({
          code: 'STAGE_ADVISORY',
          message: `WARNING: Patient stage "${patientStage}" differs from handout target "${document.patient_stage}". ${isStageCompatible.reason}`
        });
      }
    } else {
      passes.push({ code: 'STAGE_COMPATIBLE', message: `Handout stage ("${document.patient_stage}") matches patient stage.` });
    }
  }

  // 6. Active Conflict Advisory
  if (document.doc_id === 'DOC-GEST-001' || document.doc_id === 'DOC-GEST-002') {
    warnings.push({
      code: 'ACTIVE_CLINICAL_CONFLICT',
      message: 'CLINICAL ADVISORY: This document has an active guideline divergence with partner gestational handout (DOC-GEST-001 30g ceiling vs DOC-GEST-002 45g minimum). Confirm clinical judgment.'
    });
  }

  const allowed = blocks.length === 0;

  return {
    allowed,
    gateResult: allowed ? 'PASS' : 'FAIL',
    status: allowed ? (warnings.length > 0 ? 'APPROVED_WITH_WARNINGS' : 'APPROVED') : 'BLOCKED',
    documentId: document.doc_id,
    version: document.version,
    title: document.title,
    blocks,
    warnings,
    passes,
    summary: allowed
      ? (warnings.length > 0 
          ? `Send Check passed with ${warnings.length} advisory notice(s). Document may be given to patient.`
          : 'Send Check passed: Document is the latest approved version, valid review date, and stage compatible.')
      : `Send Check BLOCKED delivery: ${blocks.map(b => b.message).join(' | ')}`
  };
}

function checkStageCompatibility(docStage, patStage) {
  const d = docStage.toLowerCase();
  const p = patStage.toLowerCase();

  // Bariatric Stage Mismatches
  if (p.includes('week 1') || p.includes('stage 1') || p.includes('clear liquids')) {
    if (d.includes('stage 2') || d.includes('pureed') || d.includes('stage 3') || d.includes('stage 4') || d.includes('solid')) {
      return {
        compatible: false,
        severity: 'BLOCK',
        reason: 'Severe medical safety hazard: Giving pureed or solid foods to a Week 1 clear-liquid patient risks pouch leak or acute anastomotic rupture.'
      };
    }
  }

  if (p.includes('week 2') || p.includes('stage 2') || p.includes('pureed')) {
    if (d.includes('stage 4') || d.includes('solid foods')) {
      return {
        compatible: false,
        severity: 'BLOCK',
        reason: 'Stage mismatch: Solid foods cannot be ingested during pureed recovery stage.'
      };
    }
    if (d.includes('stage 1: clear liquids')) {
      return {
        compatible: false,
        severity: 'WARN',
        reason: 'Patient is already on purees; Stage 1 clear liquids handout is from earlier recovery week.'
      };
    }
  }

  return { compatible: true };
}
