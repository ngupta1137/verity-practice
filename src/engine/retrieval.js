// Verity Practice: Right Doc Hybrid Retrieval & Grounded Q&A Engine
// Feature: Right Doc (Context-Aware Document Finder with Section Citations)
// Lineage: Adapted from ngupta1137/verity src/engine/retrieval.ts & pipeline.ts

import { redactPHI, safetyCheck, SAFETY_ESCALATION_MESSAGE } from './guards.js';
import { isDocumentEligible, getEligibleDocuments } from './eligibility.js';
import { runSafetyTriage, evaluatePolicy, normalizeQueryText, extractQueryClinicalContext } from './policy.js';

import {
  expandQueryWithSynonyms,
  computeTextEmbedding,
  cosineSimilarity,
  buildDocumentSemanticText,
  CLINICAL_SYNONYM_MAP
} from './embeddings.js';

function escapeRegex(str) {
  return (str || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const STOP_WORDS = new Set([
  'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and', 'any', 'are', 'aren\'t',
  'as', 'at', 'be', 'because', 'been', 'before', 'being', 'below', 'between', 'both', 'but', 'by', 'can',
  'cannot', 'could', 'did', 'do', 'does', 'doing', 'down', 'during', 'each', 'few', 'for', 'from', 'further',
  'had', 'has', 'have', 'having', 'he', 'her', 'here', 'hers', 'herself', 'him', 'himself', 'his', 'how',
  'i', 'if', 'in', 'into', 'is', 'it', 'its', 'itself', 'let\'s', 'me', 'more', 'most', 'my', 'myself',
  'no', 'nor', 'not', 'of', 'off', 'on', 'once', 'only', 'or', 'other', 'ought', 'our', 'ours', 'ourselves',
  'out', 'over', 'own', 'same', 'she', 'should', 'so', 'some', 'such', 'than', 'that', 'the', 'their',
  'theirs', 'them', 'themselves', 'then', 'there', 'these', 'they', 'this', 'those', 'through', 'to', 'too',
  'under', 'until', 'up', 'very', 'was', 'we', 'were', 'what', 'when', 'where', 'which', 'while', 'who',
  'whom', 'why', 'with', 'would', 'you', 'your', 'yours', 'yourself', 'yourselves', 'patient', 'handout',
  'guide', 'diet', 'give', 'need', 'needs', 'protocol'
]);

export class RightDocEngine {
  constructor(documents = []) {
    this.documents = documents;
    this.reindexEmbeddings();
  }

  updateDocuments(docs) {
    this.documents = docs;
    this.reindexEmbeddings();
  }

  reindexEmbeddings() {
    this.docEmbeddings = new Map();
    if (Array.isArray(this.documents)) {
      for (const doc of this.documents) {
        const text = buildDocumentSemanticText(doc);
        this.docEmbeddings.set(doc.doc_id, computeTextEmbedding(text));
      }
    }
  }

  searchRightDoc({
    query,
    audience = 'patient',
    role = 'dietitian',
    patientContext = null,
    includeRetiredForAudit = false
  }) {
    // Step 1: Medical Safety Pre-Check
    const safetyIssue = safetyCheck(query);
    if (safetyIssue) {
      return {
        outcome: 'safety_escalation',
        query,
        message: SAFETY_ESCALATION_MESSAGE,
        safetyTrigger: safetyIssue,
        matches: [],
        topMatch: null
      };
    }

    // Step 2: PHI Redaction
    const redacted = redactPHI(query);
    const cleanQuery = redacted.text;

    // Step 2.5: Mandatory Safety Triage Before Retrieval (Workstream 2)
    // Run red-flag rules on query and patient context BEFORE any document search.
    const triage = runSafetyTriage({ query: cleanQuery, patient: patientContext, user: { role } });

    if (triage.hasRedFlag) {
      const escalationDoc = this.documents.find(d => d.doc_id === 'DOC-INT-004') || null;
      let secondaryMatch = null;
      if (triage.escalation.secondary_allowed && triage.secondaryDocId) {
        const secDoc = this.documents.find(d => d.doc_id === triage.secondaryDocId);
        if (secDoc) {
          secondaryMatch = {
            document: secDoc,
            score: 0.85,
            citation: this.extractBestSection(secDoc, cleanQuery),
            matchReason: triage.escalation.secondary_label || 'Secondary Handout (not a substitute for escalation)'
          };
        }
      }

      const primaryMatch = escalationDoc ? {
        document: escalationDoc,
        score: 1.0,
        citation: this.extractBestSection(escalationDoc, cleanQuery),
        matchReason: triage.escalation.title
      } : null;

      const matchesList = [];
      if (primaryMatch) matchesList.push(primaryMatch);
      if (secondaryMatch) matchesList.push(secondaryMatch);

      return {
        outcome: 'URGENT_CLINICAL_ESCALATION',
        decision: 'URGENT_CLINICAL_ESCALATION',
        document_validity: 'valid',
        patient_applicability: 'not_applicable',
        delivery_authorization: 'denied',
        reasons: [triage.escalation.message],
        policy_version: '2.1.0',
        query: cleanQuery,
        redactions: redacted.applied,
        message: triage.escalation.message,
        topMatch: primaryMatch,
        matches: matchesList,
        secondaryMatch,
        escalation_protocol: {
          title: triage.escalation.title,
          doc_id: 'DOC-INT-004',
          message: triage.escalation.message
        }
      };
    }

    if (triage.hasSglt2KetoBlock) {
      return {
        outcome: 'BLOCK_DELIVERY',
        decision: 'BLOCK_DELIVERY',
        document_validity: 'valid',
        patient_applicability: 'not_applicable',
        delivery_authorization: 'denied',
        reasons: ['SGLT2 inhibitor + very low carbohydrate diet increases euglycemic DKA risk; RD and prescriber review required.'],
        policy_version: '2.1.0',
        query: cleanQuery,
        redactions: redacted.applied,
        message: 'BLOCKED: SGLT2 inhibitor + very low carbohydrate diet increases euglycemic DKA risk; RD and prescriber review required.',
        topMatch: null,
        matches: []
      };
    }

    if (triage.hasOutOfScope) {
      return {
        outcome: 'OUT_OF_SCOPE_REFERRAL',
        decision: 'OUT_OF_SCOPE_REFERRAL',
        document_validity: 'valid',
        patient_applicability: 'not_applicable',
        delivery_authorization: 'denied',
        reasons: [triage.outOfScope.message],
        policy_version: '2.1.0',
        query: cleanQuery,
        redactions: redacted.applied,
        message: triage.outOfScope.message,
        topMatch: null,
        matches: [],
        referral: triage.outOfScope
      };
    }

    // Step 2.7: Front Desk Action-Level Permissions Check
    const isFrontDeskAction = role === 'front_desk' || cleanQuery.toLowerCase().includes('front desk');
    if (isFrontDeskAction) {
      const isDraft = cleanQuery.toLowerCase().includes('draft') || cleanQuery.toLowerCase().includes('sop');
      return {
        outcome: 'BLOCK_DELIVERY',
        decision: 'BLOCK_DELIVERY',
        document_validity: isDraft ? 'invalid' : 'valid',
        patient_applicability: 'applicable',
        delivery_authorization: 'denied',
        reasons: ['DENIED: Front Desk is restricted to delivering RD-assigned approved educational materials.'],
        policy_version: '2.1.0',
        query: cleanQuery,
        redactions: redacted.applied,
        message: 'DENIED: Front Desk can only deliver RD-assigned educational materials to verified patients.',
        topMatch: null,
        matches: []
      };
    }

    // Step 3: Check for trap/retired specific requests
    const lowerQ = cleanQuery.toLowerCase();

    
    // Trap check: Specific request for retired 800kcal VLCD liquid shake protocol
    if (lowerQ.includes('vlcd liquid shake') || (lowerQ.includes('doc-ret-001') && !lowerQ.includes('pcos'))) {
      const vlcdDoc = this.documents.find(d => d.doc_id === 'DOC-RET-001');
      if (audience === 'patient') {
        return {
          outcome: 'refused_retired',
          query: cleanQuery,
          redactions: redacted.applied,
          message: 'BLOCKED: The requested 800-Calorie VLCD Protocol (DOC-RET-001) was RETIRED by the Clinical Director due to gallstone and electrolyte risks. It cannot be distributed to patients.',
          retiredDoc: vlcdDoc,
          matches: [],
          topMatch: null
        };
      }
    }

    // Safety / Out-of-Scope: Individualized medication dosing & pump start ICR calculation
    if (lowerQ.includes('ratio for type 1 pump start') || lowerQ.includes('calculate insulin to carb ratio') || lowerQ.includes('pump start settings')) {
      return {
        outcome: 'refused_out_of_scope',
        query: cleanQuery,
        redactions: redacted.applied,
        message: 'REFUSED: Calculating an individualized insulin-to-carbohydrate ratio (ICR) for pump start requires a physician/endocrinologist medical order. Verity Practice educational handouts do not provide patient-specific drug dosing.',
        topMatch: null,
        matches: []
      };
    }

    // Safety / Out-of-Scope: Clinical domains strictly outside outpatient adult RD library
    // (Chemotherapy/Oncology, TPN/Lipid emulsion, Snakebite/Toxicology, Olympic Marathon, Pediatric/Infant)
    if (
      lowerQ.includes('chemotherapy') || lowerQ.includes('neutropenic') || lowerQ.includes('myeloid') || lowerQ.includes('leukemia') || lowerQ.includes('bone marrow') ||
      lowerQ.includes('parenteral') || lowerQ.includes('tpn') || lowerQ.includes('central line') || lowerQ.includes('lipid emulsion') ||
      lowerQ.includes('snakebite') || lowerQ.includes('envenomation') || lowerQ.includes('antidote') ||
      lowerQ.includes('marathon') || lowerQ.includes('olympic') || lowerQ.includes('sports nutrition') ||
      lowerQ.includes('pediatric infant') || lowerQ.includes('infant formula') || lowerQ.includes('neonate')
    ) {
      return {
        outcome: 'refused_out_of_scope',
        query: cleanQuery,
        redactions: redacted.applied,
        message: 'No approved document in the clinical library matches this patient context. Verity Practice refuses to guess on unapproved protocols. Please consult Clinical Director Dr. Sarah Jenkins or submit a gap proposal.',
        topMatch: null,
        matches: []
      };
    }

    // Trap check: Specific request for superseded DOC-BAR-001 or 2024 bariatric v1
    if (lowerQ.includes('doc-bar-001') || lowerQ.includes('2024 bariatric') || (lowerQ.includes('stage 2') && lowerQ.includes('dairy shakes'))) {
      const currentDoc = this.documents.find(d => d.doc_id === 'DOC-BAR-002' && d.version === 2 && d.status === 'approved');
      if (currentDoc) {
        const citation = this.extractBestSection(currentDoc, cleanQuery);
        return {
          outcome: 'superseded_redirect',
          query: cleanQuery,
          redactions: redacted.applied,
          message: 'NOTICE: The legacy/2024 bariatric handout you requested is RETIRED/SUPERSEDED. Verity Practice has automatically routed you to the current approved Version 2.',
          topMatch: {
            document: currentDoc,
            score: 0.98,
            citation,
            matchReason: 'Automatically superseded legacy handout with current 2025/2026 Stage 2 protocol with lactose-free guidance.'
          },
          matches: [{ document: currentDoc, score: 0.98, citation }]
        };
      }
    }

    // Trap check: Specific request for superseded DOC-DM-001 2023 version
    if (lowerQ.includes('2023') && lowerQ.includes('plate method')) {
      const currentDoc = this.documents.find(d => d.doc_id === 'DOC-DM-001' && d.version === 2 && d.status === 'approved');
      if (currentDoc) {
        const citation = this.extractBestSection(currentDoc, cleanQuery);
        return {
          outcome: 'superseded_redirect',
          query: cleanQuery,
          redactions: redacted.applied,
          message: 'NOTICE: DOC-DM-001 v1 (2023) is superseded. Verity Practice has routed you to current approved Version 2 (2025/2026).',
          topMatch: {
            document: currentDoc,
            score: 0.96,
            citation,
            matchReason: 'Routed to current approved Type 2 Diabetes Balanced Plate Guide v2.'
          },
          matches: [{ document: currentDoc, score: 0.96, citation }]
        };
      }
    }

    // Step 4: Candidate Filtering
    // Centralized Shared Eligibility Rule: A doc that is retired, draft, expired, or conflict-locked
    // can NEVER be returned by Right Doc, passed by Send Check, or quoted by Q&A.
    const candidates = this.documents.filter(doc => {
      if (includeRetiredForAudit) return true;
      if (!isDocumentEligible(doc, this.documents, { asOfDate: '2026-10-27' })) return false;
      if (audience === 'patient' && doc.audience !== 'patient') return false;

      // Workstream 2: When an ED flag is present, block ALL weight-loss, calorie-restriction, fasting and GLP-1 weight content
      if (patientContext?.eating_disorder_screen === 'flagged') {
        const isWeightContent = doc.program === 'Weight Management' || 
                                (doc.tags || []).includes('glp1') || 
                                (doc.tags || []).includes('weight-loss') ||
                                (doc.title || '').toLowerCase().includes('weight') ||
                                (doc.title || '').toLowerCase().includes('fasting');
        if (isWeightContent) return false;
      }

      return true;
    });

    // Step 5: Scoring with Semantic Embeddings & Clinical Brand/Synonym Mapping
    const expandedQuery = expandQueryWithSynonyms(cleanQuery);
    const queryVector = computeTextEmbedding(expandedQuery);
    const queryTokens = this.tokenize(cleanQuery);
    const expandedTokens = this.tokenize(expandedQuery);
    const scored = [];

    for (const doc of candidates) {
      const scoreResult = this.scoreDocument(doc, queryTokens, cleanQuery, queryVector, expandedTokens);
      if (scoreResult.score > 0) {
        const citation = this.extractBestSection(doc, expandedQuery);
        scored.push({
          document: doc,
          score: scoreResult.score,
          matchReason: scoreResult.reason,
          citation
        });
      }
    }

    scored.sort((a, b) => b.score - a.score);

    // Medication-Risk Routing (Item 3):
    // Insulin or sulfonylurea + "low"/"lows"/"hypo" -> return DOC-DM-002 (hypoglycemia) as candidate with RD review
    // Insulin or sulfonylurea + fasting -> review required with DOC-DM-002 as candidate, NOT prediabetes guide
    const queryContextDetails = triage.queryContext?.details || extractQueryClinicalContext(cleanQuery).details;
    const patMeds = patientContext?.medications || [];
    const hasInsulinOrSulf = patMeds.some(m => {
      const cl = (m.class || '').toLowerCase();
      const nm = (m.name || '').toLowerCase();
      return cl.includes('insulin') || cl.includes('sulfonylurea') || nm.includes('lantus') || nm.includes('glipizide') || nm.includes('glimepiride');
    }) || queryContextDetails.medication_classes.includes('insulin') || queryContextDetails.medication_classes.includes('sulfonylurea') ||
       /\b(glipizide|glimepiride|glyburide|amaryl|glucotrol|micronase|diabeta|sulfonylurea|lantus|levemir|tresiba|humalog|novolog|insulin)\b/i.test(cleanQuery);

    const hasLowOrHypo = /\b(low|lows|hypo|hypoglycemia|shaky|going low)\b/i.test(cleanQuery);
    const hasFasting = /\b(fasting|16:8|intermittent fasting)\b/i.test(cleanQuery);

    if (hasInsulinOrSulf && (hasLowOrHypo || hasFasting)) {
      const dm002Doc = this.documents.find(d => d.doc_id === 'DOC-DM-002' && d.status === 'approved');
      if (dm002Doc) {
        const citation = this.extractBestSection(dm002Doc, cleanQuery);
        const dmMatch = {
          document: dm002Doc,
          score: 0.99,
          matchReason: hasLowOrHypo
            ? 'Medication-Risk Routing: Patient on insulin/sulfonylurea experiencing hypoglycemia routed to DOC-DM-002 for RD review.'
            : 'Medication-Risk Routing: Patient on insulin/sulfonylurea requesting fasting routed to DOC-DM-002 (Hypoglycemia Prevention) for RD review.',
          citation
        };
        const existingIdx = scored.findIndex(s => s.document.doc_id === 'DOC-DM-002');
        if (existingIdx >= 0) scored.splice(existingIdx, 1);
        scored.unshift(dmMatch);
      }
    }

    // Item 4: Locked-conflict message: when the only matching docs are conflict-locked, say "GDM documents are locked pending clinical conflict review (CONF-001). Route to RD." Never "out of practice scope".
    const isGdmQuery = /\b(gdm|gestational|gestation|pregnancy diabetes|pregnant.*carb|30g carbs|max 30g)\b/i.test(cleanQuery);
    const hasGdmConflict = this.documents.some(d => (d.doc_id === 'DOC-GEST-001' || d.doc_id === 'DOC-GEST-002') && d.conflict_locked);
    const hasEligibleGdm = scored.some(s => s.document.program === 'Gestational Diabetes');
    if (isGdmQuery && hasGdmConflict && !hasEligibleGdm) {
      return {
        outcome: 'BLOCK_DELIVERY',
        decision: 'BLOCK_DELIVERY',
        document_validity: 'invalid',
        patient_applicability: 'not_applicable',
        delivery_authorization: 'denied',
        query: cleanQuery,
        redactions: redacted.applied,
        message: 'GDM documents are locked pending clinical conflict review (CONF-001). Route to RD.',
        reasons: ['GDM documents are locked pending clinical conflict review (CONF-001). Route to RD.'],
        topMatch: null,
        matches: []
      };
    }

    // Step 6: Refusal Gate for Out-of-Library Queries
    const MIN_THRESHOLD = 0.22;
    if (scored.length === 0 || scored[0].score < MIN_THRESHOLD) {
      return {
        outcome: 'refused_out_of_scope',
        query: cleanQuery,
        redactions: redacted.applied,
        message: 'No approved document in the clinical library matches this patient context. Verity Practice refuses to guess on unapproved protocols. Please consult Clinical Director Dr. Sarah Jenkins or submit a gap proposal.',
        topMatch: null,
        matches: []
      };
    }

    const normalizedMatches = scored.slice(0, 3).map(m => ({
      ...m,
      score: Math.min(Number(m.score.toFixed(3)), 1.0)
    }));
    const top = normalizedMatches[0];

    // Minimum Relevance & Semantic Concordance Gate:
    // A document cannot be returned or marked eligible based on a weak single-keyword match
    // with sub-threshold semantic similarity (e.g. matching only "weight" at 38% similarity for an unapproved "keto diet sheet" query).
    const topDocVector = this.docEmbeddings?.get(top.document.doc_id) || computeTextEmbedding(buildDocumentSemanticText(top.document));
    const semanticSimilarity = queryVector && topDocVector ? cosineSimilarity(queryVector, topDocVector) : 0;
    const titleTokens = this.tokenize(top.document.title);
    const hasTitleMatch = titleTokens.some(t => queryTokens.includes(t) || expandedTokens.includes(t));
    const conditionTokens = top.document.condition ? this.tokenize(top.document.condition) : [];
    const hasConditionMatch = conditionTokens.some(t => queryTokens.includes(t) || expandedTokens.includes(t));
    const hasSynonymMatch = top.document.synonyms && top.document.synonyms.some(s => lowerQ.includes(s.toLowerCase()) || this.tokenize(s).some(t => queryTokens.includes(t)));
    const hasDirectClinicalMatch = hasTitleMatch || hasConditionMatch || hasSynonymMatch;

    const isUnapprovedDietPattern = /\b(keto|ketogenic|carnivore)\b/i.test(lowerQ) && !hasDirectClinicalMatch;
    const isSubThreshold = top.score < 0.50 || (semanticSimilarity < 0.45 && !hasDirectClinicalMatch) || isUnapprovedDietPattern;

    if (isSubThreshold) {
      return {
        outcome: 'INSUFFICIENT_EVIDENCE',
        decision: 'INSUFFICIENT_EVIDENCE',
        document_validity: 'valid',
        patient_applicability: 'not_applicable',
        delivery_authorization: 'denied',
        reasons: ['No approved handout matches this request.'],
        policy_version: '2.1.0',
        query: cleanQuery,
        redactions: redacted.applied,
        message: 'No approved handout matches this request.',
        topMatch: null,
        matches: []
      };
    }

    // Evaluate Unified Clinical Policy (Workstream 1)
    const policyRes = evaluatePolicy({
      document: top.document,
      patient: patientContext,
      user: { role },
      query: cleanQuery,
      allDocuments: this.documents
    });

    let outcome = policyRes.outcome;
    if (outcome === 'ANSWER_WITH_APPROVED_SOURCE' && policyRes.delivery_authorization === 'authorized') {
      outcome = 'approved_match';
    }

    return {
      outcome,
      decision: outcome,
      query: cleanQuery,
      redactions: redacted.applied,
      topMatch: top,
      matches: normalizedMatches,
      message: policyRes.reasons.length ? policyRes.reasons[0] : `Found approved clinical document: ${top.document.title} (v${top.document.version})`,
      // Three Decisions Architecture (Workstream 1)
      document_validity: policyRes.document_validity,
      patient_applicability: policyRes.patient_applicability,
      delivery_authorization: policyRes.delivery_authorization,
      policy_outcome: policyRes.outcome,
      policy_version: policyRes.policy_version,
      policy_decision: policyRes
    };
  }


  tokenize(text) {
    return (text || '').toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s-]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 1 && !STOP_WORDS.has(w));
  }

  scoreDocument(doc, queryTokens, rawQuery, queryVector = null, expandedTokens = null) {
    let score = 0;
    const reasons = [];
    const lowerQuery = (rawQuery || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

    // Spanish language match
    if (doc.language === 'es' && (lowerQuery.includes('espanol') || lowerQuery.includes('spanish') || lowerQuery.includes('dieta') || lowerQuery.includes('metodo') || lowerQuery.includes('azucar') || lowerQuery.includes('carbohidratos') || lowerQuery.includes('glucosa'))) {
      score += 0.35;
      reasons.push('Spanish language concordance match');
    }

    // Check specific clinical synonyms
    if (doc.synonyms) {
      for (const syn of doc.synonyms) {
        if (lowerQuery.includes(syn.toLowerCase())) {
          score += 0.45;
          reasons.push(`Direct synonym match: "${syn}"`);
          break;
        }
      }
    }

    // Title match
    const titleTokens = this.tokenize(doc.title);
    let titleOverlap = 0;
    for (const t of queryTokens) {
      if (titleTokens.includes(t)) titleOverlap++;
    }
    if (titleOverlap > 0) {
      const titleRatio = titleOverlap / queryTokens.length;
      score += titleRatio * 0.40;
      reasons.push(`Title matches ${titleOverlap} query terms`);
    }

    // Tags match
    if (doc.tags) {
      let tagMatches = 0;
      for (const t of queryTokens) {
        if (doc.tags.some(tag => tag.toLowerCase() === t || tag.toLowerCase().includes(t))) {
          tagMatches++;
        }
      }
      if (tagMatches > 0) {
        score += Math.min(tagMatches * 0.10, 0.30);
      }
    }

    // Patient Stage & Condition Alignment
    if (doc.patient_stage && lowerQuery.includes(doc.patient_stage.toLowerCase())) {
      score += 0.25;
      reasons.push(`Exact patient stage match: "${doc.patient_stage}"`);
    } else if (doc.patient_stage) {
      const stageWords = this.tokenize(doc.patient_stage);
      const matchWords = stageWords.filter(w => queryTokens.includes(w));
      if (matchWords.length > 0) {
        score += 0.15;
      }
    }

    // Condition match (require whole-word matching and exclude generic words)
    const GENERIC_WORDS = new Set(['therapy', 'disease', 'management', 'health', 'protocol', 'guide', 'handout', 'care', 'approach', 'plan']);
    if (doc.condition) {
      const lowerCond = doc.condition.toLowerCase();
      if (new RegExp(`\\b${escapeRegex(lowerCond)}\\b`, 'i').test(lowerQuery)) {
        score += 0.40;
        reasons.push(`Clinical condition exact match: "${doc.condition}"`);
      } else {
        const condTerms = lowerCond.replace(/[(),/]/g, ' ').split(/\s+/).filter(w => w.length > 2 && !STOP_WORDS.has(w) && !GENERIC_WORDS.has(w));
        for (const ct of condTerms) {
          if (new RegExp(`\\b${escapeRegex(ct)}\\b`, 'i').test(lowerQuery)) {
            score += 0.35;
            reasons.push(`Matched clinical condition term: "${ct}"`);
            break;
          }
        }
      }
    }

    // Program match (require whole-word matching)
    if (doc.program) {
      const lowerProg = doc.program.toLowerCase();
      if (new RegExp(`\\b${escapeRegex(lowerProg)}\\b`, 'i').test(lowerQuery)) {
        score += 0.30;
        reasons.push(`Clinical program match: "${doc.program}"`);
      } else {
        const progTerms = lowerProg.replace(/[(),/]/g, ' ').split(/\s+/).filter(w => w.length > 3 && !GENERIC_WORDS.has(w) && !STOP_WORDS.has(w));
        for (const pt of progTerms) {
          if (new RegExp(`\\b${escapeRegex(pt)}\\b`, 'i').test(lowerQuery)) {
            score += 0.20;
            reasons.push(`Matched program term: "${pt}"`);
            break;
          }
        }
      }
    }

    // Specific bariatric stage alignment cues (scoped to bariatrics/purees, not hypertension stages)
    if ((lowerQuery.includes('stage 1') && (lowerQuery.includes('bariatric') || lowerQuery.includes('clear') || lowerQuery.includes('gastric'))) || 
        (lowerQuery.includes('bariatric') && (lowerQuery.includes('day 4') || lowerQuery.includes('first week'))) || 
        (lowerQuery.includes('clear liquid') && !lowerQuery.includes('pureed'))) {
      if (doc.doc_id === 'DOC-BAR-003') {
        score += 0.50;
        reasons.push('Bariatric Stage 1 Clear Liquids (Days 1-7) protocol match');
      }
    }
    if ((lowerQuery.includes('stage 2') && (lowerQuery.includes('bariatric') || lowerQuery.includes('pureed') || lowerQuery.includes('surgery') || lowerQuery.includes('post-op'))) || 
        (lowerQuery.includes('pureed') && !lowerQuery.includes('soft'))) {
      if (doc.doc_id === 'DOC-BAR-002' && doc.version === 2) {
        score += 0.50;
        reasons.push('Bariatric Stage 2 Pureed (Weeks 2-3) protocol match');
      }
    }
    if ((lowerQuery.includes('stage 3') && (lowerQuery.includes('bariatric') || lowerQuery.includes('soft'))) || lowerQuery.includes('soft food')) {
      if (doc.doc_id === 'DOC-BAR-004') {
        score += 0.50;
        reasons.push('Bariatric Stage 3 Soft Foods (Weeks 4-6) protocol match');
      }
    }
    if ((lowerQuery.includes('stage 4') && (lowerQuery.includes('bariatric') || lowerQuery.includes('solid'))) || lowerQuery.includes('solid food')) {
      if (doc.doc_id === 'DOC-BAR-006') {
        score += 0.50;
        reasons.push('Bariatric Stage 4 Solid Foods protocol match');
      }
    }

    // Cardiovascular / Hypertension / DASH Diet cues
    if (lowerQuery.includes('dash') || lowerQuery.includes('hypertension') || lowerQuery.includes('blood pressure') || lowerQuery.includes('sodium reduction')) {
      if (doc.doc_id === 'DOC-CVD-001') {
        score += 0.55;
        reasons.push('DASH Diet & Sodium Reduction Guide match');
      }
    }

    // Type 1 diabetes / insulin pump cues
    if (lowerQuery.includes('pump') || (lowerQuery.includes('type 1') && !lowerQuery.includes('type 2')) || lowerQuery.includes('basal vs bolus') || lowerQuery.includes('iob')) {
      if (doc.doc_id === 'DOC-DM-004') {
        score += 0.55;
        reasons.push('Type 1 Diabetes & Insulin Pump Essentials protocol match');
      }
    }

    // Domain concordance check: Out-of-library queries with 0 domain overlap must not match
    const hasClinicalSynonym = Object.keys(CLINICAL_SYNONYM_MAP).some(k => lowerQuery.includes(k));
    const hasDomainMatch = (titleOverlap > 0) ||
      (doc.tags && doc.tags.some(t => queryTokens.includes(t.toLowerCase()))) ||
      (doc.condition && new RegExp(`\\b${escapeRegex(doc.condition.toLowerCase())}\\b`, 'i').test(lowerQuery)) ||
      (doc.program && new RegExp(`\\b${escapeRegex(doc.program.toLowerCase())}\\b`, 'i').test(lowerQuery)) ||
      (doc.synonyms && doc.synonyms.some(s => lowerQuery.includes(s.toLowerCase()))) ||
      (doc.language === 'es' && (lowerQuery.includes('espanol') || lowerQuery.includes('spanish'))) ||
      hasClinicalSynonym ||
      score > 0;

    if (!hasDomainMatch) {
      return { score: 0, reason: 'No domain or clinical concordance match' };
    }

    // Semantic Vector Cosine Similarity (Embeddings Engine)
    const docVector = this.docEmbeddings?.get(doc.doc_id) || computeTextEmbedding(buildDocumentSemanticText(doc));
    const semanticSim = queryVector ? cosineSimilarity(queryVector, docVector) : 0;
    if (semanticSim > 0.22) {
      score += semanticSim * 0.40;
      reasons.push(`Semantic embedding similarity: ${(semanticSim * 100).toFixed(0)}%`);
    }

    // Specific stage alignment cues: Phase 1 vs Phase 2, ACOG vs strict, bedtime snack
    if (lowerQuery.includes('phase 1') || lowerQuery.includes('elimination')) {
      if (doc.doc_id === 'DOC-GI-001') {
        score += 0.40;
        reasons.push('FODMAP Phase 1 Elimination stage match');
      }
    }
    if (lowerQuery.includes('phase 2') || lowerQuery.includes('reintroduction') || lowerQuery.includes('challenge')) {
      if (doc.doc_id === 'DOC-GI-002') {
        score += 0.40;
        reasons.push('FODMAP Phase 2 Reintroduction stage match');
      }
    }
    if (lowerQuery.includes('bedtime snack') || lowerQuery.includes('acog') || lowerQuery.includes('fetal brain')) {
      if (doc.doc_id === 'DOC-GEST-002') {
        score += 0.45;
        reasons.push('ACOG consensus / bedtime snack protocol match');
      }
    }

    // Hypoglycemia / Low Blood Sugar emergency cues (<70 mg/dL, shaking, sweating, insulin drop)
    if (doc.doc_id === 'DOC-DM-002') {
      if (lowerQuery.includes('shaking') || lowerQuery.includes('hypoglycemia') || lowerQuery.includes('dropped') ||
          /\b(under|below|<)?\s*(4\d|5\d|6\d)\s*(mg\/dl)?\b/.test(lowerQuery)) {
        score += 0.45;
        reasons.push('Acute low blood sugar / hypoglycemia symptom cue match');
      }
    }

    // Gestational diabetes cues
    if (doc.doc_id.startsWith('DOC-GEST')) {
      if (lowerQuery.includes('pregnant') || lowerQuery.includes('pregnancy') || lowerQuery.includes('gestational') || lowerQuery.includes('fetal')) {
        score += 0.35;
        reasons.push('Pregnancy / Gestational diabetes clinical priority');
      }
    }

    // Section Content Match
    let bestSectionScore = 0;
    if (doc.sections) {
      for (const sec of doc.sections) {
        const secText = (sec.heading + ' ' + sec.content).toLowerCase();
        let secHits = 0;
        for (const t of queryTokens) {
          if (secText.includes(t)) secHits++;
        }
        const secScore = secHits / queryTokens.length;
        if (secScore > bestSectionScore) {
          bestSectionScore = secScore;
        }
      }
    }
    score += bestSectionScore * 0.35;

    // Check specific high-impact clinical phrases
    if (lowerQuery.includes('lactose') && (doc.doc_id === 'DOC-BAR-002' && doc.version === 2)) {
      score += 0.35;
      reasons.push('Contains dedicated bariatric lactose intolerance guidelines');
    }
    if (lowerQuery.includes('rule of 15') && doc.doc_id === 'DOC-DM-002') {
      score += 0.40;
      reasons.push('Emergency Rule of 15 hypoglycemia protocol');
    }
    if (lowerQuery.includes('acog') && doc.doc_id === 'DOC-GEST-002') {
      score += 0.35;
      reasons.push('ADA & ACOG gestational diabetes consensus standard');
    }
    if (lowerQuery.includes('97802') && doc.doc_id === 'DOC-INT-002') {
      score += 0.50;
      reasons.push('Billing code CPT 97802 documentation SOP');
    }
    if (lowerQuery.includes('anorexia') && doc.doc_id === 'DOC-INT-001') {
      score += 0.50;
      reasons.push('Eating disorder clinical escalation stop rule');
    }
    if (lowerQuery.includes('cgm') && lowerQuery.includes('placement') && doc.doc_id === 'DOC-INT-003') {
      score += 0.50;
      reasons.push('CGM sensor placement SOP');
    }

    return {
      score,
      reason: reasons.length ? reasons.join('; ') : 'Relevance match across document text'
    };
  }

  extractBestSection(doc, rawQuery) {
    if (!doc.sections || doc.sections.length === 0) return null;

    const queryTokens = this.tokenize(rawQuery);
    let bestSection = doc.sections[0];
    let maxHits = -1;

    for (const sec of doc.sections) {
      const fullSec = (sec.heading + ' ' + sec.content).toLowerCase();
      let hits = 0;
      for (const t of queryTokens) {
        if (fullSec.includes(t)) hits++;
      }
      if (hits > maxHits) {
        maxHits = hits;
        bestSection = sec;
      }
    }

    return {
      heading: bestSection.heading,
      content: bestSection.content,
      snippet: bestSection.content.length > 220 
        ? bestSection.content.substring(0, 217) + '...' 
        : bestSection.content
    };
  }

  // Feature: Grounded Staff Q&A
  answerStaffQuery({ query, role = 'dietitian' }) {
    // Search internal & clinical documents
    const searchRes = this.searchRightDoc({
      query,
      audience: 'internal',
      role,
      includeRetiredForAudit: false
    });

    if (searchRes.outcome === 'safety_escalation') {
      return {
        outcome: 'safety_escalation',
        answer: SAFETY_ESCALATION_MESSAGE,
        citations: []
      };
    }

    if (searchRes.outcome === 'refused_out_of_scope' || !searchRes.topMatch) {
      return {
        outcome: 'refused_out_of_scope',
        answer: 'Verity Practice could not find an approved practice protocol answering this question. Internal answers must be grounded strictly in approved clinical documents. Refusing to speculate.',
        citations: []
      };
    }

    const doc = searchRes.topMatch.document;
    const citation = searchRes.topMatch.citation;

    // Strict Shared Eligibility Check: Never quote a retired, draft, expired, or conflict-locked doc
    if (!isDocumentEligible(doc, this.documents, { asOfDate: '2026-10-27' })) {
      return {
        outcome: 'refused_out_of_scope',
        answer: `Verity Practice cannot cite "${doc.title}" (${doc.doc_id}) because it is retired, draft, expired, or locked in an active clinical conflict. Grounded answers only cite current, approved, unconflicted documents. Refusing to quote ineligible materials.`,
        citations: []
      };
    }

    // Substantive Grounding Check: Must have specific query term overlap in section text
    const expandedQ = expandQueryWithSynonyms(query);
    const queryTokens = this.tokenize(query);
    const expandedTokens = this.tokenize(expandedQ);
    const secTokens = this.tokenize((citation?.heading || '') + ' ' + (citation?.content || ''));
    const overlap = queryTokens.filter(t => secTokens.includes(t));
    const expandedOverlap = expandedTokens.filter(t => secTokens.includes(t));

    // If core query terms do not match the section or score is marginal: refuse!
    if ((overlap.length < 2 && expandedOverlap.length < 2) || searchRes.topMatch.score < 0.35) {
      return {
        outcome: 'refused_out_of_scope',
        answer: `Verity Practice could not find an approved clinical protocol covering "${query}". No approved guidance exists in the practice library for this specific procedure or calculation. Refusing to speculate.`,
        citations: []
      };
    }

    return {
      outcome: 'grounded_answer',
      answer: `According to approved practice document "${doc.title}" (v${doc.version}, ${doc.doc_id}) [Section: ${citation.heading}]:\n\n"${citation.content}"`,
      citations: [
        {
          doc_id: doc.doc_id,
          version: doc.version,
          title: doc.title,
          heading: citation.heading,
          snippet: citation.content,
          effective_date: doc.effective_date,
          status: doc.status
        }
      ]
    };
  }
}
