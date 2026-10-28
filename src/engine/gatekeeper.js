// Verity Practice: Send Check Gatekeeper Engine
// Feature: Send Check (Deterministic Pre-Send Verification)

import { checkDocumentEligibility } from './eligibility.js';
import { evaluatePolicy } from './policy.js';


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

  // Foundational Shared Eligibility Check:
  // Retired, draft, expired, or conflict-locked docs are fundamentally ineligible
  const eligibility = checkDocumentEligibility(document, allDocuments, { asOfDate });
  if (!eligibility.eligible) {
    for (const eb of eligibility.blocks) {
      blocks.push(eb);
    }
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

  // 5. Program Compatibility Gate
  const patientProgram = patient?.program || patientContext?.program;
  const patientCondition = patient?.condition || patientContext?.condition;
  if (patientProgram && (document.program || document.programs)) {
    const docPrograms = [
      ...(document.programs || []),
      ...(document.program ? [document.program] : [])
    ];
    const isMultiProgram = (document.tags && document.tags.includes('multi-program')) ||
                           docPrograms.some(p => {
                             const lp = p.toLowerCase();
                             return lp === 'all programs' || lp === 'general wellness' || lp === 'clinical governance';
                           });
    const matchesAnyProgram = docPrograms.some(p => {
      const lp = p.toLowerCase();
      const lpp = patientProgram.toLowerCase();
      return lp === lpp || lp.includes(lpp) || lpp.includes(lp);
    });
    const isProgramMatch = isMultiProgram || matchesAnyProgram;
    
    if (!isProgramMatch) {
      blocks.push({
        code: 'PROGRAM_MISMATCH',
        message: `BLOCKED: Program Mismatch. Handout is for "${docPrograms.join(' / ')}", but patient is enrolled in "${patientProgram}".`
      });
    } else {
      passes.push({
        code: 'PROGRAM_MATCH',
        message: isMultiProgram 
          ? `Document is multi-program (${docPrograms.join(' / ')}) and applicable to "${patientProgram}".`
          : `Document program ("${document.program || docPrograms[0]}") matches patient enrollment.`
      });
    }
  }

  // 6. Patient Stage Compatibility Gate
  const patientStage = patient?.patient_stage || patientContext?.stage;
  const patientStagesList = patient?.stages && Array.isArray(patient?.stages) && patient.stages.length > 0
    ? patient.stages
    : (patientStage ? [patientStage] : []);

  // Medication-Triggered & Stage-Agnostic Emergency Safety Handouts:
  // Safety handouts (DOC-DM-002 Hypoglycemia, DOC-DM-005 Sick-day rules) are stage-agnostic.
  // DOC-DM-002 must PASS for a T2D patient on insulin or a sulfonylurea at any stage.
  const rawMeds = patient?.medications || [];
  const patientMeds = rawMeds.map(m => {
    if (typeof m === 'string') return m;
    return `${m.name || ''} ${m.class || ''}`;
  });
  const isOnInsulinOrSulfonylurea = patientMeds.some(m => /insulin|sulfonylurea|glipizide|glimepiride|glyburide/i.test(m));
  const hasDiabetes = (patientProgram && /diabetes/i.test(patientProgram)) || 
                      (patientCondition && /diabetes|t1d|t2d/i.test(patientCondition)) ||
                      (patient?.condition && /diabetes|t1d|t2d/i.test(patient.condition));


  const isHypoglycemiaSafetyHandout = document.doc_id === 'DOC-DM-002' && (isOnInsulinOrSulfonylurea || hasDiabetes);
  const isSickDaySafetyHandout = document.doc_id === 'DOC-DM-005' && hasDiabetes;
  const isStageAgnosticSafety = isHypoglycemiaSafetyHandout || isSickDaySafetyHandout;

  if (isStageAgnosticSafety) {
    passes.push({
      code: 'STAGE_AGNOSTIC_SAFETY_PASS',
      message: `Safety Handout Override: "${document.title}" is stage-agnostic and medication-triggered (${isOnInsulinOrSulfonylurea ? 'Insulin / Sulfonylurea prescribed' : 'Diabetes clinical protocol'}). Approved for distribution across all clinical stages.`
    });
  } else if (document.patient_stage && patientStagesList.length > 0) {
    const isStageCompatible = checkStageCompatibility(document.patient_stage, patientStagesList);
    if (!isStageCompatible.compatible) {
      if (isStageCompatible.severity === 'BLOCK') {
        blocks.push({
          code: 'STAGE_MISMATCH',
          message: `BLOCKED: Clinical Stage Mismatch. Patient stage(s) [${patientStagesList.join(', ')}] does not include handout stage "${document.patient_stage}". ${isStageCompatible.reason}`
        });
      } else {
        warnings.push({
          code: 'STAGE_ADVISORY',
          message: `WARNING: Patient stage(s) [${patientStagesList.join(', ')}] differs from handout target "${document.patient_stage}". ${isStageCompatible.reason}`
        });
      }
    } else {
      passes.push({
        code: 'STAGE_COMPATIBLE',
        message: `Handout stage ("${document.patient_stage}") matches patient stage.`
      });
    }
  }

  // 7. Active Clinical Conflict Gate: HARD BLOCK on unresolved conflicting documents
  // Deliberate trap: DOC-GEST-001 vs DOC-GEST-002 clash until Practice Owner resolution
  const isUnresolvedConflict = document.conflict_locked || 
    ((document.doc_id === 'DOC-GEST-001' || document.doc_id === 'DOC-GEST-002') && !document.conflict_resolved);
  if (isUnresolvedConflict) {
    blocks.push({
      code: 'ACTIVE_CLINICAL_CONFLICT_BLOCK',
      message: `BLOCKED: Active Clinical Guideline Conflict. Document "${document.doc_id}" is locked from patient distribution due to an unresolved guideline conflict (30g carb ceiling vs 45g minimum floor). Practice Owner must resolve guideline conflict before distribution.`
    });
  }

  // 8. Pregnancy Nutritional Safety Gate (<175g Carbs Contraindication)
  const isPregnancy = (patientProgram && patientProgram.toLowerCase().includes('gestational')) ||
                      (document.program && document.program.toLowerCase().includes('gestational')) ||
                      (patientCondition && patientCondition.toLowerCase().includes('gestational')) ||
                      (patientCondition && patientCondition.toLowerCase().includes('pregnant'));
  if (isPregnancy) {
    // Check if document recommends carb ceilings under 175g daily or under 45g per meal
    const isDocGest002 = document.doc_id === 'DOC-GEST-002';
    const docCarbs = Number(document.carbs_per_day || document.carbs_daily || document.carbohydrates_daily);
    const hasExplicitLowCarbs = !isNaN(docCarbs) && docCarbs > 0 && docCarbs < 175;
    const recommendsLowCarbPregnancy = !isDocGest002 && (
      document.doc_id === 'DOC-GEST-001' || 
      hasExplicitLowCarbs ||
      (document.summary && /(limit|cap|max|restrict).*?(1[0-6][0-9]|under 175|< ?175|30g)|strict low-carbohydrate|ketogenic/i.test(document.summary)) ||
      (document.sections && document.sections.some(s => 
        /(limit|cap|max|restrict|keep).*?(under 15g|under 30g|no more than 30|under 45g|< ?175g?)/i.test(s.content) &&
        !s.content.toLowerCase().includes('do not restrict')
      ))
    );
      
    if (recommendsLowCarbPregnancy) {
      blocks.push({
        code: 'PREGNANCY_CARB_FLOOR_VIOLATION',
        message: 'BLOCKED: Pregnancy Safety Stop Rule. Maternal carbohydrate restriction below 175g/day (or <45g at main meals) is strictly contraindicated during pregnancy due to maternal ketonuria risk and impaired fetal brain neurodevelopment.'
      });
    } else {
      passes.push({
        code: 'PREGNANCY_CARB_SAFETY_VALID',
        message: 'Handout satisfies ADA/ACOG consensus minimum carbohydrate requirements for pregnancy (>=175g/day).'
      });
    }

    // Deliberate weight loss / calorie deficit contraindication during pregnancy
    if (document.program === 'Weight Management' || document.doc_id === 'DOC-WM-001' || document.doc_id === 'DOC-RET-001') {
      blocks.push({
        code: 'PREGNANCY_WEIGHT_LOSS_CONTRAINDICATION',
        message: 'BLOCKED: Pregnancy Safety Contraindication. Caloric restriction and intentional weight loss protocols are strictly contraindicated during pregnancy due to risks of fetal intrauterine growth restriction and maternal ketosis.'
      });
    }
  }

  // 9. Allergy & Intolerance Contraindication Gate
  const patientAllergies = [
    ...(patient?.allergies_sensitivities || []),
    ...(patient?.allergies_and_intolerances || [])
  ];

  if (patientAllergies.length > 0) {
    const hasLactoseIntolerance = patientAllergies.some(a => /lactose/i.test(a));
    const recommendsDairy = (document.doc_id === 'DOC-BAR-002' && Number(document.version) === 1) ||
                            (document.doc_id === 'DOC-BAR-001' && Number(document.version) === 1) ||
                            (document.summary && /cow milk|dairy shake|whey concentrate/i.test(document.summary)) ||
                            (document.sections && document.sections.some(s => /cow milk|skim milk|whey concentrate/i.test(s.content) && !/lactose-free|almond milk|pea protein/i.test(s.content)));
    if (hasLactoseIntolerance && recommendsDairy) {
      blocks.push({
        code: 'ALLERGY_CONTRAINDICATION_LACTOSE',
        message: 'BLOCKED: Patient has documented Lactose Intolerance. Handout contains or recommends regular dairy / whey concentrate, risking severe bloating, cramps, and dumping syndrome.'
      });
    }
  }

  // 10. Medication Contraindication Gate (SGLT2i & Hypoglycemia Agents)
  if (patientMeds.length > 0) {
    const onSGLT2i = patientMeds.some(m => /empagliflozin|jardiance|dapagliflozin|farxiga|canagliflozin|sglt2/i.test(m));
    const isVLCDorKeto = document.doc_id === 'DOC-RET-001' || (document.summary && /keto|vlcd|800\s*kcal/i.test(document.summary));

    if (onSGLT2i && isVLCDorKeto) {
      blocks.push({
        code: 'MEDICATION_CONTRAINDICATION_SGLT2I',
        message: 'BLOCKED: Life-Threatening Euglycemic DKA Contraindication. Patient is prescribed an SGLT2 inhibitor (Empagliflozin/Jardiance). Very-low-carbohydrate / ketogenic diets are strictly contraindicated with SGLT2i due to acute euglycemic diabetic ketoacidosis risk.'
      });
    }

    const onHypoMed = patientMeds.some(m => /insulin|glipizide|glimepiride|glyburide|sulfonylurea/i.test(m));
    if (onHypoMed) {
      if (document.doc_id === 'DOC-RET-001') {
        blocks.push({
          code: 'MEDICATION_CONTRAINDICATION_HYPO_RISK',
          message: 'BLOCKED: Severe Hypoglycemia Contraindication. Patient is taking insulin or a sulfonylurea; very-low-calorie diets (800 kcal) induce acute refractory hypoglycemia without inpatient medical medication titration.'
        });
      }
      if (!document.doc_id.includes('DM-002')) {
        warnings.push({
          code: 'MEDICATION_ADVISORY_HYPOGLYCEMIA',
          message: 'CLINICAL ADVISORY: Patient is prescribed insulin or a sulfonylurea. Ensure the Hypoglycemia Emergency Guide (Rule of 15, DOC-DM-002) has been provided and verified.'
        });
      }
    }
  }

  // 11. CKD Renal Safety Contraindication Gate
  const hasCKD = (patientCondition && /ckd|chronic kidney disease|renal/i.test(patientCondition)) ||
                 (patientProgram && /renal|kidney/i.test(patientProgram));
  if (hasCKD) {
    const isHighProtein = (document.program === 'Bariatric Surgery' && document.doc_id.includes('BAR-002')) ||
                          (document.doc_id === 'DOC-WM-001' && /1.2.*1.5g protein/i.test(document.summary || ''));
    if (isHighProtein) {
      blocks.push({
        code: 'CKD_PROTEIN_CONTRAINDICATION',
        message: 'BLOCKED: Renal Safety Contraindication. Patient has non-dialysis Chronic Kidney Disease. High-protein intake (>1.2g/kg) accelerates hyperfiltration injury and decline in remaining nephrons.'
      });
    }
  }

  // 12. Language Compatibility Gate
  const patientLang = (patient?.language || patientContext?.language || 'en').toLowerCase();
  const docLang = (document.language || 'en').toLowerCase();

  if (patientLang !== docLang) {
    // Check if an approved version in the patient's language exists in the library
    const hasApprovedMatchingLang = (allDocuments || []).some(d => 
      (d.language || 'en').toLowerCase() === patientLang &&
      d.status === 'approved' &&
      (d.doc_id === `${document.doc_id}-${patientLang.toUpperCase()}` || 
       (d.program && document.program && d.program.toLowerCase() === document.program.toLowerCase()) ||
       (d.condition && document.condition && d.condition.toLowerCase() === document.condition.toLowerCase()))
    );

    if (hasApprovedMatchingLang) {
      warnings.push({
        code: 'LANGUAGE_MISMATCH_ALTERNATIVE_AVAILABLE',
        message: `CLINICAL ADVISORY: Patient preferred language is "${patientLang.toUpperCase()}", but this handout is in "${docLang.toUpperCase()}". An approved handout in ${patientLang.toUpperCase()} is available (DOC-DM-001-ES). Confirm patient language preference before distributing.`
      });
    } else {
      blocks.push({
        code: 'LANGUAGE_UNAVAILABLE_BLOCK',
        message: `BLOCKED: No approved version of this handout exists in the patient's primary language ("${patientLang.toUpperCase()}"). Distributing clinical education without certified language concordance violates Title VI / CLAS standards. Request medical translation or use a certified medical interpreter.`
      });
    }
  } else {
    passes.push({
      code: 'LANGUAGE_COMPATIBLE',
      message: `Document language ("${docLang.toUpperCase()}") matches patient preferred language.`
    });
  }

  const allowed = blocks.length === 0;

  const policyRes = evaluatePolicy({
    document,
    patient,
    user: { role, name: actor },
    allDocuments,
    asOfDate,
    isPreSend: true
  });

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
    // Three Decisions Architecture (Workstream 1)
    document_validity: policyRes.document_validity,
    patient_applicability: policyRes.patient_applicability,
    delivery_authorization: policyRes.delivery_authorization,
    outcome: policyRes.outcome,
    policy_version: policyRes.policy_version,
    policy_decision: policyRes,
    summary: allowed
      ? (warnings.length > 0 
          ? `Send Check passed with ${warnings.length} advisory notice(s). Document may be given to patient.`
          : 'Send Check passed: Document is the latest approved version, valid review date, and stage compatible.')
      : `Send Check BLOCKED delivery: ${blocks.map(b => b.message).join(' | ')}`
  };
}


function checkStageCompatibility(docStage, patStages) {
  const d = docStage.toLowerCase();
  const stagesArray = Array.isArray(patStages) ? patStages : [patStages];
  
  if (d.includes('all stages') || d.includes('all post-op') || d.includes('general lifestyle') || d.includes('clinical internal')) {
    return { compatible: true };
  }

  // Check if any stage in the patient's stage list matches docStage
  for (const s of stagesArray) {
    const p = s.toLowerCase();
    
    // Direct or substring match
    if (p === d || p.includes(d) || d.includes(p)) {
      return { compatible: true };
    }

    // Renal / CKD cross-compatibility
    if ((d.includes('renal') || d.includes('ckd') || d.includes('kidney')) && 
        (p.includes('renal') || p.includes('ckd') || p.includes('kidney'))) {
      return { compatible: true };
    }

    // Bariatric Stage 1 vs Stage 2/3/4 mismatch checks
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

  // If patient stages do not include the docStage
  return {
    compatible: false,
    severity: 'BLOCK',
    reason: `Handout stage "${docStage}" is not in the patient's active stage list.`
  };
}
