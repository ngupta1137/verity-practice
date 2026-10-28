// Verity Practice: Semantic Embeddings & Clinical Synonym/Brand Map Engine
// Feature: Semantic Retrieval for Right Doc & Grounded Q&A

// 1. Comprehensive Clinical Synonym & Brand Map
export const CLINICAL_SYNONYM_MAP = {
  // SGLT2 Inhibitors (Brand <-> Class <-> Clinical Warnings)
  'jardiance': ['sglt2 inhibitor', 'empagliflozin', 'sick day rules', 'dka risk', 'dehydration', 'hold sglt2i'],
  'farxiga': ['sglt2 inhibitor', 'dapagliflozin', 'sick day rules', 'dka risk', 'hold sglt2i'],
  'invokana': ['sglt2 inhibitor', 'canagliflozin', 'sick day rules'],
  'steglatro': ['sglt2 inhibitor', 'ertugliflozin'],

  // GLP-1 / GIP Incretin Mimetics
  'ozempic': ['glp-1', 'semaglutide', 'delayed gastric emptying', 'incretin', 'nausea'],
  'wegovy': ['glp-1', 'semaglutide', 'weight management', 'satiety'],
  'mounjaro': ['glp-1', 'gip', 'tirzepatide', 'dual incretin agonist'],
  'zepbound': ['glp-1', 'gip', 'tirzepatide', 'weight loss'],
  'trulicity': ['glp-1', 'dulaglutide'],
  'victoza': ['glp-1', 'liraglutide'],
  'saxenda': ['glp-1', 'liraglutide'],
  'rybelsus': ['oral glp-1', 'oral semaglutide'],

  // Acute Low Blood Sugar / Hypoglycemia Symptoms & Emergency Action
  'shaky': ['hypoglycemia', 'low blood sugar', 'tremor', 'rule of 15', 'glucose drop', 'acute hypoglycemia'],
  'shaking': ['hypoglycemia', 'low blood sugar', 'tremor', 'rule of 15', 'glucose drop'],
  'sugar low': ['hypoglycemia', 'low blood sugar', 'glucose below 70', 'rule of 15', 'fast acting carbs'],
  'low sugar': ['hypoglycemia', 'low blood sugar', 'glucose below 70', 'rule of 15'],
  'sugar was low': ['hypoglycemia', 'low blood sugar', 'glucose below 70', 'rule of 15'],
  'sugar dropped': ['hypoglycemia', 'glucose drop', 'rule of 15'],
  'blood sugar drop': ['hypoglycemia', 'rule of 15', 'acute low blood glucose'],
  'clammy': ['hypoglycemia', 'diaphoresis', 'sweating'],
  'diaphoresis': ['sweating', 'hypoglycemia symptom'],

  // Acute Illness / Sick-Day Management Cues
  'flu': ['sick day', 'acute illness', 'infection', 'ketones', 'dka', 'hydration', 'fever', 'nausea'],
  'not eating': ['unable to eat', 'reduced oral intake', 'sick day', 'continue basal insulin', 'hold sglt2i'],
  'unable to eat': ['sick day', 'sip carbs', 'hydration'],
  'vomiting': ['sick day', 'emesis', 'ketones', 'hydration', 'electrolyte'],
  'fever': ['sick day', 'infection', 'insulin resistance increase'],

  // Renal / Kidney Disease Cues
  'kidney disease': ['ckd', 'diabetic kidney disease', 'dkd', 'renal', 'nephropathy', 'protein restriction'],
  'stage 3 kidney': ['ckd stage 3', 'diabetic kidney disease', 'dkd', 'renal protein restriction'],
  'diabetic nephropathy': ['dkd', 'diabetic kidney disease', 'renal protein restriction'],
  'egfr': ['kidney function', 'ckd stage', 'renal'],

  // Gestational / Pregnancy
  'gdm': ['gestational diabetes', 'pregnancy', 'maternal carbs', 'fetal brain development'],
  'pregnant': ['pregnancy', 'gestational', 'maternal nutrition', 'carb floor 175g'],
  'fetal brain': ['acog', 'ada', 'gestational diabetes', '175g carbs'],

  // GI / FODMAP
  'fodmap phase 1': ['elimination phase', 'ibs relief', 'low fodmap'],
  'fodmap phase 2': ['reintroduction phase', 'fodmap challenge', 'food triggers']
};

// 2. Query Synonym Expansion
export function expandQueryWithSynonyms(rawQuery) {
  const lower = (rawQuery || '').toLowerCase();
  const additions = new Set();

  for (const [key, synonyms] of Object.entries(CLINICAL_SYNONYM_MAP)) {
    if (lower.includes(key)) {
      for (const s of synonyms) {
        additions.add(s);
      }
    }
  }

  if (additions.size === 0) return rawQuery;
  return `${rawQuery} ${Array.from(additions).join(' ')}`;
}

