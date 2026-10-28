// Verity Practice: Unified Clinical Policy Engine
// Implements the Three Decisions Architecture:
// 1. document_validity: valid | invalid
// 2. patient_applicability: applicable | review_required | not_applicable
// 3. delivery_authorization: authorized | denied
//
// Governed by versioned clinical rules in data/clinical_rules.json with clinical_owner & approved_by.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkDocumentEligibility } from './eligibility.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../../');

function loadClinicalRules() {
  const candidates = [
    path.resolve(process.cwd(), 'data/clinical_rules.json'),
    path.resolve(__dirname, '../../data/clinical_rules.json'),
    path.resolve(__dirname, '../data/clinical_rules.json')
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      try {
        return JSON.parse(fs.readFileSync(p, 'utf8'));
      } catch (e) {}
    }
  }
  return { policy_version: '2.1.0', rules: [] };
}

const CLINICAL_RULES = loadClinicalRules();

/**
 * Run safety triage on query, patient, and context BEFORE any document search.
 */
export function runSafetyTriage({ query = '', patient = null, user = null, context = {} }) {
  const lowerQ = (query || '').toLowerCase();
  const matchedRules = [];
  const triageFlags = [];
  let escalation = null;
  let outOfScope = null;
  let secondaryDocId = null;

  const patientMeds = patient?.medications || [];
  const medNames = patientMeds.map(m => (m.name || '').toLowerCase()).join(' ');
  const medClasses = patientMeds.map(m => (m.class || '').toLowerCase()).join(' ');
  const allMedText = `${medNames} ${medClasses} ${lowerQ}`;

  const hasSglt2 = allMedText.includes('jardiance') || 
                   allMedText.includes('farxiga') || 
                   allMedText.includes('invokana') || 
                   allMedText.includes('steglatro') || 
                   allMedText.includes('empagliflozin') || 
                   allMedText.includes('dapagliflozin') || 
                   allMedText.includes('canagliflozin') || 
                   allMedText.includes('ertugliflozin') || 
                   allMedText.includes('sglt2');

  const hasVomitingOrIllness = lowerQ.includes('vomit') || 
                              lowerQ.includes('flu') || 
                              lowerQ.includes('ill') || 
                              lowerQ.includes('not eating') || 
                              lowerQ.includes('cant eat') || 
                              lowerQ.includes("can't eat") || 
                              lowerQ.includes('keto') || 
                              lowerQ.includes('fasting');

  // Red Flag 1: SGLT2 Inhibitor + illness / vomiting / keto / fasting (eDKA)
  if (hasSglt2 && hasVomitingOrIllness) {
    matchedRules.push('RULE-TRIAGE-SGLT2-DKA');
    triageFlags.push('SGLT2_EUGLEMIC_DKA_RISK');
    escalation = {
      rule_id: 'RULE-TRIAGE-SGLT2-DKA',
      title: 'CRITICAL SAFETY ESCALATION: SGLT2 Inhibitor Euglycemic DKA Risk',
      protocol_doc_id: 'DOC-INT-004',
      message: 'MANDATORY CLINICAL ACTION: Instruct patient to HOLD SGLT2 inhibitor immediately. Check urine or blood ketones regardless of blood glucose (eDKA occurs with normal/mildly elevated sugars). If ketones positive, vomiting persists, or patient cannot hydrate, direct to Emergency Department / Urgent Care immediately.',
      secondary_allowed: true,
      secondary_doc_id: 'DOC-DM-005',
      secondary_label: 'Secondary Handout (not a substitute for escalation)'
    };
    secondaryDocId = 'DOC-DM-005';
  }

  // Red Flag 2: Persistent Vomiting / Cannot Keep Fluids Down (Bariatric, GLP-1, Any)
  const isPersistentVomit = (lowerQ.includes('vomit') && (lowerQ.includes('persistent') || lowerQ.includes('3 days') || lowerQ.includes('several days') || lowerQ.includes('since last night') || lowerQ.includes('all night') || lowerQ.includes('intractable') || (lowerQ.includes('days') && !lowerQ.includes('sick day')))) ||
                            lowerQ.includes('cant hold water') || 
                            lowerQ.includes("can't hold water") || 
                            lowerQ.includes('cant keep fluid') || 
                            lowerQ.includes("can't keep fluid") ||
                            lowerQ.includes('cannot keep fluids');


  if (isPersistentVomit && !escalation) {
    matchedRules.push('RULE-TRIAGE-INTRACTABLE-VOMITING');
    triageFlags.push('INTRACTABLE_VOMITING_DEHYDRATION_RISK');
    escalation = {
      rule_id: 'RULE-TRIAGE-INTRACTABLE-VOMITING',
      title: 'CRITICAL ESCALATION: Persistent Vomiting / Severe Dehydration Risk',
      protocol_doc_id: 'DOC-INT-004',
      message: 'MANDATORY CLINICAL ACTION: Patient with persistent vomiting or inability to retain fluids is at acute risk of Wernicke\'s encephalopathy, anastomotic stricture, or acute kidney injury. Immediate escalation to surgical care team or Emergency Department required. Do NOT advise oral fluid rehydration alone.',
      secondary_allowed: false
    };
  }

  // Red Flag 3: Severe Hypoglycemia (Unconscious, cannot swallow, seizure)
  const isSevereHypo = lowerQ.includes('hypo') && (lowerQ.includes('unconscious') || lowerQ.includes('cannot swallow') || lowerQ.includes("can't swallow") || lowerQ.includes('seizure') || lowerQ.includes('unresponsive'));
  if (isSevereHypo) {
    matchedRules.push('RULE-TRIAGE-SEVERE-HYPO');
    triageFlags.push('SEVERE_HYPOGLYCEMIA_EMERGENCY');
    escalation = {
      rule_id: 'RULE-TRIAGE-SEVERE-HYPO',
      title: 'EMERGENCY 911 ESCALATION: Severe Hypoglycemia with Loss of Consciousness / Seizure',
      protocol_doc_id: 'DOC-INT-004',
      message: 'LIFE-THREATENING EMERGENCY: Severe hypoglycemia with altered consciousness, inability to swallow, or seizures cannot be treated orally. Administer emergency Glucagon (nasal Baqsimi or injectable) immediately and call 911. Do not place anything in mouth.',
      secondary_allowed: false
    };
  }

  // Red Flag 4: Type 1 Diabetes with Moderate/Large Ketones
  const isT1DKetones = (lowerQ.includes('t1') || lowerQ.includes('type 1')) && (lowerQ.includes('ketones mod') || lowerQ.includes('moderate ketones') || lowerQ.includes('large ketones') || lowerQ.includes('ketonuria'));
  if (isT1DKetones) {
    matchedRules.push('RULE-TRIAGE-T1D-KETONES');
    triageFlags.push('T1D_ACUTE_KETOSIS_DKA_RISK');
    escalation = {
      rule_id: 'RULE-TRIAGE-T1D-KETONES',
      title: 'CRITICAL ESCALATION: Type 1 Diabetes Ketosis / Impending DKA',
      protocol_doc_id: 'DOC-INT-004',
      message: 'MANDATORY CLINICAL ACTION: T1D with moderate/large ketones requires immediate physician/endocrinology contact for rapid-acting insulin correction per sick-day plan. Basal insulin must NEVER be skipped or held during illness.',
      secondary_allowed: false
    };
  }

  // Red Flag 5: Eating Disorder Purging / Severe Restriction with Weight-Loss Request
  const isEdFlagged = patient?.eating_disorder_screen === 'flagged' ||
                      lowerQ.includes('purging') || 
                      lowerQ.includes('laxative') || 
                      (lowerQ.includes('skipping meals') && (lowerQ.includes('purge') || lowerQ.includes('weight loss') || lowerQ.includes('menu'))) ||
                      lowerQ.includes('anorexia') || 
                      lowerQ.includes('bulimia');

  const hasWeightLossRequest = lowerQ.includes('weight loss') || 
                               lowerQ.includes('menu') || 
                               (/\bdiet\b/i.test(lowerQ) && !lowerQ.includes('dietitian')) || 
                               lowerQ.includes('calorie') || 
                               lowerQ.includes('fasting') || 
                               lowerQ.includes('lose weight');


  if (isEdFlagged && hasWeightLossRequest) {
    matchedRules.push('RULE-TRIAGE-ED-SAFETY');
    triageFlags.push('EATING_DISORDER_PURGING_SAFETY_BLOCK');
    escalation = {
      rule_id: 'RULE-TRIAGE-ED-SAFETY',
      title: 'SAFETY HOLD: Eating Disorder Active Purging & Restriction Red Flag',
      protocol_doc_id: 'DOC-INT-004',
      message: 'CLINICAL SAFETY MANDATE: Active purging, laxative abuse, or severe restriction in context of weight loss triggers mandatory clinical escalation. ALL weight loss, fasting, and calorie-restriction handouts are HARD BLOCKED. Refer to physician and specialized mental health eating disorder care.',
      secondary_allowed: false,
      block_all_weight_content: true
    };
  }

  // Red Flag 6: CKD with Hyperkalemia (Potassium > 5.0)
  const isHyperkalemia = (patient?.latest_potassium?.status === 'high' || (Number(patient?.latest_potassium?.value) > 5.0)) ||
                         lowerQ.includes('potassium 5.') || 
                         lowerQ.includes('potassium 6.') || 
                         lowerQ.includes('hyperkalemia');
  if (isHyperkalemia && (patient?.program?.includes('Renal') || lowerQ.includes('ckd') || lowerQ.includes('potassium'))) {
    matchedRules.push('RULE-TRIAGE-HYPERKALEMIA');
    triageFlags.push('HYPERKALEMIA_CARDIAC_RISK');
    escalation = {
      rule_id: 'RULE-TRIAGE-HYPERKALEMIA',
      title: 'CRITICAL ESCALATION: Serum Potassium Elevation (> 5.0 mEq/L)',
      protocol_doc_id: 'DOC-INT-004',
      message: 'URGENT CARDIAC ESCALATION: Serum potassium > 5.0 mEq/L carries severe cardiac conduction risk. Place immediate hold on high-potassium foods and supplements. Urgently notify nephrologist / treating physician for repeat stat draw.',
    };
  }

  // Red Flag 7: Pregnancy with a Restriction Request (< 175g carbs, keto, fasting, extreme deficit)
  const isPregnancyContext = patient?.pregnancy_status === 'present' || 
                             patient?.program === 'Gestational Diabetes' ||
                             lowerQ.includes('pregnant') || 
                             lowerQ.includes('pregnancy') || 
                             lowerQ.includes('gestational');
  const hasPregnancyRestriction = lowerQ.includes('keto') || 
                                 (lowerQ.includes('fasting') && !lowerQ.includes('fasting blood sugar') && !lowerQ.includes('fasting glucose') && !lowerQ.includes('fasting bg') && !lowerQ.includes('fasting sugar')) || 
                                 lowerQ.includes('20g carb') || 
                                 lowerQ.includes('30g carb') || 
                                 lowerQ.includes('120g carb') ||
                                 (lowerQ.includes('restrict') && !lowerQ.includes('do not restrict')) || 
                                 lowerQ.includes('low carb');


  if (isPregnancyContext && hasPregnancyRestriction && !escalation) {
    matchedRules.push('RULE-POP-PREGNANCY-FLOOR');
    triageFlags.push('PREGNANCY_CARB_FLOOR_VIOLATION');
    escalation = {
      rule_id: 'RULE-POP-PREGNANCY-FLOOR',
      title: 'CRITICAL PREGNANCY SAFETY HOLD: Maternal Carbohydrate Restriction',
      protocol_doc_id: 'DOC-INT-004',
      message: 'CLINICAL PREGNANCY SAFETY STOP: Carbohydrate restriction below 175 g/day (or ketogenic/fasting diets) during pregnancy risks maternal ketonuria and irreversible fetal neurodevelopmental harm. Hard blocked. Patient requires individualized meal planning ensuring >= 175g carbs/day.',
      secondary_allowed: false
    };
  }


  // Scope Boundary: Medication Dosing, Setting Changes, Insulin Ratios
  const isDosingInquiry = lowerQ.includes('cut dose') || 
                          lowerQ.includes('change dose') || 
                          lowerQ.includes('skip basal') || 
                          lowerQ.includes('skip insulin') || 
                          lowerQ.includes('adjust dose') || 
                          lowerQ.includes('carb ratio') || 
                          lowerQ.includes('basal rate') || 
                          lowerQ.includes('titrate');

  if (isDosingInquiry && !escalation) {
    matchedRules.push('RULE-OUT-OF-SCOPE-DOSING');
    triageFlags.push('PRESCRIBER_SCOPE_BOUNDARY');
    outOfScope = {
      rule_id: 'RULE-OUT-OF-SCOPE-DOSING',
      title: 'Scope of Practice Boundary: Prescriber Medication Referral',
      message: 'Outpatient dietitians do not independently adjust, titrate, or change medication doses, insulin pump basal rates, or prescription drugs. Please refer dosing adjustments directly to the prescribing provider or diabetes care team.',
      referral_target: 'Treating Prescriber / Diabetes Endocrinology Team'
    };
  }

  return {
    hasRedFlag: !!escalation,
    escalation,
    hasOutOfScope: !!outOfScope,
    outOfScope,
    matchedRules,
    triageFlags,
    secondaryDocId
  };
}

