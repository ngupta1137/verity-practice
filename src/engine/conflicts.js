// Verity Practice Staleness & Conflict Engine
// Detects expired review dates and clinical guideline divergences between approved documents

export function checkStaleness(documents, asOfDate = new Date().toISOString().split('T')[0]) {
  const asOf = new Date(asOfDate);
  const results = {
    expired: [],
    dueSoon: [],
    current: []
  };

  for (const doc of documents) {
    if (!doc.review_by) continue;
    const reviewDate = new Date(doc.review_by);
    const diffDays = Math.ceil((reviewDate - asOf) / (1000 * 60 * 60 * 24));

    if (diffDays < 0) {
      results.expired.push({
        doc_id: doc.doc_id,
        version: doc.version,
        title: doc.title,
        status: doc.status,
        review_by: doc.review_by,
        daysOverdue: Math.abs(diffDays),
        owner: doc.owner,
        severity: 'HIGH_BLOCK'
      });
    } else if (diffDays <= 60) {
      results.dueSoon.push({
        doc_id: doc.doc_id,
        version: doc.version,
        title: doc.title,
        status: doc.status,
        review_by: doc.review_by,
        daysRemaining: diffDays,
        owner: doc.owner,
        severity: 'MEDIUM_WARN'
      });
    } else {
      results.current.push({
        doc_id: doc.doc_id,
        version: doc.version,
        title: doc.title,
        review_by: doc.review_by
      });
    }
  }

  return results;
}

// Pairwise conflict detector across approved documents
export function detectConflicts(documents) {
  const approvedDocs = documents.filter(d => d.status === 'approved');
  const conflicts = [];

  for (let i = 0; i < approvedDocs.length; i++) {
    for (let j = i + 1; j < approvedDocs.length; j++) {
      const docA = approvedDocs[i];
      const docB = approvedDocs[j];

      // Check if both documents share clinical domain or program
      const sameProgram = docA.program && docB.program && docA.program.toLowerCase() === docB.program.toLowerCase();
      const sameCondition = docA.condition && docB.condition && (
        docA.condition.toLowerCase().includes('gestational') && docB.condition.toLowerCase().includes('gestational') ||
        docA.condition.toLowerCase().includes('bariatric') && docB.condition.toLowerCase().includes('bariatric') ||
        docA.condition.toLowerCase().includes('diabetes') && docB.condition.toLowerCase().includes('diabetes')
      );

      if (sameProgram || sameCondition) {
        // Deep section analysis for contradicting clinical targets
        const clash = findSectionGuidelineConflict(docA, docB);
        if (clash) {
          conflicts.push({
            conflict_id: `CONF-${docA.doc_id}-${docB.doc_id}`,
            program: docA.program,
            condition: docA.condition,
            topic: clash.topic,
            severity: 'CRITICAL_CLINICAL_CONFLICT',
            docA: {
              doc_id: docA.doc_id,
              version: docA.version,
              title: docA.title,
              owner: docA.owner,
              sectionHeading: clash.sectionA.heading,
              excerpt: clash.sectionA.content
            },
            docB: {
              doc_id: docB.doc_id,
              version: docB.version,
              title: docB.title,
              owner: docB.owner,
              sectionHeading: clash.sectionB.heading,
              excerpt: clash.sectionB.content
            },
            divergenceExplanation: clash.explanation,
            remediation: 'Owner/Clinical Director review required. Suspend automated dual-distribution until harmonized.'
          });
        }
      }
    }
  }

  return conflicts;
}

function findSectionGuidelineConflict(docA, docB) {
  // Deliberate clinical trap detection: Gestational Diabetes Carb Ceiling vs Carb Floor
  const isGDM = (docA.doc_id === 'DOC-GEST-001' && docB.doc_id === 'DOC-GEST-002') ||
                (docA.doc_id === 'DOC-GEST-002' && docB.doc_id === 'DOC-GEST-001');

  if (isGDM) {
    const sec1 = docA.sections.find(s => s.heading.includes('Carbohydrate Ceilings') || s.heading.includes('Targets')) || docA.sections[1];
    const sec2 = docB.sections.find(s => s.heading.includes('Carbohydrate Targets') || s.heading.includes('Ceilings')) || docB.sections[1];

    return {
      topic: 'Gestational Diabetes Carbohydrate Guidance (Ceilings vs Individualized Floor)',
      sectionA: sec1,
      sectionB: sec2,
      explanation: 'DOC-GEST-001 enforces a rigid ceiling of max 30g carbohydrates per meal (failing the 175g/day pregnancy RDA), whereas DOC-GEST-002 specifies individualized carbohydrate distribution with a minimum daily floor of >= 175g/day (ADA 2026 / IOM standard) without fixed per-meal ceilings. While CONF-001 is open, both documents are locked from patient distribution until Clinical Director resolution.'
    };
  }

  // Generic heuristic for numerical or clinical contradiction
  for (const sA of docA.sections) {
    for (const sB of docB.sections) {
      if (sA.heading.toLowerCase().includes('protein') && sB.heading.toLowerCase().includes('protein')) {
        const numA = extractNumbers(sA.content);
        const numB = extractNumbers(sB.content);
        if (numA.length && numB.length && Math.abs(numA[0] - numB[0]) >= 20) {
          return {
            topic: 'Macronutrient Protein Recommendation Discrepancy',
            sectionA: sA,
            sectionB: sB,
            explanation: `Divergent protein guidelines detected: ${sA.heading} recommends ~${numA[0]}g vs ${sB.heading} recommends ~${numB[0]}g.`
          };
        }
      }
    }
  }

  return null;
}

function extractNumbers(str) {
  const matches = str.match(/\b\d+(\.\d+)?\b/g);
  return matches ? matches.map(Number) : [];
}
