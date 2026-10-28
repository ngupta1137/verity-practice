// Verity Practice: Audit Ledger & Owner Analytics Engine
// Feature: Audit Log & Owner Dashboard Aggregation

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkStaleness, detectConflicts } from './conflicts.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class AuditLedger {
  constructor(initialEntries = []) {
    this.entries = [...initialEntries].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  }

  logEvent({
    actor = 'Elena Gomez, RD',
    role = 'dietitian',
    action, // 'SEND_COMPLETED' | 'SEND_BLOCKED' | 'PRE_SEND_CHECK' | 'SEARCH_RIGHT_DOC' | 'UPLOAD_DOC' | 'APPROVE_DOC'
    doc_id,
    version,
    doc_title,
    patient_id = null,
    patient_context = null,
    recipient_name = null,
    content_hash = null,
    verified_identifiers = null,
    status, // 'APPROVED' | 'BLOCKED' | 'WARNED'
    gate_result, // 'PASS' | 'FAIL'
    details = ''
  }) {
    const entry = {
      event_id: `AUD-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      timestamp: new Date().toISOString(),
      actor,
      role,
      action,
      doc_id,
      version,
      content_hash,
      doc_title,
      patient_id,
      recipient_id: patient_id,
      recipient_name,
      patient_context,
      verified_identifiers,
      status,
      gate_result,
      details
    };


    this.entries.unshift(entry);
    this.persist();
    return entry;
  }

  persist() {
    try {
      const candidates = [
        path.resolve(process.cwd(), 'data/audit_log.json'),
        path.resolve(__dirname, '../../data/audit_log.json'),
        path.resolve(__dirname, '../data/audit_log.json')
      ];
      for (const p of candidates) {
        if (fs.existsSync(path.dirname(p))) {
          fs.writeFileSync(p, JSON.stringify(this.entries, null, 2), 'utf8');
          break;
        }
      }
    } catch (err) {
      console.warn('Audit ledger persistence notice:', err.message);
    }
  }

  resetToSeed(seedEntries = []) {
    this.entries = [...seedEntries].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    this.persist();
    return this.entries;
  }

  getEntries(limit = 100) {
    return this.entries
      .slice()
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, limit);
  }

  getOwnerDashboardStats(allDocuments) {
    const totalEvents = this.entries.length;
    const sendCompleted = this.entries.filter(e => e.action === 'SEND_COMPLETED' || (e.action && e.action.includes('SEND') && e.gate_result === 'PASS'));
    const sendBlocked = this.entries.filter(e => e.action === 'SEND_BLOCKED' || e.action === 'PRE_SEND_CHECK_FAIL' || (e.action && e.action.includes('SEND') && e.gate_result === 'FAIL'));
    
    // Most used documents
    const usageMap = {};
    for (const send of sendCompleted) {
      const key = `${send.doc_id} v${send.version}: ${send.doc_title}`;
      usageMap[key] = (usageMap[key] || 0) + 1;
    }
    const mostUsed = Object.entries(usageMap)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // Staleness & Expiry analysis
    const staleness = checkStaleness(allDocuments);

    // Conflicts analysis
    const conflicts = detectConflicts(allDocuments);

    // Compliance Rate
    const totalSendAttempts = sendCompleted.length + sendBlocked.length;
    const complianceRate = totalSendAttempts > 0 
      ? Math.round((sendCompleted.length / totalSendAttempts) * 100) 
      : null;
    const complianceRateDisplay = totalSendAttempts > 0
      ? `${complianceRate}%`
      : 'No sends yet';

    return {
      summary: {
        totalSendAttempts,
        successfulSends: sendCompleted.length,
        blockedSends: sendBlocked.length,
        complianceRate,
        complianceRateDisplay,
        expiredDocsCount: staleness.expired.length,
        dueSoonCount: staleness.dueSoon.length,
        activeConflictsCount: conflicts.length
      },
      mostUsed,
      recentBlockedSends: sendBlocked.slice(0, 5),
      documentsDueForReview: [...staleness.expired, ...staleness.dueSoon],
      conflicts,
      recentActivity: this.entries.slice(0, 10)
    };
  }
}