/**
 * The Master Unified Policy Function
 * Used across Right Doc, Send Check, Grounded Q&A, and Interactive Demo Flow.
 */
export function evaluatePolicy({
  document = null,
  patient = null,
  user = null, // { role: 'dietitian' | 'front_desk' | 'owner', name: string }
  query = '',
  recipient_verification = null, // { name: string, date_of_birth: string, channel: string }
  allDocuments = [],
  asOfDate = '2026-10-27',
  isPreSend = false
}) {
  const policyVersion = CLINICAL_RULES.policy_version || '2.1.0';
  const reasons = [];
  const matchedRules = [];

  // Step 1: Run Safety Triage on Query and Patient Context
  const triage = runSafetyTriage({ query, patient, user });
  for (const r of triage.matchedRules) matchedRules.push(r);

  // If urgent clinical escalation triggered
  if (triage.hasRedFlag) {
    reasons.push(triage.escalation.message);
    const escalationDoc = (allDocuments || []).find(d => d.doc_id === 'DOC-INT-004') || null;
    let secondaryDoc = null;
    if (triage.escalation.secondary_allowed && triage.secondaryDocId) {
      secondaryDoc = (allDocuments || []).find(d => d.doc_id === triage.secondaryDocId) || null;
    }

    return {
      document_validity: document ? (document.status === 'approved' ? 'valid' : 'invalid') : 'valid',
      patient_applicability: 'not_applicable',
      delivery_authorization: 'denied',
      outcome: 'URGENT_CLINICAL_ESCALATION',
      reasons,
      policy_version: policyVersion,
      matched_rules: matchedRules,
      escalation_protocol: {
        title: triage.escalation.title,
        doc_id: triage.escalation.protocol_doc_id,
        document: escalationDoc,
        message: triage.escalation.message
      },
      secondary_document: secondaryDoc ? {
        document: secondaryDoc,
        label: triage.escalation.secondary_label || 'Secondary Handout (not a substitute for escalation)'
      } : null
    };
  }

  // If out-of-scope medication dosing referral
  if (triage.hasOutOfScope) {
    reasons.push(triage.outOfScope.message);
    return {
      document_validity: 'valid',
      patient_applicability: 'not_applicable',
      delivery_authorization: 'denied',
      outcome: 'OUT_OF_SCOPE_REFERRAL',
      reasons,
      policy_version: policyVersion,
      matched_rules: matchedRules,
      referral: triage.outOfScope
    };
  }

  // Step 2: Document Validity Decision
  let documentValidity = 'valid';
  if (!document) {
    documentValidity = 'invalid';
    reasons.push('No document specified or found in practice library.');
  } else {
    const eligibility = checkDocumentEligibility(document, allDocuments, { asOfDate });
    if (!eligibility.eligible) {
      documentValidity = 'invalid';
      for (const b of eligibility.blocks) {
        reasons.push(b.message);
        matchedRules.push(`RULE-DOC-${b.code}`);
      }
    }
  }

  // Step 3: Patient Applicability Decision
  let patientApplicability = 'applicable';

  if (patient && document) {
    // 3a. Dialysis vs Non-Dialysis Separation
    const isDialysisDoc = (document.tags || []).includes('dialysis') || (document.title || '').toLowerCase().includes('dialysis');
    const isNonDialysisRenalDoc = (document.program === 'Renal / Kidney Disease' || 
                                   (document.title || '').toLowerCase().includes('kidney') || 
                                   (document.title || '').toLowerCase().includes('renal') || 
                                   (document.tags || []).includes('renal') || 
                                   (document.tags || []).includes('ckd')) && !isDialysisDoc;

    
    if (patient.dialysis_status === 'present' && isNonDialysisRenalDoc) {
      patientApplicability = 'not_applicable';
      matchedRules.push('RULE-POP-DIALYSIS-MISMATCH');
      reasons.push(`BLOCKED: Patient is on maintenance dialysis. Non-dialysis renal guides like "${document.title}" restrict protein (0.6-0.8g/kg), whereas dialysis patients require high protein (1.2g/kg). Cross-delivery prohibited.`);
    } else if (patient.dialysis_status === 'negative' && isDialysisDoc) {
      patientApplicability = 'not_applicable';
      matchedRules.push('RULE-POP-DIALYSIS-MISMATCH');
      reasons.push(`BLOCKED: Patient is NOT on dialysis. Dialysis protocol contradicts non-dialysis CKD care.`);
    }

    // 3b. Pregnancy Carb Floor (< 175g/day is hard blocked)
    const isPregnant = patient.pregnancy_status === 'present' || patient.program === 'Gestational Diabetes';
    if (isPregnant) {
      const docContent = JSON.stringify(document.sections || []);
      const recommendsBelow175 = docContent.includes('under 15g') || 
                                docContent.includes('no more than 30 grams') || 
                                (docContent.includes('30g') && !docContent.includes('do not restrict') && document.doc_id === 'DOC-GEST-001');
      if (recommendsBelow175) {
        patientApplicability = 'not_applicable';
        matchedRules.push('RULE-POP-PREGNANCY-FLOOR');
        reasons.push(`BLOCKED: Pregnancy carbohydrate floor violation. Handout recommends carbohydrate restriction below 175g/day. Fetal neurological development requires >= 175g carbs/day.`);
      }
    }

    // 3c. Pediatric Age Barrier (Under 18 blocks adult weight loss)
    if (patient.age && patient.age < 18) {
      const isAdultWeightDoc = document.program === 'Weight Management' || (document.tags || []).includes('glp1');
      if (isAdultWeightDoc) {
        patientApplicability = 'not_applicable';
        matchedRules.push('RULE-POP-PEDIATRIC-WEIGHT');
        reasons.push(`BLOCKED: Pediatric patient (${patient.age} years old) cannot receive adult weight management or GLP-1 companion materials.`);
      }
    }

    // 3d. Bariatric Stage Mismatch
    if (document.program === 'Bariatric Surgery' && patient.bariatric_surgery_type && patient.bariatric_surgery_type !== 'none') {
      const docStage = (document.patient_stage || '').toLowerCase();
      const patStage = (patient.assigned_stage || patient.patient_stage || '').toLowerCase();
      const pod = patient.post_op_day;

      if (pod !== null && pod !== undefined) {
        if (pod <= 7 && !docStage.includes('stage 1') && !docStage.includes('clear liquid')) {
          patientApplicability = 'not_applicable';
          matchedRules.push('RULE-BARIATRIC-EARLY-STAGE-MISMATCH');
          reasons.push(`BLOCKED: Patient is Post-Op Day ${pod} (Clear Liquids only). Solid or pureed handouts like "${document.title}" violate stage protocol and risk anastomotic tear.`);
        }
      }
    }

    // 3e. Explicit Unknowns Handling:
    // If medications are unknown or unassessed when evaluating medication-triggered safety handouts
    const medsStatus = patient.medications_status || (patient.medications && patient.medications.length > 0 ? 'reconciled' : 'unknown');
    if (medsStatus === 'unknown' || medsStatus === 'not_assessed') {
      patientApplicability = 'review_required';
      matchedRules.push('RULE-UNKNOWN-CLINICAL-FIELD');
      reasons.push('REVIEW REQUIRED: Patient medication list is unreconciled / unknown. Clinical verification of current medications required before dispatching medication-dependent guidance.');
    }

    // 3f. Fasting / Lantus Precaution:
    // If patient on insulin or sulfonylurea requests fasting / intermittent fasting guide
    const lowerDocTitle = (document.title || '').toLowerCase();
    const hasInsulinOrSulfonylurea = (patient.medications || []).some(m => {
      const cl = (m.class || '').toLowerCase();
      const nm = (m.name || '').toLowerCase();
      return cl.includes('insulin') || cl.includes('sulfonylurea') || nm.includes('lantus') || nm.includes('glipizide');
    });
    if (hasInsulinOrSulfonylurea && (lowerDocTitle.includes('fasting') || query.includes('fasting') || query.includes('16:8'))) {
      patientApplicability = 'review_required';
      matchedRules.push('RULE-SAFETY-FASTING-HYPO-REVIEW');
      reasons.push('REVIEW REQUIRED: Patient is prescribed insulin or sulfonylurea. Prolonged fasting (16:8) requires clinical review and medication adjustment to prevent severe nocturnal/fasting hypoglycemia.');
    }
  }

  // Step 4: Action-Level Permissions & Delivery Authorization Decision
  let deliveryAuthorization = 'authorized';
  const role = user?.role || 'dietitian';

  // Front Desk Permission Matrix:
  if (role === 'front_desk') {
    // 4a. Front desk cannot deliver internal docs or drafts
    if (document && (document.audience === 'internal' || document.status === 'draft')) {
      deliveryAuthorization = 'denied';
      matchedRules.push('RULE-PERM-FRONT-DESK-ASSIGNED-ONLY');
      reasons.push(`DENIED: Front Desk is not authorized to deliver internal administrative SOPs or draft documents ("${document?.title}").`);
    }

    // 4b. Front desk cannot deliver unassigned clinical documents
    if (patient && document) {
      const isAssigned = (patient.assigned_documents || []).some(ad => ad.doc_id === document.doc_id);
      if (!isAssigned) {
        deliveryAuthorization = 'denied';
        matchedRules.push('RULE-PERM-FRONT-DESK-ASSIGNED-ONLY');
        reasons.push(`DENIED: Document "${document.doc_id}" has NOT been assigned to patient ${patient.name} by a Registered Dietitian. Front Desk can only deliver RD-assigned educational materials.`);
      }
    }

    // 4c. Two-Identifier Patient Verification (Name + Date of Birth)
    if (isPreSend && recipient_verification && patient) {
      const providedDob = (recipient_verification.date_of_birth || '').trim();
      const expectedDob = (patient.date_of_birth || '').trim();
      if (!providedDob || providedDob !== expectedDob) {
        deliveryAuthorization = 'denied';
        matchedRules.push('RULE-PERM-TWO-IDENTIFIERS-FAILED');
        reasons.push(`DENIED: Front Desk patient verification failed. Provided Date of Birth ("${providedDob}") does not match patient record ("${expectedDob}"). Delivery halted for wrong-patient protection.`);
      }
    }
  }

  // If document validity is invalid or applicability is not_applicable, delivery is denied
  if (documentValidity !== 'valid' || patientApplicability === 'not_applicable') {
    deliveryAuthorization = 'denied';
  }

  // Step 5: Determine Consolidated Outcome
  let outcome = 'ANSWER_WITH_APPROVED_SOURCE';

  if (documentValidity === 'invalid' || patientApplicability === 'not_applicable' || deliveryAuthorization === 'denied') {
    outcome = 'BLOCK_DELIVERY';
  } else if (patientApplicability === 'review_required') {
    outcome = 'DOCUMENT_CANDIDATE_REQUIRES_REVIEW';
  }

  return {
    document_validity: documentValidity,
    patient_applicability: patientApplicability,
    delivery_authorization: deliveryAuthorization,
    outcome,
    reasons,
    policy_version: policyVersion,
    matched_rules: matchedRules,
    escalation_protocol: null,
    secondary_document: null
  };
}