// 3. Subword N-Gram Hasher (Produces 256-Dimensional Dense Hash Embedding)
const EMBEDDING_DIM = 256;

function hashString(str) {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

const GENERIC_EMBED_WORDS = new Set([
  'diet', 'nutrition', 'guide', 'handout', 'protocol', 'patient', 'therapy', 'care',
  'management', 'plan', 'clinical', 'medical', 'give', 'need', 'needs', 'approach', 'daily'
]);

export function computeTextEmbedding(text) {
  const vector = new Float32Array(EMBEDDING_DIM);
  if (!text) return vector;

  const normalized = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const words = normalized.replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 1 && !GENERIC_EMBED_WORDS.has(w));

  // Word-level hash embedding
  for (const word of words) {
    const wHash = hashString(word) % EMBEDDING_DIM;
    vector[wHash] += 2.0;

    // Character 3-gram embeddings for morphological flexibility (e.g. hypoglyc*, jardian*)
    if (word.length >= 3) {
      for (let i = 0; i <= word.length - 3; i++) {
        const tri = word.substring(i, i + 3);
        const tHash = hashString(tri) % EMBEDDING_DIM;
        vector[tHash] += 0.8;
      }
    }
    // Character 4-gram embeddings
    if (word.length >= 4) {
      for (let i = 0; i <= word.length - 4; i++) {
        const tetra = word.substring(i, i + 4);
        const tetraHash = hashString(tetra) % EMBEDDING_DIM;
        vector[tetraHash] += 1.0;
      }
    }
  }

  // Clinical Domain Semantic Anchor Weights
  const domainAnchors = [
    { keys: ['sglt2', 'jardiance', 'farxiga', 'empagliflozin', 'dka', 'flu', 'sick day', 'ketone', 'vomit', 'not eating'], dim: 12, weight: 6.0 },
    { keys: ['hypoglycemia', 'low blood sugar', 'shaky', 'shaking', 'sugar low', 'rule of 15', 'glucose drop', 'sweat', 'tremor'], dim: 24, weight: 6.0 },
    { keys: ['glp-1', 'semaglutide', 'wegovy', 'ozempic', 'mounjaro', 'tirzepatide', 'zepbound', 'nausea', 'fullness'], dim: 36, weight: 5.0 },
    { keys: ['gestational', 'gdm', 'pregnancy', 'pregnant', 'acog', 'fetal', 'trimester', '175g'], dim: 48, weight: 5.0 },
    { keys: ['bariatric', 'bypass', 'sleeve', 'pureed', 'dumping', 'clear liquids', 'stage 1', 'stage 2', 'stage 3', 'stage 4'], dim: 60, weight: 5.0 },
    { keys: ['kidney', 'ckd', 'renal', 'diabetic kidney', 'dkd', 'protein restriction', 'egfr', 'nephropathy'], dim: 72, weight: 5.0 },
    { keys: ['fodmap', 'ibs', 'elimination', 'reintroduction', 'phase 1', 'phase 2', 'bloating'], dim: 84, weight: 5.0 },
    { keys: ['prediabetes', 'dpp', 'a1c', 'lifestyle intervention', 'insulin sensitivity'], dim: 96, weight: 5.0 },
    { keys: ['cpt', '97802', '97803', 'billing', 'mnt', 'superbill', 'documentation'], dim: 108, weight: 5.0 },
    { keys: ['anorexia', 'eating disorder', 'refusal', 'ed escalation', 'purging', 'scoff'], dim: 120, weight: 6.0 }
  ];

  for (const anchor of domainAnchors) {
    for (const k of anchor.keys) {
      if (normalized.includes(k)) {
        vector[anchor.dim] += anchor.weight;
      }
    }
  }

  // L2 Normalization
  let norm = 0;
  for (let i = 0; i < EMBEDDING_DIM; i++) {
    norm += vector[i] * vector[i];
  }
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < EMBEDDING_DIM; i++) {
      vector[i] /= norm;
    }
  }

  return vector;
}

// 4. Cosine Similarity Function
export function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB) return 0;
  let dot = 0;
  for (let i = 0; i < EMBEDDING_DIM; i++) {
    dot += vecA[i] * vecB[i];
  }
  return Math.max(0, Math.min(1.0, dot));
}

// 5. Document Full Semantic Representation Builder
export function buildDocumentSemanticText(doc) {
  const parts = [
    doc.title || '',
    doc.summary || '',
    (doc.tags || []).join(' '),
    (doc.synonyms || []).join(' '),
    doc.condition || '',
    doc.program || '',
    doc.patient_stage || ''
  ];
  if (doc.sections) {
    for (const s of doc.sections) {
      parts.push(s.heading || '');
      parts.push(s.content || '');
    }
  }
  return parts.join(' ');
}
