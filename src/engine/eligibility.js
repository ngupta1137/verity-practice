// Verity Practice: Shared Document Eligibility Engine
// Feature: Centralized eligibility check shared across Right Doc, Send Check, and Grounded Q&A.
// A document that is retired, draft, expired, or conflict-locked can NEVER be returned, sent, or quoted.

export function checkDocumentEligibility(doc, allDocuments = [], options = {}) {
  const asOfDate = options.asOfDate || '2026-10-27';
  const asOf = new Date(asOfDate);
  const blocks = [];

  if (!doc) {
    return {
      eligible: false,
      blocks: [{ code: 'DOC_NOT_FOUND', message: 'Document does not exist in practice library.' }]
    };
  }

  // 1. Status Check: Must be 'approved'
  if (doc.status === 'retired') {
    blocks.push({
      code: 'STATUS_RETIRED',
      message: `BLOCKED: Document is RETIRED. ${doc.retired_reason || 'Archived by Clinical Director'}. Never distribute or quote retired materials.`
    });
  } else if (doc.status === 'draft') {
    blocks.push({
      code: 'STATUS_DRAFT',
      message: `BLOCKED: Document status is DRAFT (v${doc.version}). Only APPROVED documents may be retrieved, sent, or quoted.`
    });
  } else if (doc.status !== 'approved') {
    blocks.push({
      code: 'STATUS_INVALID',
      message: `BLOCKED: Document has invalid or unapproved status "${doc.status}".`
    });
  }

  // 2. Version / Superseded Check:
  const newerApproved = (allDocuments || []).find(d => 
    (d.doc_id === doc.doc_id && Number(d.version) > Number(doc.version) && d.status === 'approved') ||
    (doc.superseded_by && d.doc_id === doc.superseded_by && d.status === 'approved' && (!doc.superseded_version || Number(d.version) >= Number(doc.superseded_version)))
  );
  if (newerApproved) {
    blocks.push({
      code: 'VERSION_SUPERSEDED',
      message: `BLOCKED: Version v${doc.version} is superseded. Current approved version is v${newerApproved.version} (${newerApproved.doc_id}).`,
      currentDocId: newerApproved.doc_id,
      currentVersion: newerApproved.version
    });
  }

  // 3. Staleness / Expiration Check:
  if (doc.review_by) {
    const reviewDate = new Date(doc.review_by);
    if (reviewDate < asOf) {
      blocks.push({
        code: 'REVIEW_EXPIRED',
        message: `BLOCKED: Document review date expired on ${doc.review_by} (current evaluation date ${asOfDate}). Expired documents cannot be retrieved, sent, or quoted.`
      });
    }
  }

  // 4. Clinical Conflict Lock Check:
  // While CONF-001 is open, both DOC-GEST-001 and DOC-GEST-002 are locked from patient distribution and staff citation
  const isConflictLocked = doc.conflict_locked === true || 
    ((doc.doc_id === 'DOC-GEST-001' || doc.doc_id === 'DOC-GEST-002') && doc.status === 'approved' && !doc.conflict_resolved);

  if (isConflictLocked) {
    blocks.push({
      code: 'ACTIVE_CLINICAL_CONFLICT_BLOCK',
      message: `BLOCKED: Active Clinical Guideline Conflict (CONF-001). Document "${doc.doc_id}" is locked from patient distribution and staff citation due to an unresolved guideline conflict (fixed 30g carb ceiling vs individualized >=175g/day pregnancy floor). Practice Owner must record a formal resolution before distribution or citation.`
    });
  }

  const eligible = blocks.length === 0;
  return {
    eligible,
    blocks
  };
}

export function isDocumentEligible(doc, allDocuments = [], options = {}) {
  return checkDocumentEligibility(doc, allDocuments, options).eligible;
}

export function getEligibleDocuments(allDocuments = [], options = {}) {
  return (allDocuments || []).filter(doc => isDocumentEligible(doc, allDocuments, options));
}

export function checkStageCompatibility(docStage, patStages) {
  if (!docStage) return { compatible: true };
  const d = docStage.toLowerCase();
  const stagesArray = Array.isArray(patStages) ? patStages : [patStages];
  
  if (d.includes('all stages') || d.includes('all post-op') || d.includes('general lifestyle') || d.includes('clinical internal')) {
    return { compatible: true };
  }

  for (const s of stagesArray) {
    if (!s) continue;
    const p = s.toLowerCase();
    
    if (p === d || p.includes(d) || d.includes(p)) {
      return { compatible: true };
    }

    const stageMatches = ['stage 1', 'stage 2', 'stage 3', 'stage 4'].some(num => d.includes(num) && p.includes(num));
    if (stageMatches) {
      return { compatible: true };
    }

    if ((d.includes('renal') || d.includes('ckd') || d.includes('kidney')) && 
        (p.includes('renal') || p.includes('ckd') || p.includes('kidney'))) {
      return { compatible: true };
    }

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
  }

  const isBariatric = d.includes('stage 1') || d.includes('stage 2') || d.includes('stage 3') || d.includes('stage 4') || d.includes('post-op') || d.includes('pureed') || d.includes('clear liquid') || d.includes('soft food');
  return {
    compatible: false,
    severity: isBariatric ? 'BLOCK' : 'WARN',
    reason: `Handout stage "${docStage}" is not in the patient's active stage list.`
  };
}
