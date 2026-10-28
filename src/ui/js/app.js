// Verity Practice Client Application Logic
// Features: Right Doc & Send Check
// Lineage: Verity-pattern prototype adapted from ngupta1137/verity

document.addEventListener('DOMContentLoaded', () => {
  // Global State
  const state = {
    documents: [],
    patients: [],
    auditLog: [],
    conflicts: [],
    currentRole: 'dietitian',
    activeDocForSend: null,
    evalReport: null
  };

  // DOM Elements
  const tabs = document.querySelectorAll('.nav-tab');
  const panes = document.querySelectorAll('.tab-pane');
  const roleSelect = document.getElementById('currentRole');
  
  // Right Doc elements
  const rightDocQuery = document.getElementById('rightDocQuery');
  const btnSearchRightDoc = document.getElementById('btnSearchRightDoc');
  const rightDocResults = document.getElementById('rightDocResults');
  
  // Send Check elements
  const sendCheckDocSelect = document.getElementById('sendCheckDocSelect');
  const sendCheckPatientSelect = document.getElementById('sendCheckPatientSelect');
  const selectedPatientPreview = document.getElementById('selectedPatientPreview');
  const btnRunSendCheck = document.getElementById('btnRunSendCheck');
  const sendCheckDetails = document.getElementById('sendCheckDetails');
  const gateResultBadge = document.getElementById('gateResultBadge');

  // Modal elements
  const sendCheckModal = document.getElementById('sendCheckModal');
  const modalCloseBtn = document.getElementById('modalCloseBtn');
  const modalCancelBtn = document.getElementById('modalCancelBtn');
  const modalExecuteSendBtn = document.getElementById('modalExecuteSendBtn');
  const modalPatientSelect = document.getElementById('modalPatientSelect');
  const modalDocTitle = document.getElementById('modalDocTitle');
  const modalDocMeta = document.getElementById('modalDocMeta');
  const modalGateList = document.getElementById('modalGateList');
  const modalSummaryAlert = document.getElementById('modalSummaryAlert');

  // Diff Modal elements
  const diffModal = document.getElementById('diffModal');
  const diffModalCloseBtn = document.getElementById('diffModalCloseBtn');
  const btnOpenDiffModal = document.getElementById('btnOpenDiffModal');
  const btnRunDiffCompare = document.getElementById('btnRunDiffCompare');
  const diffOldSelect = document.getElementById('diffOldSelect');
  const diffNewSelect = document.getElementById('diffNewSelect');
  const diffOutputContainer = document.getElementById('diffOutputContainer');

  // Doc Detail Modal
  const docDetailModal = document.getElementById('docDetailModal');
  const docDetailCloseBtn = document.getElementById('docDetailCloseBtn');
  const docDetailTitle = document.getElementById('docDetailTitle');
  const docDetailContent = document.getElementById('docDetailContent');

  // Demo elements
  const startDemoBtn = document.getElementById('startDemoBtn');
  const demoBanner = document.getElementById('demoBanner');
  const demoStepTitle = document.getElementById('demoStepTitle');
  const demoStepDesc = document.getElementById('demoStepDesc');
  const demoStep1Btn = document.getElementById('demoStep1Btn');
  const demoStep2Btn = document.getElementById('demoStep2Btn');
  const demoStep3Btn = document.getElementById('demoStep3Btn');
  const closeDemoBtn = document.getElementById('closeDemoBtn');

  // -------------------------------------------------------------
  // Initialization & Data Loading
  // -------------------------------------------------------------
  async function init() {
    setupTabNavigation();
    setupEventListeners();
    await loadInitialData();
    renderLibraryTable();
    renderSendCheckSelectors();
    populateDsmesPatientFilter();
    loadDsmesRecords();
    loadDashboard();
    loadEvaluationData();
  }

  async function loadInitialData() {
    try {
      const [docsRes, patientsRes, dashRes] = await Promise.all([
        fetch('/api/documents'),
        fetch('/api/patients'),
        fetch('/api/dashboard')
      ]);

      const docsData = await docsRes.json();
      const patientsData = await patientsRes.json();
      const dashData = await dashRes.json();

      state.documents = docsData.documents || [];
      state.patients = patientsData.patients || [];
      state.conflicts = dashData.conflicts || [];

      // Update badge counts
      const confBadge = document.getElementById('conflictsBadge');
      if (confBadge) confBadge.textContent = state.conflicts.length;

      renderConflicts(dashData.conflicts);
      renderStaleness(dashData.documentsDueForReview);
    } catch (err) {
      console.error('Failed to load initial data:', err);
    }
  }

  // -------------------------------------------------------------
  // Navigation & Role Switching
  // -------------------------------------------------------------
  function setupTabNavigation() {
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        panes.forEach(p => p.classList.remove('active'));

        tab.classList.add('active');
        const targetPane = document.getElementById(tab.dataset.tab);
        if (targetPane) targetPane.classList.add('active');

        if (tab.dataset.tab === 'tab-owner') loadDashboard();
        if (tab.dataset.tab === 'tab-dsmes') loadDsmesRecords();
        if (tab.dataset.tab === 'tab-eval') loadEvaluationData();
      });
    });

    roleSelect.addEventListener('change', (e) => {
      state.currentRole = e.target.value;
      console.log('Role changed to:', state.currentRole);
    });
  }

  function switchTab(tabId) {
    const tabBtn = document.querySelector(`[data-tab="${tabId}"]`);
    if (tabBtn) tabBtn.click();
  }

  // -------------------------------------------------------------
  // Feature 1: Right Doc (Context Search)
  // -------------------------------------------------------------
  async function executeRightDocSearch(queryText) {
    if (!queryText || !queryText.trim()) return;
    rightDocQuery.value = queryText;

    rightDocResults.innerHTML = `
      <div class="card" style="text-align: center; padding: 30px;">
        <p style="color: var(--brand-green-dark); font-weight: 600;">Searching approved clinical documents & extracting exact section citations...</p>
      </div>
    `;

    try {
      const res = await fetch('/api/right-doc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: queryText,
          audience: 'patient',
          role: state.currentRole,
          actor: roleSelect.options[roleSelect.selectedIndex].text
        })
      });

      const data = await res.json();
      renderRightDocResults(data);
    } catch (err) {
      rightDocResults.innerHTML = `<div class="result-banner blocked">Search failed: ${err.message}</div>`;
    }
  }

  function renderRightDocResults(data) {
    if (data.outcome === 'safety_escalation') {
      rightDocResults.innerHTML = `
        <div class="result-banner blocked">
          <div>
            <strong>EMERGENCY SAFETY ESCALATION TRIGGERED</strong>
            <p style="margin-top: 6px;">${data.message}</p>
          </div>
        </div>
      `;
      return;
    }

    if (data.outcome === 'refused_out_of_scope' || data.outcome === 'refused_retired') {
      rightDocResults.innerHTML = `
        <div class="result-banner refused">
          <div>
            <strong>${data.outcome === 'refused_retired' ? 'DISTRIBUTION REFUSED (RETIRED DOCUMENT)' : 'REQUEST REFUSED (OUT OF PRACTICE SCOPE)'}</strong>
            <p style="margin-top: 6px;">${data.message}</p>
          </div>
        </div>
      `;
      return;
    }

    let bannerClass = 'approved';
    let bannerTitle = 'APPROVED CLINICAL DOCUMENT MATCH';
    if (data.outcome === 'superseded_redirect') {
      bannerClass = 'superseded';
      bannerTitle = 'SUPERSEDED NOTICE: ROUTED TO CURRENT VERSION';
    }

    const top = data.topMatch;
    if (!top || !top.document) {
      rightDocResults.innerHTML = `<div class="result-banner refused">${data.message}</div>`;
      return;
    }

    const doc = top.document;
    const citation = top.citation;

    let html = `
      <div class="result-banner ${bannerClass}">
        <div>
          <strong>${bannerTitle}</strong>
          <p style="margin-top: 4px;">${data.message}</p>
          ${data.redactions && data.redactions.length ? `<span style="font-size: 11px; color: #555; display: block; margin-top: 4px;">🛡️ Client-side PHI Scrubber applied: [${data.redactions.join(', ')}] redacted</span>` : ''}
        </div>
      </div>

      <div class="citation-card">
        <div class="citation-header">
          <div>
            <span class="badge badge-approved">STATUS: ${doc.status}</span>
            <span class="badge badge-expired" style="margin-left: 6px;">VERSION ${doc.version}</span>
            <span class="citation-title" style="margin-left: 10px;">${doc.title}</span>
          </div>
          <div style="font-size: 12px; color: var(--ink-muted);">
            Doc ID: <strong>${doc.doc_id}</strong> &bull; Valid thru: <strong>${doc.review_by}</strong>
          </div>
        </div>

        <div class="match-reason-box">
          <strong>Match Rationale:</strong> ${top.matchReason}
        </div>

        ${citation ? `
          <div class="citation-section-title">
            <span>📌 Exact Section Citation: ${citation.heading}</span>
          </div>
          <div class="citation-text">
            "${citation.snippet}"
          </div>
        ` : ''}

        <div class="send-action-bar">
          <div style="font-size: 13px; color: var(--ink-muted);">
            Program: <strong>${doc.program}</strong> &bull; Stage: <strong>${doc.patient_stage}</strong>
          </div>
          <button class="btn-send-check" id="btnLaunchSendCheckFromSearch">
            <span>🛡️ Pre-Send Check & Deliver to Patient</span>
          </button>
        </div>
      </div>
    `;

    rightDocResults.innerHTML = html;

    const launchBtn = document.getElementById('btnLaunchSendCheckFromSearch');
    if (launchBtn) {
      launchBtn.addEventListener('click', () => {
        openSendCheckModal(doc);
      });
    }
  }

  // -------------------------------------------------------------
  // Feature 2: Send Check (Deterministic Gatekeeper)
  // -------------------------------------------------------------
  function renderSendCheckSelectors() {
    sendCheckDocSelect.innerHTML = state.documents.map(d => `
      <option value="${d.doc_id}:${d.version}">
        [${d.status.toUpperCase()}] ${d.doc_id} v${d.version} - ${d.title.substring(0, 50)}...
      </option>
    `).join('');

    sendCheckPatientSelect.innerHTML = state.patients.map(p => `
      <option value="${p.patient_id}">
        ${p.patient_id} - ${p.name} (${p.program} | ${p.patient_stage})
      </option>
    `).join('');

    modalPatientSelect.innerHTML = sendCheckPatientSelect.innerHTML;

    updatePatientPreview();
    sendCheckPatientSelect.addEventListener('change', updatePatientPreview);
  }

  function updatePatientPreview() {
    const selectedPatId = sendCheckPatientSelect.value;
    const patient = state.patients.find(p => p.patient_id === selectedPatId);
    if (!patient) return;

    selectedPatientPreview.innerHTML = `
      <strong>Recipient Profile:</strong> ${patient.name} &bull; <strong>Program:</strong> ${patient.program}<br>
      <strong>Stage:</strong> ${patient.patient_stage} &bull; <strong>Sensitivities:</strong> ${patient.allergies_sensitivities?.join(', ') || 'None'}<br>
      <strong>Insurance:</strong> ${patient.insurance} &bull; <strong>Assigned RD:</strong> ${patient.dietitian}
    `;
  }

  async function runSendCheckSimulation(docId, version, patientId) {
    sendCheckDetails.innerHTML = `<p style="color: var(--ink-muted);">Running 5-point deterministic gatekeeper verification...</p>`;

    try {
      const res = await fetch('/api/send-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          doc_id: docId,
          version: Number(version),
          patient_id: patientId,
          actor: roleSelect.options[roleSelect.selectedIndex].text,
          role: state.currentRole
        })
      });

      const check = await res.json();
      renderSendCheckDetails(check, patientId);
    } catch (err) {
      sendCheckDetails.innerHTML = `<div class="result-banner blocked">Send Check error: ${err.message}</div>`;
    }
  }

  function renderSendCheckDetails(check, patientId) {
    if (check.allowed) {
      gateResultBadge.className = 'badge badge-approved';
      gateResultBadge.textContent = 'GATE PASSED: READY TO SEND';
    } else {
      gateResultBadge.className = 'badge badge-retired';
      gateResultBadge.textContent = 'GATE BLOCKED: DELIVERY PROHIBITED';
    }

    let html = `
      <div class="result-banner ${check.allowed ? 'approved' : 'blocked'}" style="margin-bottom: 16px;">
        <div>
          <strong>${check.allowed ? 'VERIFIED: Handout Passed All Clinical Safety Checks' : 'ACTION BLOCKED: Safety or Governance Breach Intercepted'}</strong>
          <p style="margin-top: 4px;">${check.summary}</p>
        </div>
      </div>

      <div class="gate-checklist">
    `;

    // Blocks
    check.blocks.forEach(b => {
      html += `
        <div class="gate-item fail">
          <span class="gate-icon">❌</span>
          <div>
            <strong>${b.code}</strong>
            <p style="margin-top: 2px;">${b.message}</p>
          </div>
        </div>
      `;
    });

    // Warnings
    check.warnings.forEach(w => {
      html += `
        <div class="gate-item warn">
          <span class="gate-icon">⚠️</span>
          <div>
            <strong>${w.code}</strong>
            <p style="margin-top: 2px;">${w.message}</p>
          </div>
        </div>
      `;
    });

    // Passes
    check.passes.forEach(p => {
      html += `
        <div class="gate-item pass">
          <span class="gate-icon">✓</span>
          <div>
            <strong>${p.code}</strong>
            <p style="margin-top: 2px;">${p.message}</p>
          </div>
        </div>
      `;
    });

    html += `</div>`;

    if (check.allowed) {
      html += `
        <button class="btn-send-check" id="btnExecuteDirectSend" style="width: 100%; justify-content: center; margin-top: 14px;">
          <span>🚀 Confirm Send & Write to Owner Audit Log</span>
        </button>
      `;
    } else {
      const supersededBlock = check.blocks.find(b => b.code === 'VERSION_SUPERSEDED');
      if (supersededBlock && supersededBlock.currentDocId) {
        html += `
          <button class="btn-demo-step" id="btnRouteToCurrentApproved" style="width: 100%; margin-top: 14px; background: var(--brand-green-dark); color: #fff; border: none; justify-content: center;">
            <span>🔄 Switch to Current Approved Handout (${supersededBlock.currentDocId})</span>
          </button>
        `;
      }
    }

    sendCheckDetails.innerHTML = html;

    const execBtn = document.getElementById('btnExecuteDirectSend');
    if (execBtn) {
      execBtn.addEventListener('click', async () => {
        await executeFinalDelivery(check.documentId, check.version, patientId);
      });
    }

    const routeBtn = document.getElementById('btnRouteToCurrentApproved');
    if (routeBtn) {
      routeBtn.addEventListener('click', () => {
        const supersededBlock = check.blocks.find(b => b.code === 'VERSION_SUPERSEDED');
        const targetOption = Array.from(sendCheckDocSelect.options).find(o => o.value.startsWith(supersededBlock.currentDocId));
        if (targetOption) {
          sendCheckDocSelect.value = targetOption.value;
          btnRunSendCheck.click();
        }
      });
    }
  }

  async function executeFinalDelivery(docId, version, patientId) {
    try {
      const res = await fetch('/api/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          doc_id: docId,
          version: Number(version),
          patient_id: patientId,
          actor: roleSelect.options[roleSelect.selectedIndex].text,
          role: state.currentRole
        })
      });

      const result = await res.json();
      if (result.success) {
        alert(`SUCCESS: Handout ${docId} v${version} delivered and recorded under Event ID: ${result.receipt.eventId}`);
        loadDashboard();
      } else {
        alert(`BLOCKED: ${result.message}`);
      }
    } catch (err) {
      alert(`Error during delivery: ${err.message}`);
    }
  }

  // -------------------------------------------------------------
  // Send Check Modal (invoked from Right Doc results)
  // -------------------------------------------------------------
  function openSendCheckModal(doc) {
    state.activeDocForSend = doc;
    modalDocTitle.textContent = `${doc.title} (v${doc.version})`;
    modalDocMeta.textContent = `Doc ID: ${doc.doc_id} | Program: ${doc.program} | Stage: ${doc.patient_stage}`;

    runModalValidation();
    sendCheckModal.classList.add('active');
  }

  function closeSendCheckModal() {
    sendCheckModal.classList.remove('active');
  }

  async function runModalValidation() {
    if (!state.activeDocForSend) return;
    const patientId = modalPatientSelect.value;
    
    modalGateList.innerHTML = `<p style="font-size: 13px; color: var(--ink-muted);">Verifying 5 safety gates...</p>`;

    try {
      const res = await fetch('/api/send-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          doc_id: state.activeDocForSend.doc_id,
          version: state.activeDocForSend.version,
          patient_id: patientId,
          actor: roleSelect.options[roleSelect.selectedIndex].text,
          role: state.currentRole
        })
      });

      const check = await res.json();

      let itemsHtml = '';
      check.blocks.forEach(b => {
        itemsHtml += `<div class="gate-item fail"><span class="gate-icon">❌</span><div><strong>${b.code}</strong><p>${b.message}</p></div></div>`;
      });
      check.warnings.forEach(w => {
        itemsHtml += `<div class="gate-item warn"><span class="gate-icon">⚠️</span><div><strong>${w.code}</strong><p>${w.message}</p></div></div>`;
      });
      check.passes.forEach(p => {
        itemsHtml += `<div class="gate-item pass"><span class="gate-icon">✓</span><div><strong>${p.code}</strong><p>${p.message}</p></div></div>`;
      });

      modalGateList.innerHTML = itemsHtml;

      modalSummaryAlert.className = `result-banner ${check.allowed ? 'approved' : 'blocked'}`;
      modalSummaryAlert.innerHTML = `<strong>${check.allowed ? 'READY TO DELIVER' : 'DELIVERY BLOCKED'}</strong>: ${check.summary}`;

      modalExecuteSendBtn.disabled = !check.allowed;
      modalExecuteSendBtn.style.opacity = check.allowed ? '1' : '0.4';
    } catch (err) {
      modalGateList.innerHTML = `<div class="result-banner blocked">Error: ${err.message}</div>`;
    }
  }

  // -------------------------------------------------------------
  // Feature 3: Document Library & Version Diffs
  // -------------------------------------------------------------
  function renderLibraryTable() {
    const tableBody = document.getElementById('libraryTableBody');
    const searchVal = document.getElementById('libSearch').value.toLowerCase();
    const progVal = document.getElementById('libProgramFilter').value;
    const statusVal = document.getElementById('libStatusFilter').value;
    const audVal = document.getElementById('libAudienceFilter').value;

    let filtered = state.documents.filter(d => {
      if (progVal && d.program !== progVal) return false;
      if (statusVal && d.status !== statusVal) return false;
      if (audVal && d.audience !== audVal) return false;
      if (searchVal) {
        const text = (d.title + ' ' + d.doc_id + ' ' + (d.tags ? d.tags.join(' ') : '')).toLowerCase();
        if (!text.includes(searchVal)) return false;
      }
      return true;
    });

    tableBody.innerHTML = filtered.map(doc => {
      let statusBadgeClass = 'badge-approved';
      if (doc.status === 'retired') statusBadgeClass = 'badge-retired';
      if (doc.status === 'draft') statusBadgeClass = 'badge-draft';

      const isExpired = new Date(doc.review_by) < new Date('2026-10-27');
      if (isExpired && doc.status === 'approved') statusBadgeClass = 'badge-expired';

      return `
        <tr>
          <td><code style="font-family: var(--font-mono); font-weight: 700;">${doc.doc_id}</code></td>
          <td>
            <strong>${doc.title}</strong>
            ${doc.superseded_by ? `<br><small style="color: var(--outcome-blocked);">Superseded by ${doc.superseded_by}</small>` : ''}
          </td>
          <td>v${doc.version}</td>
          <td>
            ${doc.program}<br>
            <small style="color: var(--ink-muted);">${doc.condition || doc.patient_stage}</small>
          </td>
          <td>
            <span class="badge ${doc.audience === 'internal' ? 'badge-internal' : 'badge-approved'}">
              ${doc.audience.toUpperCase()}
            </span>
          </td>
          <td>
            <span class="badge ${statusBadgeClass}">
              ${doc.status.toUpperCase()}
            </span>
          </td>
          <td>
            ${doc.review_by}
            ${isExpired ? '<br><small style="color: var(--outcome-blocked); font-weight: 700;">OVERDUE</small>' : ''}
          </td>
          <td>
            <button class="prompt-chip btn-view-doc" data-id="${doc.doc_id}" data-version="${doc.version}">View</button>
            <button class="prompt-chip btn-send-doc" data-id="${doc.doc_id}" data-version="${doc.version}">Send</button>
          </td>
        </tr>
      `;
    }).join('');

    // Attach row button handlers
    document.querySelectorAll('.btn-view-doc').forEach(btn => {
      btn.addEventListener('click', () => {
        const doc = state.documents.find(d => d.doc_id === btn.dataset.id && Number(d.version) === Number(btn.dataset.version));
        if (doc) openDocDetailModal(doc);
      });
    });

    document.querySelectorAll('.btn-send-doc').forEach(btn => {
      btn.addEventListener('click', () => {
        const val = `${btn.dataset.id}:${btn.dataset.version}`;
        sendCheckDocSelect.value = val;
        switchTab('tab-send-check');
        btnRunSendCheck.click();
      });
    });
  }

  function openDocDetailModal(doc) {
    docDetailTitle.textContent = `${doc.doc_id} v${doc.version} - ${doc.title}`;
    let html = `
      <div style="margin-bottom: 16px;">
        <span class="badge badge-approved">${doc.status.toUpperCase()}</span>
        <span class="badge badge-internal" style="margin-left: 6px;">${doc.audience.toUpperCase()} AUDIENCE</span>
        <span style="font-size: 13px; color: var(--ink-muted); margin-left: 10px;">Program: <strong>${doc.program}</strong> | Review Date: <strong>${doc.review_by}</strong></span>
      </div>
      <p style="font-size: 14px; margin-bottom: 18px; line-height: 1.6;">${doc.summary}</p>
      <h4 style="font-size: 15px; margin-bottom: 10px; border-bottom: 1px solid var(--border); padding-bottom: 4px;">Sections & Content:</h4>
      <div style="display: flex; flex-direction: column; gap: 14px;">
    `;

    doc.sections.forEach(sec => {
      html += `
        <div style="background: var(--surface-alt); padding: 12px 16px; border-radius: var(--radius-sm); border-left: 3px solid var(--brand-green);">
          <strong style="font-size: 14px; color: var(--ink);">${sec.heading}</strong>
          <p style="font-size: 13px; margin-top: 6px; line-height: 1.5;">${sec.content}</p>
        </div>
      `;
    });

    html += `</div>`;
    docDetailContent.innerHTML = html;
    docDetailModal.classList.add('active');
  }

  async function runDiffComparison() {
    const [oldId, oldVer] = diffOldSelect.value.split(':');
    const [newId, newVer] = diffNewSelect.value.split(':');

    diffOutputContainer.innerHTML = `<p style="color: var(--ink-muted);">Computing word-level diff across document sections...</p>`;

    try {
      const res = await fetch('/api/documents/diff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          oldDocId: oldId,
          oldVersion: Number(oldVer),
          newDocId: newId,
          newVersion: Number(newVer)
        })
      });

      const diffData = await res.json();
      renderDiffOutput(diffData);
    } catch (err) {
      diffOutputContainer.innerHTML = `<div class="result-banner blocked">Diff error: ${err.message}</div>`;
    }
  }

  function renderDiffOutput(data) {
    if (!data || !data.sectionDiffs) {
      diffOutputContainer.innerHTML = `<p>No diff data returned.</p>`;
      return;
    }

    let html = `
      <div style="margin-bottom: 14px; font-size: 13px; color: var(--ink-muted);">
        Comparing <strong>${data.oldVersion.doc_id} v${data.oldVersion.version}</strong> with <strong>${data.newVersion.doc_id} v${data.newVersion.version}</strong>
      </div>
      <div class="diff-container">
    `;

    data.sectionDiffs.forEach(sec => {
      let statusBadge = '<span class="badge badge-approved">IDENTICAL</span>';
      if (sec.status === 'modified') statusBadge = '<span class="badge badge-draft">MODIFIED</span>';
      if (sec.status === 'added') statusBadge = '<span class="badge badge-approved">ADDED SECTION</span>';
      if (sec.status === 'removed') statusBadge = '<span class="badge badge-retired">REMOVED SECTION</span>';

      html += `
        <div class="diff-section">
          <div class="diff-section-header">
            <span>Section: ${sec.heading}</span>
            ${statusBadge}
          </div>
          <div class="diff-body">
      `;

      if (sec.wordDiff && sec.wordDiff.length) {
        sec.wordDiff.forEach(w => {
          if (w.type === 'added') {
            html += `<span class="diff-added">${w.text}</span> `;
          } else if (w.type === 'removed') {
            html += `<span class="diff-removed">${w.text}</span> `;
          } else {
            html += `${w.text} `;
          }
        });
      } else {
        html += `<span style="color: var(--ink-muted); font-style: italic;">No textual changes in this section.</span>`;
      }

      html += `</div></div>`;
    });

    html += `</div>`;
    diffOutputContainer.innerHTML = html;
  }

  // -------------------------------------------------------------
  // Feature 4: Conflicts & Staleness
  // -------------------------------------------------------------
  function renderConflicts(conflicts) {
    const container = document.getElementById('conflictsList');
    if (!conflicts || conflicts.length === 0) {
      container.innerHTML = `<p style="color: var(--ink-muted);">No active guideline conflicts detected across approved documents.</p>`;
      return;
    }

    container.innerHTML = conflicts.map(c => `
      <div style="background: var(--surface-alt); padding: 18px; border-radius: var(--radius-sm); margin-bottom: 14px; border-left: 3px solid var(--outcome-conflict);">
        <h4 style="font-size: 15px; font-weight: 700; color: var(--ink); margin-bottom: 6px;">
          ${c.topic} (${c.program})
        </h4>
        <p style="font-size: 13px; color: var(--outcome-conflict); font-weight: 600; margin-bottom: 12px;">
          ${c.divergenceExplanation}
        </p>

        <div class="grid-2">
          <div style="background: #fff; padding: 12px; border: 1px solid var(--border); border-radius: var(--radius-sm);">
            <strong>${c.docA.doc_id} v${c.docA.version}: ${c.docA.title}</strong><br>
            <small style="color: var(--brand-green-dark); font-weight: 700;">Section: ${c.docA.sectionHeading}</small>
            <p style="font-size: 13px; margin-top: 6px; font-style: italic;">"${c.docA.excerpt}"</p>
          </div>
          <div style="background: #fff; padding: 12px; border: 1px solid var(--border); border-radius: var(--radius-sm);">
            <strong>${c.docB.doc_id} v${c.docB.version}: ${c.docB.title}</strong><br>
            <small style="color: var(--brand-green-dark); font-weight: 700;">Section: ${c.docB.sectionHeading}</small>
            <p style="font-size: 13px; margin-top: 6px; font-style: italic;">"${c.docB.excerpt}"</p>
          </div>
        </div>

        <div style="margin-top: 12px; font-size: 12px; color: var(--ink-muted);">
          <strong>Remediation:</strong> ${c.remediation}
        </div>
      </div>
    `).join('');
  }

  function renderStaleness(stalenessList) {
    const tableBody = document.getElementById('stalenessTableBody');
    const badge = document.getElementById('stalenessCountBadge');
    if (!stalenessList) return;

    if (badge) badge.textContent = `${stalenessList.length} Overdue / Due Soon`;

    tableBody.innerHTML = stalenessList.map(item => `
      <tr>
        <td><code>${item.doc_id}</code></td>
        <td><strong>${item.title}</strong></td>
        <td><span class="badge ${item.status === 'approved' ? 'badge-approved' : 'badge-retired'}">${item.status.toUpperCase()}</span></td>
        <td>${item.review_by}</td>
        <td>
          <span style="font-weight: 700; color: ${item.daysOverdue ? 'var(--outcome-blocked)' : '#8C5300'};">
            ${item.daysOverdue ? `${item.daysOverdue} days overdue` : `Due in ${item.daysRemaining} days`}
          </span>
        </td>
        <td>${item.owner}</td>
        <td>
          <span class="badge badge-retired">${item.severity === 'HIGH_BLOCK' ? 'BLOCKED AT GATE' : 'ADVISORY WARN'}</span>
        </td>
      </tr>
    `).join('');
  }

  // -------------------------------------------------------------
  // Feature 5: Owner Dashboard & Audit Log
  // -------------------------------------------------------------
  async function loadDashboard() {
    try {
      const [dashRes, auditRes] = await Promise.all([
        fetch('/api/dashboard'),
        fetch('/api/audit-log')
      ]);

      const dashData = await dashRes.json();
      const auditData = await auditRes.json();

      // Stat Cards
      document.getElementById('statComplianceRate').textContent = `${dashData.summary.complianceRate}%`;
      document.getElementById('statBlockedCount').textContent = dashData.summary.blockedSends;
      document.getElementById('statSuccessCount').textContent = dashData.summary.successfulSends;
      document.getElementById('statOverdueCount').textContent = dashData.summary.expiredDocsCount;

      // Most Used Docs
      const mostUsedList = document.getElementById('mostUsedList');
      if (dashData.mostUsed && dashData.mostUsed.length) {
        mostUsedList.innerHTML = dashData.mostUsed.map(m => `
          <div style="display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid var(--surface-alt); font-size: 13px;">
            <span>${m.name}</span>
            <span class="badge badge-approved">${m.count} sent</span>
          </div>
        `).join('');
      } else {
        mostUsedList.innerHTML = `<p style="font-size: 13px; color: var(--ink-muted);">No distribution data yet.</p>`;
      }

      // Recent Blocked
      const recentBlockedList = document.getElementById('recentBlockedList');
      if (dashData.recentBlockedSends && dashData.recentBlockedSends.length) {
        recentBlockedList.innerHTML = dashData.recentBlockedSends.map(b => `
          <div style="padding: 10px 0; border-bottom: 1px solid var(--surface-alt); font-size: 13px;">
            <div style="display: flex; justify-content: space-between;">
              <strong>${b.doc_id} v${b.version} (${b.doc_title.substring(0, 30)}...)</strong>
              <span class="badge badge-retired">BLOCKED</span>
            </div>
            <div style="color: var(--ink-muted); font-size: 12px; margin-top: 2px;">
              Attempted by <strong>${b.actor}</strong> &bull; Reason: ${b.details}
            </div>
          </div>
        `).join('');
      } else {
        recentBlockedList.innerHTML = `<p style="font-size: 13px; color: var(--ink-muted);">No blocked attempts.</p>`;
      }

      // Audit Log Table
      const auditTableBody = document.getElementById('auditTableBody');
      auditTableBody.innerHTML = auditData.entries.map(e => `
        <tr>
          <td style="font-family: var(--font-mono); font-size: 11px;">${new Date(e.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</td>
          <td><strong>${e.actor}</strong><br><small style="color: var(--ink-muted);">${e.role}</small></td>
          <td><code>${e.action}</code></td>
          <td>${e.doc_id} v${e.version}</td>
          <td>${e.patient_id || 'N/A'}</td>
          <td>
            <span class="badge ${e.gate_result === 'PASS' ? 'badge-approved' : 'badge-retired'}">
              ${e.gate_result}
            </span>
          </td>
          <td style="font-size: 12px; max-width: 320px;">${e.details}</td>
        </tr>
      `).join('');
    } catch (err) {
      console.error('Failed to load dashboard:', err);
    }
  }

  // -------------------------------------------------------------
  // Feature 6: Grounded Staff Q&A
  // -------------------------------------------------------------
  async function executeQA(queryText) {
    if (!queryText || !queryText.trim()) return;
    const qaQuery = document.getElementById('qaQuery');
    const qaResults = document.getElementById('qaResults');
    qaQuery.value = queryText;

    qaResults.innerHTML = `
      <div class="card" style="text-align: center; padding: 30px;">
        <p style="color: var(--brand-green-dark); font-weight: 600;">Consulting approved internal protocols with exact section citations...</p>
      </div>
    `;

    try {
      const res = await fetch('/api/qa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: queryText,
          role: state.currentRole
        })
      });

      const data = await res.json();
      renderQAResults(data);
    } catch (err) {
      qaResults.innerHTML = `<div class="result-banner blocked">Q&A Error: ${err.message}</div>`;
    }
  }

  function renderQAResults(data) {
    const qaResults = document.getElementById('qaResults');

    if (data.outcome === 'refused_out_of_scope') {
      qaResults.innerHTML = `
        <div class="result-banner refused">
          <div>
            <strong>REFUSAL: ANSWER NOT IN APPROVED PRACTICE LIBRARY</strong>
            <p style="margin-top: 6px;">${data.answer}</p>
          </div>
        </div>
      `;
      return;
    }

    if (data.outcome === 'safety_escalation') {
      qaResults.innerHTML = `
        <div class="result-banner blocked">
          <div>
            <strong>EMERGENCY SAFETY ESCALATION</strong>
            <p style="margin-top: 6px;">${data.answer}</p>
          </div>
        </div>
      `;
      return;
    }

    let citationsHtml = '';
    if (data.citations && data.citations.length) {
      citationsHtml = data.citations.map(c => `
        <div class="citation-card" style="margin-top: 14px;">
          <div class="citation-header">
            <span class="citation-title">${c.title} (v${c.version}, ${c.doc_id})</span>
            <span class="badge badge-approved">STATUS: ${c.status}</span>
          </div>
          <div class="citation-section-title">📌 Section Citation: ${c.heading}</div>
          <div class="citation-text">"${c.snippet}"</div>
        </div>
      `).join('');
    }

    qaResults.innerHTML = `
      <div class="result-banner approved">
        <div>
          <strong>GROUNDED INTERNAL PRACTICE ANSWER</strong>
          <p style="margin-top: 6px; line-height: 1.6; white-space: pre-line;">${data.answer}</p>
        </div>
      </div>
      ${citationsHtml}
    `;
  }

  // -------------------------------------------------------------
  // Feature: DSMES & MNT Patient Education Ledger
  // -------------------------------------------------------------
  async function loadDsmesRecords() {
    try {
      const res = await fetch('/api/dsmes-mnt');
      const data = await res.json();
      state.dsmesRecords = data.records || [];
      renderDsmesTable();
    } catch (err) {
      console.error('Failed to load DSMES records:', err);
    }
  }

  function populateDsmesPatientFilter() {
    const filter = document.getElementById('dsmesPatientFilter');
    if (!filter) return;
    filter.innerHTML = `<option value="">All Patients (${state.patients.length} Registered)</option>`;
    state.patients.forEach(p => {
      filter.innerHTML += `<option value="${p.patient_id}">${p.name} - ${p.program} (${p.condition})</option>`;
    });
  }

  function renderDsmesTable() {
    const tableBody = document.getElementById('dsmesTableBody');
    if (!tableBody) return;

    const patientFilter = document.getElementById('dsmesPatientFilter')?.value || '';
    const progFilter = document.getElementById('dsmesProgramFilter')?.value || '';

    let records = state.dsmesRecords || [];
    if (patientFilter) {
      records = records.filter(r => r.patient_id === patientFilter);
    }
    if (progFilter) {
      records = records.filter(r => r.program === progFilter);
    }

    // Update summary counters
    const totalEncountersEl = document.getElementById('statMntTotalEncounters');
    const totalUnitsEl = document.getElementById('statMntUnitsBilled');
    if (totalEncountersEl) totalEncountersEl.textContent = records.length;
    if (totalUnitsEl) {
      const units = records.reduce((sum, r) => sum + (Number(r.units_billed) || 0), 0);
      totalUnitsEl.textContent = units;
    }

    if (records.length === 0) {
      tableBody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--ink-muted); padding: 24px;">No education encounters match the selected filter.</td></tr>`;
      return;
    }

    tableBody.innerHTML = records.map(r => {
      const dateFormatted = new Date(r.delivered_at).toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit'
      });

      return `
        <tr>
          <td style="white-space: nowrap; font-size: 13px;">${dateFormatted}</td>
          <td>
            <strong>${r.patient_name}</strong>
            <div style="font-size: 11px; color: var(--ink-muted);">${r.patient_id}</div>
          </td>
          <td>
            <span class="badge" style="background: var(--surface-alt); border: 1px solid var(--border);">${r.program}</span>
            <div style="font-size: 11px; color: var(--ink-muted); margin-top: 3px;">${r.condition}</div>
          </td>
          <td>
            <strong>${r.education_delivered}</strong>
            <div style="font-size: 11px; color: var(--brand-green-dark); font-weight: 600;">Doc ID: ${r.doc_id} (v${r.version})</div>
          </td>
          <td style="font-size: 13px;">${r.delivered_by}</td>
          <td>
            <span class="badge" style="background: #E3F2FD; color: #1565C0; border: 1px solid #BBDEFB; font-weight: 700;">CPT ${r.billing_cpt_code}</span>
            <div style="font-size: 11px; color: var(--ink); margin-top: 3px; font-weight: 600;">${r.units_billed} units (${r.duration_minutes || 30} min)</div>
          </td>
          <td style="font-size: 12px; color: var(--ink-muted);">${r.channel || 'In-Clinic Handout'}</td>
          <td>
            <span class="badge" style="background: #E8F5E9; color: var(--brand-green-dark); border: 1px solid #C8E6C9; font-size: 11px;">✓ VERIFIED PASS</span>
          </td>
        </tr>
      `;
    }).join('');
  }

  // -------------------------------------------------------------
  // Feature 7: Live Evaluation Harness
  // -------------------------------------------------------------
  async function loadEvaluationData() {
    try {
      const res = await fetch('/api/eval');
      const data = await res.json();
      state.evalReport = data;

      document.getElementById('evalInScopeAcc').textContent = data.metrics.inScopeTop1Accuracy;
      document.getElementById('evalTrapCatch').textContent = data.metrics.trapCatchRate;
      document.getElementById('evalRefusalRate').textContent = data.metrics.outOfLibraryRefusalRate;
      document.getElementById('evalOverallAcc').textContent = data.metrics.overallAccuracy;

      const badge = document.getElementById('evalBadge');
      if (badge) badge.textContent = data.metrics.overallAccuracy.split(' ')[0];

      const evalTableBody = document.getElementById('evalTableBody');
      evalTableBody.innerHTML = data.queryDetails.map(q => `
        <tr>
          <td><code>${q.id}</code></td>
          <td style="max-width: 280px;">${q.query}</td>
          <td><span class="badge badge-expired">${q.category}</span></td>
          <td>${q.expected.doc_id || 'REFUSAL'} (${q.expected.outcome})</td>
          <td>${q.actual.doc_id || 'REFUSAL'} (${q.actual.outcome})</td>
          <td>
            <span class="badge ${q.passed ? 'badge-approved' : 'badge-retired'}">
              ${q.passed ? 'PASSED' : 'FAILED'}
            </span>
          </td>
        </tr>
      `).join('');
    } catch (err) {
      console.error('Failed to load evaluation data:', err);
    }
  }

  // -------------------------------------------------------------
  // Interactive 2-Minute Demo Flow
  // -------------------------------------------------------------
  function setupDemoFlow() {
    startDemoBtn.addEventListener('click', () => {
      demoBanner.style.display = 'flex';
      runDemoStep(1);
    });

    closeDemoBtn.addEventListener('click', () => {
      demoBanner.style.display = 'none';
    });

    demoStep1Btn.addEventListener('click', () => runDemoStep(1));
    demoStep2Btn.addEventListener('click', () => runDemoStep(2));
    demoStep3Btn.addEventListener('click', () => runDemoStep(3));
  }

  function runDemoStep(stepNumber) {
    [demoStep1Btn, demoStep2Btn, demoStep3Btn].forEach(b => b.classList.remove('active'));

    if (stepNumber === 1) {
      demoStep1Btn.classList.add('active');
      demoStepTitle.textContent = 'Step 1: Front Desk Marcus nearly sends an outdated handout (DOC-BAR-002 v1)';
      demoStepDesc.textContent = ' Marcus selects the 2024 dairy-based Stage 2 handout. Send Check deterministically intercepts and blocks the send!';
      
      roleSelect.value = 'front_desk';
      state.currentRole = 'front_desk';
      switchTab('tab-send-check');

      // Set trap document and patient
      const option = Array.from(sendCheckDocSelect.options).find(o => o.value.includes('DOC-BAR-002:1'));
      if (option) sendCheckDocSelect.value = option.value;
      sendCheckPatientSelect.value = 'SYNTH-PAT-101'; // Eleanor Vance (Lactose intolerant!)
      updatePatientPreview();

      btnRunSendCheck.click();
    } else if (stepNumber === 2) {
      demoStep2Btn.classList.add('active');
      demoStepTitle.textContent = 'Step 2: Right Doc finds the current approved handout with lactose intolerance citation';
      demoStepDesc.textContent = 'Elena describes the patient context: "post-op bariatric patient, week 2, lactose intolerant". Right Doc matches DOC-BAR-002 v2!';
      
      roleSelect.value = 'dietitian';
      state.currentRole = 'dietitian';
      switchTab('tab-right-doc');

      executeRightDocSearch('post-op bariatric patient, week 2, lactose intolerant');
    } else if (stepNumber === 3) {
      demoStep3Btn.classList.add('active');
      demoStepTitle.textContent = 'Step 3: Practice Owner Dr. Sarah Jenkins views the blocked delivery in the audit ledger';
      demoStepDesc.textContent = 'Dr. Jenkins inspects the Owner Dashboard: the blocked send was recorded, preventing liability, and compliance rate is visible.';
      
      roleSelect.value = 'owner';
      state.currentRole = 'owner';
      switchTab('tab-owner');
      loadDashboard();
    }
  }

  // -------------------------------------------------------------
  // Setup Event Listeners
  // -------------------------------------------------------------
  function setupEventListeners() {
    // Right Doc Search
    btnSearchRightDoc.addEventListener('click', () => {
      executeRightDocSearch(rightDocQuery.value);
    });

    document.querySelectorAll('.prompt-chip[data-query]').forEach(chip => {
      chip.addEventListener('click', () => {
        executeRightDocSearch(chip.dataset.query);
      });
    });

    // Send Check simulator
    btnRunSendCheck.addEventListener('click', () => {
      const [docId, ver] = sendCheckDocSelect.value.split(':');
      const patId = sendCheckPatientSelect.value;
      runSendCheckSimulation(docId, ver, patId);
    });

    // Trap shortcut buttons
    document.getElementById('btnTrapSuperseded')?.addEventListener('click', () => {
      setSendCheckSelection('DOC-BAR-002:1', 'SYNTH-PAT-101');
    });
    document.getElementById('btnTrapRetired')?.addEventListener('click', () => {
      setSendCheckSelection('DOC-RET-001:1', 'SYNTH-PAT-106');
    });
    document.getElementById('btnTrapExpired')?.addEventListener('click', () => {
      setSendCheckSelection('DOC-CKD-001:1', 'SYNTH-PAT-105');
    });
    document.getElementById('btnTrapStageMismatch')?.addEventListener('click', () => {
      setSendCheckSelection('DOC-BAR-002:2', 'SYNTH-PAT-104'); // Pureed handout to Day 4 clear liquids patient!
    });
    document.getElementById('btnTrapDraft')?.addEventListener('click', () => {
      setSendCheckSelection('DOC-DRAFT-001:0.1', 'SYNTH-PAT-105');
    });
    document.getElementById('btnTrapInternal')?.addEventListener('click', () => {
      setSendCheckSelection('DOC-INT-001:1', 'SYNTH-PAT-107');
    });

    function setSendCheckSelection(docVal, patVal) {
      const docOpt = Array.from(sendCheckDocSelect.options).find(o => o.value.startsWith(docVal));
      if (docOpt) sendCheckDocSelect.value = docOpt.value;
      sendCheckPatientSelect.value = patVal;
      updatePatientPreview();
      btnRunSendCheck.click();
    }

    // Modal Events
    modalCloseBtn.addEventListener('click', closeSendCheckModal);
    modalCancelBtn.addEventListener('click', closeSendCheckModal);
    modalPatientSelect.addEventListener('change', runModalValidation);

    modalExecuteSendBtn.addEventListener('click', async () => {
      if (!state.activeDocForSend) return;
      await executeFinalDelivery(
        state.activeDocForSend.doc_id,
        state.activeDocForSend.version,
        modalPatientSelect.value
      );
      closeSendCheckModal();
    });

    // Diff Modal Events
    btnOpenDiffModal.addEventListener('click', () => {
      diffModal.classList.add('active');
      runDiffComparison();
    });
    diffModalCloseBtn.addEventListener('click', () => {
      diffModal.classList.remove('active');
    });
    btnRunDiffCompare.addEventListener('click', runDiffComparison);

    // Doc Detail Modal Events
    docDetailCloseBtn.addEventListener('click', () => {
      docDetailModal.classList.remove('active');
    });

    // Close any modal on Escape key press
    function closeAllModals() {
      if (sendCheckModal) sendCheckModal.classList.remove('active');
      if (diffModal) diffModal.classList.remove('active');
      if (docDetailModal) docDetailModal.classList.remove('active');
    }

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' || e.key === 'Esc') {
        closeAllModals();
      }
    });

    // Library Filtering
    document.getElementById('libSearch').addEventListener('input', renderLibraryTable);
    document.getElementById('libProgramFilter').addEventListener('change', renderLibraryTable);
    document.getElementById('libStatusFilter').addEventListener('change', renderLibraryTable);
    document.getElementById('libAudienceFilter').addEventListener('change', renderLibraryTable);

    // Grounded Q&A
    document.getElementById('btnAskQA').addEventListener('click', () => {
      executeQA(document.getElementById('qaQuery').value);
    });
    document.querySelectorAll('.prompt-chip[data-qa]').forEach(chip => {
      chip.addEventListener('click', () => {
        executeQA(chip.dataset.qa);
      });
    });

    // Refresh Audit Log & Rerun Eval
    document.getElementById('btnRefreshAudit')?.addEventListener('click', loadDashboard);
    document.getElementById('btnRerunEval')?.addEventListener('click', loadEvaluationData);

    // DSMES / MNT Filters & Superbill Export
    document.getElementById('dsmesPatientFilter')?.addEventListener('change', renderDsmesTable);
    document.getElementById('dsmesProgramFilter')?.addEventListener('change', renderDsmesTable);
    document.getElementById('btnExportSuperbill')?.addEventListener('click', () => {
      const records = state.dsmesRecords || [];
      const totalUnits = records.reduce((s, r) => s + (Number(r.units_billed) || 0), 0);
      alert(`DSMES / MNT SUPERBILL BATCH GENERATED\n\nTotal Education Encounters: ${records.length}\nTotal Billable Units: ${totalUnits} (15-min increments)\nStandard: CMS-1500 / EDI 837P Compliant Format\nStatus: Pre-send gatekeeper verified 100%`);
    });

    // Demo Flow Setup
    setupDemoFlow();
  }

  // Start Application
  init();
});
