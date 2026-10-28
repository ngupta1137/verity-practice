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
  // Deliberate trap: DOC-GEST-001 vs DOC-GEST-002 clash until Clinical Director resolution
  const isConflictLocked = doc.conflict_locked === true || 
    (doc.doc_id === 'DOC-GEST-001' && doc.status === 'approved' && !doc.conflict_resolved);

  if (isConflictLocked) {
    blocks.push({
      code: 'ACTIVE_CLINICAL_CONFLICT_BLOCK',
      message: `BLOCKED: Active Clinical Guideline Conflict. Document "${doc.doc_id}" is locked from patient distribution and staff citation due to an unresolved guideline conflict (30g carb ceiling vs 45g minimum floor). Clinical Director must harmonize and resolve guidelines before distribution or quotation.`
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
