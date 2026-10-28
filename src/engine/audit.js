// Verity Practice: Audit Ledger & Owner Analytics Engine
// Feature: Audit Log & Owner Dashboard Aggregation

import fs from 'node:fs';
import path from 'node:path';
import { checkStaleness, detectConflicts } from './conflicts.js';

export class AuditLedger {
  constructor(initialEntries = []) {
    this.entries = [...initialEntries];
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
      doc_title,
      patient_id,
      patient_context,
      status,
      gate_result,
      details
    };

    this.entries.unshift(entry);
    return entry;
  }

  getEntries(limit = 100) {
    return this.entries.slice(0, limit);
  }

  getOwnerDashboardStats(allDocuments) {
    const totalEvents = this.entries.length;
    const sendCompleted = this.entries.filter(e => e.action === 'SEND_COMPLETED');
    const sendBlocked = this.entries.filter(e => e.action === 'SEND_BLOCKED');
    
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
      : 100;

    return {
      summary: {
        totalSendAttempts,
        successfulSends: sendCompleted.length,
        blockedSends: sendBlocked.length,
        complianceRate,
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
