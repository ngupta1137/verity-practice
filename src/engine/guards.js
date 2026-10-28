// Verity-RD guards: PHI/PII Redaction and Medical Safety Escalation
// Lineage: Adapted from ngupta1137/verity src/engine/guards.ts

const REDACTIONS = [
  { label: 'SSN', re: /\b(ssn|social security( number)?)?[:#\s]*\d{3}-\d{2}-\d{4}\b/gi },
  { label: 'PHONE', re: /\b(phone|tel|cell)?[:#\s]*\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/gi },
  { label: 'DOB', re: /\b(dob|d\.o\.b\.?|date of birth|born( on)?)?[:\s]*\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/gi },
  { label: 'MRN', re: /\b(mrn|patient id|chart #|member id|chart)[:#\s]*[A-Z0-9]{4,12}\b|\bMRN\d{5,10}\b/gi },
  { label: 'EMAIL', re: /\b[\w.+-]+@[\w-]+\.[\w.]+\b/g },
  { label: 'NAME', re: /\b([Pp]atient|[Mm]ember|[Cc]aller|[Nn]ame is|[Ff]or)\s+[A-Z][a-z]+\s+[A-Z][a-z]+\b/g }
];

export function redactPHI(text) {
  if (!text || typeof text !== 'string') return { text: '', applied: [] };
  let sanitized = text;
  const applied = [];

  for (const item of REDACTIONS) {
    if (item.re.test(sanitized)) {
      applied.push(item.label);
      sanitized = sanitized.replace(item.re, ` [${item.label}]`).replace(/\s+/g, ' ').trim();
    }
    item.re.lastIndex = 0;
  }

  return { text: sanitized, applied };
}

const EMERGENCY_PATTERNS = [
  /chest pain|chest (is )?(tight|pressure)|heart attack/i,
  /can'?t breathe|cannot breathe|trouble breathing|short(ness)? of breath|gasping/i,
  /suicid|kill (myself|me)|end (my|her|his) life|self[- ]harm|want to die/i,
  /overdos|took (all|too many) (pills|meds|medication)/i,
  /stroke|unconscious|unresponsive|passed out|fainted|seizure|slurred speech/i,
  /severe bleeding|bleeding heavily|won'?t stop bleeding/i
];

export function safetyCheck(query) {
  if (!query || typeof query !== 'string') return null;
  for (const re of EMERGENCY_PATTERNS) {
    const m = query.match(re);
    if (m) return m[0];
  }
  return null;
}

export const SAFETY_ESCALATION_MESSAGE =
  'EMERGENCY ALERT: This query describes an acute medical or psychiatric emergency. ' +
  'Verity Practice has halted automated clinical lookup. If this is an immediate emergency, call 911 or direct the patient to the nearest emergency room immediately.';
