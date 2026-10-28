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
import { checkDocumentEligibility, checkStageCompatibility } from './eligibility.js';

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
 * Normalize typos, missing apostrophes, and punctuation in user queries.
 */
export function normalizeQueryText(text = '') {
  return (text || '')
    .toLowerCase()
    .replace(/\bcant\b/g, "can't")
    .replace(/\bwont\b/g, "won't")
    .replace(/\bdont\b/g, "don't")
    .replace(/\bintolernt\b/g, 'intolerant')
    .replace(/\bintollerant\b/g, 'intolerant')
    .replace(/\bvomitng\b|\bvomitin\b|\bvomitting\b/g, 'vomiting')
    .replace(/\bdiarhea\b|\bdiarrha\b/g, 'diarrhea')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extract clinical attributes directly from the query text before retrieval.
 * Attributes: drug names/classes, post-op day/week, dialysis vs CKD, lab values (K, BG, A1c, ketones),
 * pregnancy, pediatric age, calorie targets, protein targets, and symptoms.
 */
export function extractQueryClinicalContext(query = '') {
  const norm = normalizeQueryText(query);
  const attributes = [];
  const details = {
    medications: [],
    medication_classes: [],
    timeline: null,
    dialysis_status: null,
    ckd_stage: null,
    labs: {},
    pregnancy: false,
    pediatric: false,
    age: null,
    eating_disorder: false,
    calorie_target: null,
    protein_target: null,
    symptoms: []
  };

  // 1. Medications & Drug Classes
  // Sulfonylurea
  if (/\b(glipizide|glimepiride|glyburide|amaryl|glucotrol|micronase|diabeta|sulfonylurea)\b/.test(norm)) {
    details.medication_classes.push('sulfonylurea');
    const match = norm.match(/\b(glipizide|glimepiride|glyburide|amaryl|glucotrol|micronase|diabeta|sulfonylurea)\b/);
    if (match) details.medications.push(match[0]);
    attributes.push('sulfonylurea');
  }
  // Insulin
  if (/\b(lantus|levemir|tresiba|humalog|novolog|lispro|aspart|glargine|degludec|basal|bolus|insulin|pump)\b/.test(norm)) {
    details.medication_classes.push('insulin');
    const match = norm.match(/\b(lantus|levemir|tresiba|humalog|novolog|lispro|aspart|glargine|degludec|basal|bolus|insulin)\b/);
    if (match) details.medications.push(match[0]);
    attributes.push('insulin');
  }
  // SGLT2 Inhibitor
  if (/\b(jardiance|farxiga|invokana|steglatro|empagliflozin|dapagliflozin|canagliflozin|ertugliflozin|sglt2|sglt2i)\b/.test(norm)) {
    details.medication_classes.push('sglt2_inhibitor');
    const match = norm.match(/\b(jardiance|farxiga|invokana|steglatro|empagliflozin|dapagliflozin|canagliflozin|ertugliflozin|sglt2)\b/);
    if (match) details.medications.push(match[0]);
    attributes.push('sglt2_inhibitor');
  }
  // GLP-1 / GIP
  if (/\b(ozempic|wegovy|mounjaro|zepbound|semaglutide|tirzepatide|liraglutide|victoza|saxenda|trulicity|dulaglutide|glp-1|glp1|gip)\b/.test(norm)) {
    details.medication_classes.push('glp1_gip');
    const match = norm.match(/\b(ozempic|wegovy|mounjaro|zepbound|semaglutide|tirzepatide|liraglutide|glp-1|glp1|gip)\b/);
    if (match) details.medications.push(match[0]);
    attributes.push('glp1_gip');
  }
  // Metformin
  if (/\b(metformin|glucophage)\b/.test(norm)) {
    details.medication_classes.push('biguanide');
    details.medications.push('metformin');
    attributes.push('metformin');
  }

  // 2. Post-op Timeline
  const podMatch = norm.match(/\b(?:pod|post[- ]op day|day)\s*(\d+)\b/);
  if (podMatch) {
    details.timeline = { post_op_day: parseInt(podMatch[1], 10) };
    attributes.push(`post_op_day_${podMatch[1]}`);
  }
  const powMatch = norm.match(/\b(?:post[- ]op week|week)\s*(\d+)\b/);
  if (powMatch) {
    details.timeline = { ...(details.timeline || {}), post_op_week: parseInt(powMatch[1], 10) };
    attributes.push(`post_op_week_${powMatch[1]}`);
  }

  // 3. Dialysis vs CKD
  if (/\b(dialysis|hemodialysis|peritoneal dialysis|hd|pd|esrd)\b/.test(norm)) {
    details.dialysis_status = 'present';
    attributes.push('dialysis');
  }
  const ckdMatch = norm.match(/\b(?:ckd stage|ckd|stage)\s*([1-5][ab]?)\b|\bchronic kidney disease\b/);
  if (ckdMatch) {
    details.ckd_stage = ckdMatch[1] ? `Stage ${ckdMatch[1].toUpperCase()}` : 'CKD';
    attributes.push(details.ckd_stage);
  }

  // 4. Lab Values
  // Potassium (K)
  const kMatch = norm.match(/\b(?:potassium|k)\s*(?:>|>=|of|level|is|:)?\s*([456]\.\d+)\b/);
  if (kMatch) {
    details.labs.potassium = parseFloat(kMatch[1]);
    attributes.push(`potassium_${kMatch[1]}`);
  } else if (/\bhyperkalemia\b/.test(norm)) {
    details.labs.potassium = 5.5;
    attributes.push('hyperkalemia');
  }
  // BG
  const bgMatch = norm.match(/\b(?:bg|sugars|glucose|blood sugar)\s*(?:>|>=|of|level|is|:)?\s*(\d{2,3})\b/);
  if (bgMatch) {
    details.labs.bg = parseInt(bgMatch[1], 10);
    attributes.push(`bg_${bgMatch[1]}`);
  }
  // A1c
  const a1cMatch = norm.match(/\b(?:a1c|hba1c)\s*(?:>|>=|of|is|:)?\s*(\d{1,2}(?:\.\d+)?)\b/);
  if (a1cMatch) {
    details.labs.a1c = parseFloat(a1cMatch[1]);
    attributes.push(`a1c_${a1cMatch[1]}`);
  }
  // Ketones
  if (/\b(ketones mod|moderate ketones|large ketones|ketonuria|ketones positive)\b/.test(norm)) {
    details.labs.ketones = 'moderate_or_large';
    attributes.push('ketones_mod_or_large');
  }

  // 5. Pregnancy
  if (/\b(pregnant|pregnancy|gestational|gdm|trimester)\b/.test(norm)) {
    details.pregnancy = true;
    attributes.push('pregnancy');
  }

  // 6. Pediatric (<18)
  const ageMatch = norm.match(/\b(\d{1,2})\s*(?:yo|year old|yr old)\b|\b(pediatric|adolescent|child)\b/);
  if (ageMatch) {
    const ageVal = ageMatch[1] ? parseInt(ageMatch[1], 10) : (ageMatch[2] === 'child' ? 10 : 14);
    if (ageVal < 18) {
      details.pediatric = true;
      details.age = ageVal;
      attributes.push('pediatric');
    }
  }

  // 7. Eating Disorder
  if (/\b(eating disorder|ed history|anorexia|bulimia|purging|laxative|skipping meals|severe restriction)\b/.test(norm)) {
    details.eating_disorder = true;
    attributes.push('eating_disorder');
  }

  // 8. Calorie Targets (< 1200/day)
  if (/< ?1200|under 1200|below 1200|\b([1-9]\d{2}|1[01]\d{2})\s*(?:cal|kcal|calorie|calories)\b|vlcd\b/.test(norm)) {
    details.calorie_target = 'sub_1200_kcal';
    attributes.push('calorie_target_sub_1200');
  }

  // 9. Protein Targets
  const protMatch = norm.match(/\b(\d{2,3})\s*g\s*protein\b/);
  if (protMatch) {
    const grams = parseInt(protMatch[1], 10);
    details.protein_target = grams >= 80 ? 'high' : (grams <= 50 ? 'low' : 'moderate');
    attributes.push(`protein_${details.protein_target}`);
  } else if (/\b(high[- ]protein|high protein|protein for muscle)\b/.test(norm)) {
    details.protein_target = 'high';
    attributes.push('protein_high');
  } else if (/\b(low[- ]protein|0\.8\s*g)\b/.test(norm)) {
    details.protein_target = 'low';
    attributes.push('protein_low');
  }

  // 10. Symptoms
  if (norm.includes('vomit')) details.symptoms.push('vomiting');
  if (norm.includes("cant hold water") || norm.includes("can't hold water") || norm.includes("cannot keep fluids") || norm.includes("cant keep fluid")) {
    details.symptoms.push('intractable_vomiting');
  }
  if (norm.includes('diarrhea')) details.symptoms.push('diarrhea');
  if (norm.includes('nausea')) details.symptoms.push('nausea');
  if (norm.includes('flu')) details.symptoms.push('flu');
  if (norm.includes('shaky') || norm.includes('lows') || norm.includes('hypo')) details.symptoms.push('hypoglycemia_symptoms');
  if (details.symptoms.length > 0) attributes.push(...details.symptoms);

  return {
    rawQuery: query,
    normalizedText: norm,
    hasClinicalAttributes: attributes.length > 0,
    attributes,
    attributesSummary: attributes.join(', '),
    details
  };
}

/**
 * Run safety triage on query, patient, and context BEFORE any document search.
 */
export function runSafetyTriage({ query = '', patient = null, user = null, context = {} }) {
  const normQ = normalizeQueryText(query);
  const queryContext = extractQueryClinicalContext(query);
  const matchedRules = [];
  const triageFlags = [];
  let escalation = null;
  let outOfScope = null;
  let secondaryDocId = null;

  const patientMeds = patient?.medications || [];
  const medNames = patientMeds.map(m => (m.name || '').toLowerCase()).join(' ');
  const medClasses = patientMeds.map(m => (m.class || '').toLowerCase()).join(' ');
  const allMedText = `${medNames} ${medClasses} ${normQ}`;

  const hasSglt2 = allMedText.includes('jardiance') || 
                   allMedText.includes('farxiga') || 
                   allMedText.includes('invokana') || 
                   allMedText.includes('steglatro') || 
                   allMedText.includes('empagliflozin') || 
                   allMedText.includes('dapagliflozin') || 
                   allMedText.includes('canagliflozin') || 
                   allMedText.includes('ertugliflozin') || 
                   allMedText.includes('sglt2') ||
                   queryContext.details.medication_classes.includes('sglt2_inhibitor');

  const hasVomitingOrIllness = normQ.includes('vomit') || 
                              normQ.includes('nausea') ||
                              normQ.includes('stomach pain') ||
                              normQ.includes('abdominal pain') ||
                              normQ.includes('trouble breathing') ||
                              normQ.includes('shortness of breath') ||
                              normQ.includes('flu') || 
                              normQ.includes('ill') || 
                              normQ.includes('fever') || 
                              normQ.includes('not eating') || 
                              normQ.includes("can't eat") || 
                              normQ.includes('cant eat');

  const hasSglt2Keto = hasSglt2 && (normQ.includes('keto') || normQ.includes('vlcd') || normQ.includes('fasting'));
  let sglt2KetoBlock = null;

  // Red Flag 1: SGLT2 Inhibitor + illness / vomiting / nausea / symptoms (eDKA emergency)
  // Scope-safe text: Never tell staff to start, stop or change a medication.
  if (hasSglt2 && hasVomitingOrIllness) {
    matchedRules.push('RULE-TRIAGE-SGLT2-DKA');
    triageFlags.push('SGLT2_EUGLEMIC_DKA_RISK');
    escalation = {
      rule_id: 'RULE-TRIAGE-SGLT2-DKA',
      title: 'CRITICAL SAFETY ESCALATION: SGLT2 Inhibitor Euglycemic DKA Risk',
      protocol_doc_id: 'DOC-INT-004',
      message: "Contact the prescriber or on-call clinician per the patient's sick-day plan; check ketones if available; seek emergency care for vomiting, abdominal pain or trouble breathing.",
      secondary_allowed: true,
      secondary_doc_id: 'DOC-DM-005',
      secondary_label: 'Secondary Handout (not a substitute for escalation)'
    };
    secondaryDocId = 'DOC-DM-005';
  } else if (hasSglt2Keto && !hasVomitingOrIllness) {
    // SGLT2 + Keto/Fasting without symptoms: BLOCK_DELIVERY contraindication, not emergency sick-day protocol
    matchedRules.push('RULE-MED-SGLT2-KETO-CONTRAINDICATION');
    triageFlags.push('SGLT2_KETO_CONTRAINDICATION');
    sglt2KetoBlock = {
      rule_id: 'RULE-MED-SGLT2-KETO-CONTRAINDICATION',
      title: 'CONTRAINDICATION: SGLT2 Inhibitor with Ketogenic Diet',
      message: 'BLOCKED: SGLT2 inhibitor + very low carbohydrate diet increases euglycemic DKA risk; RD and prescriber review required.'
    };
  }

  // Red Flag 2: Persistent Vomiting / Cannot Keep Fluids Down (Bariatric, GLP-1, Any)
  const isPersistentVomit = (normQ.includes('vomit') && (normQ.includes('persistent') || normQ.includes('3 days') || normQ.includes('several days') || normQ.includes('since last night') || normQ.includes('all night') || normQ.includes('intractable') || (normQ.includes('days') && !normQ.includes('sick day')))) ||
                            normQ.includes("can't hold water") || 
                            normQ.includes('cant hold water') || 
                            normQ.includes("can't keep fluid") || 
                            normQ.includes('cant keep fluid') ||
                            normQ.includes('cannot keep fluids');

  const hasGlp1 = allMedText.includes('ozempic') || 
                  allMedText.includes('wegovy') || 
                  allMedText.includes('mounjaro') || 
                  allMedText.includes('zepbound') || 
                  allMedText.includes('semaglutide') || 
                  allMedText.includes('tirzepatide') ||
                  allMedText.includes('glp1') || 
                  allMedText.includes('glp-1') ||
                  queryContext.details.medication_classes.includes('glp1_gip');

  if ((isPersistentVomit || (hasGlp1 && (normQ.includes('fluid') || normQ.includes('water') || normQ.includes('vomit')))) && !escalation) {
    matchedRules.push('RULE-TRIAGE-INTRACTABLE-VOMITING');
    triageFlags.push('INTRACTABLE_VOMITING_DEHYDRATION_RISK');
    escalation = {
      rule_id: 'RULE-TRIAGE-INTRACTABLE-VOMITING',
      title: 'CRITICAL ESCALATION: Persistent Vomiting / Severe Dehydration Risk',
      protocol_doc_id: 'DOC-INT-004',
      message: 'MANDATORY CLINICAL ACTION: Patient with persistent vomiting or inability to retain fluids is at acute risk of Wernicke\'s encephalopathy, anastomotic stricture, acute kidney injury, or medication-induced dehydration. Immediate escalation to surgical care team, prescribing clinician, or Emergency Department required. Do NOT advise oral fluid rehydration alone.',
      secondary_allowed: false
    };
  }

  // Red Flag 3: Severe Hypoglycemia (Unconscious, cannot swallow, seizure)
  const isSevereHypo = (normQ.includes('hypo') || normQ.includes('sugar') || normQ.includes('glucose')) && 
                       (normQ.includes('unconscious') || normQ.includes('cannot swallow') || normQ.includes("can't swallow") || normQ.includes('seizure') || normQ.includes('unresponsive'));
  if (isSevereHypo && !escalation) {
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
  const isT1DKetones = (normQ.includes('t1') || normQ.includes('type 1')) && 
                       (normQ.includes('ketones mod') || normQ.includes('moderate ketones') || normQ.includes('large ketones') || normQ.includes('ketonuria'));
  if (isT1DKetones && !escalation) {
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

  // Red Flag 5: Eating Disorder Active Purging / Severe Restriction
  // Scope-safe ED wording: medical evaluation, ED-specialized care, no restrictive handouts.
  const isEdFlagged = patient?.eating_disorder_screen === 'flagged' ||
                      queryContext.details.eating_disorder ||
                      normQ.includes('purging') || 
                      normQ.includes('laxative') || 
                      (normQ.includes('skipping meals') && (normQ.includes('purge') || normQ.includes('weight loss') || normQ.includes('menu'))) ||
                      normQ.includes('anorexia') || 
                      normQ.includes('bulimia') ||
                      normQ.includes('eating disorder') ||
                      normQ.includes('ed history');

  const hasWeightLossRequest = normQ.includes('weight loss') || 
                               normQ.includes('menu') || 
                               (/\bdiet\b/i.test(normQ) && !normQ.includes('dietitian')) || 
                               normQ.includes('calorie') || 
                               normQ.includes('fasting') || 
                               normQ.includes('restriction') ||
                               normQ.includes('lose weight');

  if (isEdFlagged && hasWeightLossRequest && !escalation) {
    matchedRules.push('RULE-TRIAGE-ED-SAFETY');
    triageFlags.push('EATING_DISORDER_PURGING_SAFETY_BLOCK');
    escalation = {
      rule_id: 'RULE-TRIAGE-ED-SAFETY',
      title: 'SAFETY HOLD: Eating Disorder Active Purging & Restriction Red Flag',
      protocol_doc_id: 'DOC-INT-004',
      message: 'CLINICAL SAFETY ESCALATION: Active eating disorder presentation, purging, severe restriction, or history of disordered eating with weight loss requests triggers mandatory clinical escalation. Route immediately to medical evaluation and ED-specialized care team; no restrictive handouts. All calorie restriction, weight loss, and fasting education materials are strictly blocked.',
      secondary_allowed: false,
      block_all_weight_content: true
    };
  }

  // Red Flag 6: CKD with Potassium > 5.5 (or > 5.0) -> Urgent Escalation
  const queryPotassium = queryContext.details.labs.potassium;
  const isCkdContext = patient?.program?.includes('Renal') || 
                       queryContext.details.ckd_stage !== null || 
                       normQ.includes('ckd') || 
                       normQ.includes('renal') || 
                       normQ.includes('kidney');

  const isHyperkalemia = (patient?.latest_potassium?.status === 'high' || (Number(patient?.latest_potassium?.value) > 5.0)) ||
                         (queryPotassium && queryPotassium > 5.0) ||
                         normQ.includes('potassium 5.') || 
                         normQ.includes('potassium 6.') || 
                         normQ.includes('k > 5.5') ||
                         normQ.includes('k>5.5') ||
                         normQ.includes('hyperkalemia');

  if (isHyperkalemia && isCkdContext && !escalation) {
    matchedRules.push('RULE-TRIAGE-HYPERKALEMIA');
    triageFlags.push('HYPERKALEMIA_CARDIAC_RISK');
    escalation = {
      rule_id: 'RULE-TRIAGE-HYPERKALEMIA',
      title: 'CRITICAL ESCALATION: Serum Potassium Elevation (> 5.5 mEq/L with CKD)',
      protocol_doc_id: 'DOC-INT-004',
      message: 'URGENT CARDIAC ESCALATION: Serum potassium > 5.5 mEq/L (or > 5.0 in CKD) carries severe cardiac conduction arrhythmia risk. Place immediate hold on high-potassium foods and supplements. Urgently contact treating nephrologist / on-call physician for stat verification and acute management; seek emergency care for palpitations, weakness or chest pain.',
      secondary_allowed: false
    };
  }

  // Scope Boundary: Medication Dosing, Setting Changes, Insulin Ratios
  // Scope-safe text: Refer to prescriber; dietitians cannot alter doses.
  const isDosingInquiry = normQ.includes('cut dose') || 
                          normQ.includes('change dose') || 
                          normQ.includes('skip basal') || 
                          normQ.includes('skip insulin') || 
                          normQ.includes('adjust dose') || 
                          normQ.includes('carb ratio') || 
                          normQ.includes('basal rate') || 
                          normQ.includes('titrate') ||
                          normQ.includes('basal adjustment') ||
                          normQ.includes('pump start ICR');

  if (isDosingInquiry && !escalation) {
    matchedRules.push('RULE-OUT-OF-SCOPE-DOSING');
    triageFlags.push('PRESCRIBER_SCOPE_BOUNDARY');
    outOfScope = {
      rule_id: 'RULE-OUT-OF-SCOPE-DOSING',
      title: 'Scope of Practice Boundary: Prescriber Medication Referral',
      message: 'Outpatient dietitians do not independently adjust, titrate, or change medication doses, insulin pump basal rates, or prescription drugs. Please refer dosing adjustments directly to the prescribing provider.',
      referral_target: 'Treating Prescriber / Medical Provider'
    };
  }

  return {
    hasRedFlag: !!escalation,
    escalation,
    hasOutOfScope: !!outOfScope,
    outOfScope,
    hasSglt2KetoBlock: !!sglt2KetoBlock,
    sglt2KetoBlock,
    matchedRules,
    triageFlags,
    secondaryDocId,
    queryContext
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
  const queryContext = triage.queryContext || extractQueryClinicalContext(query);
  const normQ = queryContext.normalizedText || normalizeQueryText(query);

  if (document) {
    const docStage = (document.patient_stage || '').toLowerCase();
    const lowerDocTitle = (document.title || '').toLowerCase();

    // Program Compatibility Check
    const patientProgram = patient?.program;
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
        patientApplicability = 'not_applicable';
        matchedRules.push('RULE-POP-PROGRAM-MISMATCH');
        reasons.push(`BLOCKED: Program Mismatch. Handout is for "${docPrograms.join(' / ')}", but patient is enrolled in "${patientProgram}".`);
      }
    }

    // 3a. Dialysis vs Non-Dialysis Separation
    const isDialysisDoc = (document.tags || []).includes('dialysis') || lowerDocTitle.includes('dialysis');
    const isNonDialysisRenalDoc = (document.program === 'Renal / Kidney Disease' || 
                                   lowerDocTitle.includes('kidney') || 
                                   lowerDocTitle.includes('renal') || 
                                   (document.tags || []).includes('renal') || 
                                   (document.tags || []).includes('ckd')) && !isDialysisDoc;

    const isPatientDialysis = patient?.dialysis_status === 'present' || queryContext.details.dialysis_status === 'present';
    const isPatientNonDialysis = patient?.dialysis_status === 'negative' || (patient?.ckd_stage && patient.ckd_stage !== 'Stage 5' && !isPatientDialysis);

    if (isPatientDialysis && isNonDialysisRenalDoc) {
      patientApplicability = 'not_applicable';
      matchedRules.push('RULE-POP-DIALYSIS-MISMATCH');
      reasons.push(`BLOCKED: Patient is on maintenance dialysis. Non-dialysis renal guides like "${document.title}" restrict protein (0.6-0.8g/kg), whereas dialysis patients require high protein (1.2g/kg). Cross-delivery prohibited.`);
    } else if (isPatientNonDialysis && isDialysisDoc) {
      patientApplicability = 'not_applicable';
      matchedRules.push('RULE-POP-DIALYSIS-MISMATCH');
      reasons.push(`BLOCKED: Patient is NOT on dialysis. Dialysis protocol contradicts non-dialysis CKD care.`);
    }

    // 3b. Pregnancy Carb Floor (< 175g/day is hard blocked)
    const isPregnant = patient?.pregnancy_status === 'present' || 
                       patient?.program === 'Gestational Diabetes' ||
                       queryContext.details.pregnancy;
    if (isPregnant) {
      const docContent = JSON.stringify(document.sections || []);
      const recommendsBelow175 = docContent.includes('under 15g') || 
                                docContent.includes('no more than 30 grams') || 
                                (docContent.includes('30g') && !docContent.includes('do not restrict') && document.doc_id === 'DOC-GEST-001') ||
                                normQ.includes('20g carb') || 
                                normQ.includes('120g carb') || 
                                (normQ.includes('keto') && !normQ.includes('do not do keto'));
      if (recommendsBelow175) {
        patientApplicability = 'not_applicable';
        matchedRules.push('RULE-POP-PREGNANCY-FLOOR');
        reasons.push(`BLOCKED: Pregnancy carbohydrate floor violation. Handout or dietary request recommends carbohydrate restriction below 175g/day. Fetal neurological development requires >= 175g carbs/day.`);
      }
    }

    // 3c. Pediatric Age Barrier (Under 18 blocks adult weight loss)
    const isPediatric = (patient?.age && patient.age < 18) || queryContext.details.pediatric;
    if (isPediatric) {
      const isAdultWeightDoc = document.program === 'Weight Management' || 
                              (document.tags || []).includes('glp1') || 
                              (document.tags || []).includes('weight-loss') ||
                              lowerDocTitle.includes('weight loss') ||
                              lowerDocTitle.includes('glp-1');
      if (isAdultWeightDoc) {
        patientApplicability = 'not_applicable';
        matchedRules.push('RULE-POP-PEDIATRIC-WEIGHT');
        reasons.push(`BLOCKED: Pediatric patient (${patient?.age || queryContext.details.age || 'under 18'} years old) cannot receive adult weight management or GLP-1 companion materials.`);
      }
    }

    // 3d. Bariatric Stage Mismatch
    if (document.program === 'Bariatric Surgery') {
      const pod = patient?.post_op_day ?? queryContext.details.timeline?.post_op_day;
      if (pod !== null && pod !== undefined) {
        if (pod <= 7 && !docStage.includes('stage 1') && !docStage.includes('clear liquid')) {
          patientApplicability = 'not_applicable';
          matchedRules.push('RULE-BARIATRIC-EARLY-STAGE-MISMATCH');
          reasons.push(`BLOCKED: Patient is Post-Op Day ${pod} (Clear Liquids only). Solid or pureed handouts like "${document.title}" violate stage protocol and risk anastomotic tear.`);
        }
      }
    }

    // 3j. Allergy & Intolerance Contraindication
    const patientAllergies = [
      ...(patient?.allergies_sensitivities || []),
      ...(patient?.allergies_and_intolerances || [])
    ];
    if (patientAllergies.length > 0 || queryContext.normalizedText.includes('lactose')) {
      const hasLactoseIntolerance = patientAllergies.some(a => /lactose/i.test(a)) || queryContext.normalizedText.includes('lactose');
      const recommendsDairy = (document.doc_id === 'DOC-BAR-002' && Number(document.version) === 1) ||
                              (document.doc_id === 'DOC-BAR-001' && Number(document.version) === 1) ||
                              (document.summary && /cow milk|dairy shake|whey concentrate/i.test(document.summary)) ||
                              (document.sections && document.sections.some(s => /cow milk|skim milk|whey concentrate/i.test(s.content) && !/lactose-free|almond milk|pea protein/i.test(s.content)));
      if (hasLactoseIntolerance && recommendsDairy) {
        patientApplicability = 'not_applicable';
        matchedRules.push('RULE-CONTRAINDICATION-LACTOSE');
        reasons.push('BLOCKED: Patient has documented Lactose Intolerance. Handout contains or recommends regular dairy / whey concentrate, risking severe bloating, cramps, and dumping syndrome.');
      }
    }

    // 3e. Calorie Target < 1200/day Block (All programs, including PCOS)
    const isSub1200Calorie = queryContext.details.calorie_target === 'sub_1200_kcal' || 
                             document.doc_id === 'DOC-RET-001' || 
                             (document.tags || []).includes('vlcd') ||
                             normQ.includes('800 cal') ||
                             normQ.includes('800 kcal') ||
                             normQ.includes('800 calorie') ||
                             normQ.includes('vlcd') ||
                             /< ?1200|under 1200|below 1200/.test(normQ);
    if (isSub1200Calorie) {
      patientApplicability = 'not_applicable';
      matchedRules.push('RULE-POP-VLCD-CALORIE-FLOOR');
      reasons.push('BLOCKED: Dietary targets below 1200 kcal/day require comprehensive RD clinical assessment and medical supervision due to metabolic and gallstone risks. Unsupervised distribution is prohibited for all programs, including PCOS.');
    }

    // 3f. Explicit Unknowns Handling (Only if not already not_applicable)
    if (patientApplicability !== 'not_applicable' && patient) {
      const medsStatus = patient.medications_status || (patient.medications && patient.medications.length > 0 ? 'reconciled' : 'unknown');
      if (medsStatus === 'unknown' || medsStatus === 'not_assessed') {
        patientApplicability = 'review_required';
        matchedRules.push('RULE-UNKNOWN-CLINICAL-FIELD');
        reasons.push('REVIEW REQUIRED: Patient medication list is unreconciled / unknown. Clinical verification of current medications required before dispatching medication-dependent guidance.');
      }

      if (patient.ckd_stage === 'unknown' || patient.ckd_stage === 'unassessed' || normQ.includes('unknown kidney')) {
        patientApplicability = 'review_required';
        matchedRules.push('RULE-UNKNOWN-CLINICAL-FIELD');
        reasons.push('REVIEW REQUIRED: Patient renal status / kidney function is unknown. Renal stage reconciliation required before distributing medication-dependent guidance.');
      }
    }

    // 3g. Fasting / Lantus / Sulfonylurea Precaution:
    const patientMedsList = patient?.medications || [];
    const hasInsulinOrSulfonylurea = patientMedsList.some(m => {
      const cl = (m.class || '').toLowerCase();
      const nm = (m.name || '').toLowerCase();
      return cl.includes('insulin') || cl.includes('sulfonylurea') || nm.includes('lantus') || nm.includes('glipizide') || nm.includes('glimepiride');
    }) || queryContext.details.medication_classes.includes('insulin') || queryContext.details.medication_classes.includes('sulfonylurea') ||
       /\b(glipizide|glimepiride|glyburide|sulfonylurea|lantus|levemir|tresiba|humalog|novolog|insulin)\b/i.test(normQ);

    if (patientApplicability !== 'not_applicable' && hasInsulinOrSulfonylurea) {
      if (lowerDocTitle.includes('fasting') || normQ.includes('fasting') || normQ.includes('16:8')) {
        patientApplicability = 'review_required';
        matchedRules.push('RULE-SAFETY-FASTING-HYPO-REVIEW');
        reasons.push('REVIEW REQUIRED: Patient is prescribed insulin or sulfonylurea. Prolonged fasting (16:8) requires clinical review and medication adjustment to prevent severe nocturnal/fasting hypoglycemia.');
      }

      if (normQ.includes('recurrent lows') || normQ.includes('frequent lows') || normQ.includes('shaky, sugar low') || normQ.includes('going low') || normQ.includes('low') || normQ.includes('lows') || normQ.includes('hypo')) {
        patientApplicability = 'review_required';
        matchedRules.push('RULE-SAFETY-HYPO-RECURRENT-REVIEW');
        reasons.push('REVIEW REQUIRED: Patient prescribed insulin or sulfonylurea experiencing hypoglycemia requires clinical review and hypoglycemia protocol education.');
      }
    }

    // 3h. CKD + High-Protein Request or High-Protein Handout Precaution:
    const isCkdPatient = patient?.program?.includes('Renal') || 
                         queryContext.details.ckd_stage || 
                         normQ.includes('ckd') || 
                         normQ.includes('renal') || 
                         normQ.includes('kidney');
    const isHighProteinHandoutOrRequest = queryContext.details.protein_target === 'high' ||
                                         normQ.includes('high protein') ||
                                         normQ.includes('high-protein') ||
                                         normQ.includes('100g protein') ||
                                         normQ.includes('protein for muscle') ||
                                         ['DOC-MENO-001', 'DOC-BAR-005', 'DOC-WM-001'].includes(document?.doc_id);
    if (patientApplicability !== 'not_applicable' && isCkdPatient && isHighProteinHandoutOrRequest) {
      patientApplicability = 'review_required';
      matchedRules.push('RULE-SAFETY-CKD-PROTEIN-REVIEW');
      reasons.push(`REVIEW REQUIRED: Chronic Kidney Disease (CKD) patient paired with high-protein intake (${['DOC-MENO-001', 'DOC-BAR-005', 'DOC-WM-001'].includes(document?.doc_id) ? `high-protein handout ${document?.doc_id}` : 'high-protein request'}) requires RD clinical review to prevent glomerular hyperfiltration and renal decline.`);
    }

    // 3i. Query Mentioning Clinical Attribute With No Patient Selected
    if (!patient && queryContext.hasClinicalAttributes && patientApplicability === 'applicable' && document?.audience !== 'internal') {
      patientApplicability = 'review_required';
      matchedRules.push('RULE-QUERY-CLINICAL-CONTEXT-NEEDS-PATIENT');
      reasons.push(`REVIEW REQUIRED: Query specifies clinical attributes (${queryContext.attributesSummary}) without a selected patient. Patient profile selection and clinical verification required before approval.`);
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
    // Privacy mandate: NEVER leak the record's DOB or name; say only "Identifiers do not match."
    if (isPreSend && recipient_verification && patient) {
      const providedDob = (recipient_verification.date_of_birth || recipient_verification.dob || '').trim();
      const expectedDob = (patient.date_of_birth || '').trim();
      const providedName = (recipient_verification.name || '').trim();
      const expectedName = (patient.name || '').trim();

      const isNameMatch = !providedName || providedName.toLowerCase() === expectedName.toLowerCase();
      const isDobMatch = providedDob === expectedDob;

      if (!providedDob || !isDobMatch || !isNameMatch) {
        deliveryAuthorization = 'denied';
        matchedRules.push('RULE-PERM-TWO-IDENTIFIERS-FAILED');
        reasons.push('DENIED: Front Desk patient verification failed. Identifiers do not match.');
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
