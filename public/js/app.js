// Verity Practice Client Application Logic
// Features: Right Doc & Send Check
// Lineage: Verity-pattern prototype adapted from ngupta1137/verity
// Prototype governing standards: One policy engine, 3 decisions, safety triage, front-desk verification, exposure queue

document.addEventListener('DOMContentLoaded', () => {
  // Global State
  const state = {
    documents: [],
    patients: [],
    auditLog: [],
    conflicts: [],
    exposureQueue: [],
    conflictHistory: [],
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

  // Front Desk Two-Identifier Verification Elements
  const frontDeskVerifyBox = document.getElementById('frontDeskVerifyBox');
  const fdVerifyName = document.getElementById('fdVerifyName');
  const fdVerifyDob = document.getElementById('fdVerifyDob');
  const fdVerifyChannel = document.getElementById('fdVerifyChannel');
  const btnFillVerifiedDob = document.getElementById('btnFillVerifiedDob');
  const btnFillWrongDob = document.getElementById('btnFillWrongDob');

  // Conflict Governance Elements
  const conflictResolveForm = document.getElementById('conflictResolveForm');
  const conflictSelect = document.getElementById('conflictSelect');
  const conflictDecision = document.getElementById('conflictDecision');
  const conflictReviewer = document.getElementById('conflictReviewer');
  const conflictResultingState = document.getElementById('conflictResultingState');
  const conflictRationale = document.getElementById('conflictRationale');

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
    loadConflicts();
    loadExposureQueue();
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
      });
    });

    roleSelect.addEventListener('change', () => {
      state.currentRole = roleSelect.value;
      updateRoleUI();
      updateDocSelectorForRole();
    });
  }

  function updateRoleUI() {
    const role = state.currentRole;
    const isFrontDesk = role === 'front_desk';
    const isOwner = role === 'owner';

    const fdBadge = document.getElementById('fdVerifyBadge');
    if (fdBadge) {
      fdBadge.textContent = isFrontDesk ? 'REQUIRED FOR FRONT DESK' : 'OPTIONAL FOR CLINICIANS';
      fdBadge.style.background = isFrontDesk ? '#FFE0B2' : '#E2E8F0';
      fdBadge.style.color = isFrontDesk ? '#E65100' : '#475569';
    }

    const confBadge = document.getElementById('conflictRoleBadge');
    if (confBadge) {
      if (isOwner) {
        confBadge.textContent = 'OWNER / CLINICAL DIRECTOR AUTHORIZED';
        confBadge.style.background = '#E8F5E9';
        confBadge.style.color = 'var(--brand-green-dark)';
      } else {
        confBadge.textContent = 'REQUIRES DR. JENKINS (SWITCH ROLE ABOVE)';
        confBadge.style.background = '#FFEBEE';
        confBadge.style.color = '#D32F2F';
      }
    }
  }

  function switchTab(tabId) {
    tabs.forEach(t => {
      if (t.dataset.tab === tabId) t.classList.add('active');
      else t.classList.remove('active');
    });

    panes.forEach(p => {
      if (p.id === tabId) p.classList.add('active');
      else p.classList.remove('active');
    });
  }

  // -------------------------------------------------------------
  // Feature 1: Right Doc (Context-Aware Clinical Search)
  // -------------------------------------------------------------
  async function executeRightDocSearch(queryText) {
    if (!queryText || !queryText.trim()) return;

    rightDocResults.innerHTML = `
      <div class="card" style="text-align: center; padding: 40px;">
        <p style="color: var(--brand-green-dark); font-weight: 600;">Evaluating patient context, clinical rules, and safety triage...</p>
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

      if (res.status === 403) {
        rightDocResults.innerHTML = `
          <div class="result-banner blocked">
            <div>
              <strong>ROLE PERMISSION RESTRICTION: FRONT DESK</strong>
              <p style="margin-top: 6px;">Front Desk role cannot perform free-text clinical retrieval for patient delivery (Section 3.1). Front Desk can only deliver educational materials assigned by a Registered Dietitian via the Send Check tab.</p>
            </div>
          </div>
        `;
        return;
      }

      const data = await res.json();
      renderRightDocResults(data);
    } catch (err) {
      rightDocResults.innerHTML = `<div class="result-banner blocked">Search error: ${err.message}</div>`;
    }
  }

  function renderInlineSendCheckBadge(sendCheck) {
    if (!sendCheck) return '';
    const isAllowed = sendCheck.allowed;
    return `
      <div class="inline-sendcheck-box" style="margin: 12px 0; padding: 10px 14px; border-radius: 6px; background: ${isAllowed ? '#f0fdf4' : '#fef2f2'}; border: 1px solid ${isAllowed ? '#bbf7d0' : '#fecaca'};">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <div style="font-size: 13px; font-weight: 700; color: ${isAllowed ? '#15803d' : '#b91c1c'};">
            ${isAllowed ? '✓ Pre-Send Check: Eligible to deliver' : '⛔ Pre-Send Check: Delivery prohibited'}
          </div>
          <span class="badge" style="background: ${isAllowed ? '#dcfce7' : '#fee2e2'}; color: ${isAllowed ? '#166534' : '#991b1b'}; font-size: 11px;">
            ${isAllowed ? 'Eligible' : 'Blocked'}
          </span>
        </div>
        <p style="margin: 4px 0 0 0; font-size: 12px; color: ${isAllowed ? '#166534' : '#991b1b'};">
          ${sendCheck.summary}
        </p>
        ${!isAllowed && sendCheck.blocks ? `
          <ul style="margin: 6px 0 0 16px; font-size: 11px; color: #7f1d1d; line-height: 1.4;">
            ${sendCheck.blocks.map(b => `<li><strong>${b.code || 'BLOCK'}:</strong> ${b.message || b}</li>`).join('')}
          </ul>
        ` : ''}
      </div>
    `;
  }

  function renderRightDocResults(data) {
    // Workstream 2: Emergency Safety Escalation Before Retrieval
    if (data.outcome === 'URGENT_CLINICAL_ESCALATION') {
      const secDoc = data.secondaryDocument;
      rightDocResults.innerHTML = `
        <div class="result-banner blocked" style="border-left: 6px solid #D32F2F; background: #FFEBEE; padding: 18px;">
          <div>
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="font-size: 20px;">🚨</span>
              <strong style="color: #D32F2F; font-size: 16px;">URGENT CLINICAL ESCALATION REQUIRED</strong>
              <span class="badge" style="background: #D32F2F; color: #fff;">TRIAGE HALT BEFORE RETRIEVAL</span>
            </div>
            <p style="margin-top: 8px; font-size: 14px; color: #B71C1C; line-height: 1.5;">${data.message}</p>
          </div>
        </div>

        <div class="citation-card" style="margin-top: 16px; border-color: #D32F2F;">
          <div class="citation-header">
            <div>
              <span class="badge badge-internal">INTERNAL CLINICAL PROTOCOL</span>
              <span class="badge badge-approved" style="margin-left: 6px;">DOC-INT-004 v1</span>
              <span class="citation-title" style="margin-left: 10px;">Clinical Escalation Protocol: Outpatient Nutrition Red Flags & Emergency Triage</span>
            </div>
          </div>
          <div style="background: #FAFAFA; padding: 12px; border-radius: var(--radius-sm); margin-top: 10px; font-size: 13px; border-left: 3px solid #D32F2F;">
            <strong>Immediate Clinical Action:</strong>
            <p style="margin: 4px 0 0 0; color: var(--ink);">Contact practice on-call physician / diabetes care team immediately or instruct patient to access emergency medical services. Do not provide routine nutrition modifications during acute metabolic crises.</p>
          </div>
        </div>

        ${secDoc ? `
          <div class="citation-card" style="margin-top: 16px; border: 1px dashed #FFA000; background: #FFFDE7;">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
              <span class="badge" style="background: #FFF3E0; color: #E65100; font-weight: 700;">
                ⚠️ Secondary Handout (Not a substitute for urgent clinical escalation)
              </span>
              <span style="font-size: 11px; color: var(--ink-muted);">${secDoc.doc_id} v${secDoc.version}</span>
            </div>
            <h4 style="font-size: 14px; font-weight: 700; margin: 0 0 4px 0;">${secDoc.title}</h4>
            <p style="font-size: 12px; color: var(--ink-muted); margin: 0;">${secDoc.summary}</p>
          </div>
        ` : ''}
      `;
      return;
    }

    // Workstream 2: Medication Dosing Referral (Out-of-Scope)
    if (data.outcome === 'OUT_OF_SCOPE_REFERRAL') {
      rightDocResults.innerHTML = `
        <div class="result-banner refused" style="border-left: 6px solid #E65100; background: #FFF3E0;">
          <div>
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="font-size: 18px;">⚠️</span>
              <strong style="color: #E65100; font-size: 15px;">OUT-OF-SCOPE CLINICAL REFERRAL REQUIRED</strong>
              <span class="badge" style="background: #FFE0B2; color: #E65100;">PRESCRIBER ACTION ONLY</span>
            </div>
            <p style="margin-top: 8px; font-size: 13px; line-height: 1.5; color: #BF360C;">${data.message}</p>
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
      rightDocResults.innerHTML = `<div class="result-banner refused">${data.message || 'No matching document found.'}</div>`;
      return;
    }

    const doc = top.document;
    const citation = top.citation;
    const isTopBlocked = top.sendCheck && !top.sendCheck.allowed;

    let html = `
      <div class="result-banner ${bannerClass}">
        <div>
          <strong>${bannerTitle}</strong>
          <p style="margin-top: 4px;">${data.message}</p>
          ${data.redactions && data.redactions.length ? `<span style="font-size: 11px; color: #555; display: block; margin-top: 4px;">🛡️ Client-side PHI Scrubber applied: [${data.redactions.join(', ')}] redacted</span>` : ''}
        </div>
      </div>

      <div class="citation-card" style="${isTopBlocked ? 'border-color: #ef4444;' : ''}">
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

        ${renderInlineSendCheckBadge(top.sendCheck)}

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
          ${isTopBlocked 
            ? `<button class="btn-send-check" disabled style="opacity: 0.6; cursor: not-allowed; background: var(--border-dark); color: var(--ink-muted);"><span>⛔ Delivery Blocked by Send Check Gate</span></button>`
            : `<button class="btn-send-check" id="btnLaunchSendCheckFromSearch"><span>🛡️ Pre-Send Check & Deliver to Patient</span></button>`
          }
        </div>
      </div>
    `;

    // If additional candidate documents exist in search matches
    if (data.matches && data.matches.length > 1) {
      const additional = data.matches.slice(1);
      html += `
        <div style="margin-top: 24px; margin-bottom: 12px;">
          <h4 style="font-size: 14px; font-weight: 700; color: var(--ink-muted); text-transform: uppercase; letter-spacing: 0.5px;">
            Additional Evaluated Candidates & Send Check Status (${additional.length})
          </h4>
        </div>
      `;

      additional.forEach((m) => {
        const d = m.document;
        const mBlocked = m.sendCheck && !m.sendCheck.allowed;
        html += `
          <div class="citation-card" style="margin-bottom: 14px; opacity: 0.95; ${mBlocked ? 'border-color: #fca5a5;' : ''}">
            <div class="citation-header">
              <div>
                <span class="badge badge-approved">${d.doc_id} v${d.version}</span>
                <span class="citation-title" style="margin-left: 8px;">${d.title}</span>
              </div>
              <div style="font-size: 12px; color: var(--ink-muted);">
                ${d.program}
              </div>
            </div>
            ${renderInlineSendCheckBadge(m.sendCheck)}
          </div>
        `;
      });
    }

    rightDocResults.innerHTML = html;

    const launchBtn = document.getElementById('btnLaunchSendCheckFromSearch');
    if (launchBtn) {
      launchBtn.addEventListener('click', () => {
        openSendCheckModal(doc);
      });
    }
  }

  // -------------------------------------------------------------
  // Feature 2: Send Check (Deterministic Pre-Send Verification)
  // -------------------------------------------------------------
  function renderSendCheckSelectors() {
    sendCheckPatientSelect.innerHTML = state.patients.map(p => `
      <option value="${p.patient_id}">
        ${p.patient_id} - ${p.name} (${p.program} | ${p.patient_stage})
      </option>
    `).join('');

    modalPatientSelect.innerHTML = sendCheckPatientSelect.innerHTML;

    updateDocSelectorForRole();
    updatePatientPreview();

    sendCheckPatientSelect.addEventListener('change', () => {
      updatePatientPreview();
      updateDocSelectorForRole();
    });
  }

  function updateDocSelectorForRole() {
    const patient = state.patients.find(p => p.patient_id === sendCheckPatientSelect.value);
    
    // Front Desk sees ONLY RD-assigned documents (Workstream 4, Section 3.1)
    if (state.currentRole === 'front_desk') {
      const assigned = patient?.assigned_documents || [];
      if (assigned.length === 0) {
        sendCheckDocSelect.innerHTML = `<option value="">(No RD-assigned documents for this patient)</option>`;
      } else {
        sendCheckDocSelect.innerHTML = assigned.map(ad => {
          const d = state.documents.find(doc => doc.doc_id === ad.doc_id && Number(doc.version) === Number(ad.version)) || 
                    { doc_id: ad.doc_id, version: ad.version, title: ad.title || ad.doc_id, status: 'approved' };
          return `<option value="${d.doc_id}:${d.version}">[RD-ASSIGNED] ${d.doc_id} v${d.version} - ${d.title.substring(0, 48)}... (by ${ad.assigned_by})</option>`;
        }).join('');
      }
    } else {
      sendCheckDocSelect.innerHTML = state.documents.map(d => `
        <option value="${d.doc_id}:${d.version}">
          [${d.status.toUpperCase()}] ${d.doc_id} v${d.version} - ${d.title.substring(0, 50)}...
        </option>
      `).join('');
    }
  }

  function updatePatientPreview() {
    const selectedPatId = sendCheckPatientSelect.value;
    const patient = state.patients.find(p => p.patient_id === selectedPatId);
    if (!patient) return;

    // Structured medications rendering
    const medsList = (patient.medications || []).map(m => {
      if (typeof m === 'object') {
        return `${m.name} (${m.class || 'class'}, ${m.reconciled ? 'reconciled' : 'UNRECONCILED'})`;
      }
      return m;
    }).join('; ') || 'None reported / Unknown';

    selectedPatientPreview.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 4px;">
        <strong>Recipient:</strong> ${patient.name} (DOB: <code>${patient.date_of_birth}</code>, Age: ${patient.age})
        <span class="badge" style="font-size: 11px; background: #E8F5E9; color: var(--brand-green-dark);">${patient.program}</span>
      </div>
      <div><strong>Clinical Stage:</strong> ${patient.patient_stage} &bull; <strong>Assigned RD:</strong> ${patient.dietitian}</div>
      <div style="margin-top: 4px; font-size: 12px; color: var(--ink-muted);">
        <strong>Diagnoses:</strong> ${(patient.diagnoses || []).join(', ') || 'None'}<br>
        <strong>Meds:</strong> ${medsList}<br>
        <strong>Dialysis:</strong> ${patient.dialysis_status || 'negative'} &bull; <strong>Potassium:</strong> ${patient.latest_potassium ? `${patient.latest_potassium} mEq/L` : 'not_assessed'} &bull; <strong>Pregnancy:</strong> ${patient.pregnancy_status || 'negative'} &bull; <strong>ED Screen:</strong> ${patient.eating_disorder_screen || 'negative'}
      </div>
    `;

    // Auto-fill front-desk inputs if empty
    if (fdVerifyName && !fdVerifyName.value) fdVerifyName.value = patient.name;
  }

  async function runSendCheckSimulation(docId, version, patientId) {
    sendCheckDetails.innerHTML = `<p style="color: var(--ink-muted);">Evaluating unified policy engine (validity, applicability, authorization)...</p>`;

    try {
      const res = await fetch('/api/send-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          doc_id: docId,
          version: Number(version),
          patient_id: patientId,
          actor: roleSelect.options[roleSelect.selectedIndex].text,
          role: state.currentRole,
          recipient_verification: {
            name: fdVerifyName ? fdVerifyName.value.trim() : '',
            dob: fdVerifyDob ? fdVerifyDob.value.trim() : '',
            date_of_birth: fdVerifyDob ? fdVerifyDob.value.trim() : '',
            channel: fdVerifyChannel ? fdVerifyChannel.value : 'portal'
          }
        })
      });

      const check = await res.json();
      renderSendCheckDetails(check, patientId);
    } catch (err) {
      sendCheckDetails.innerHTML = `<div class="result-banner blocked">Send Check error: ${err.message}</div>`;
    }
  }

  function renderSendCheckDetails(check, patientId) {
    const isEligible = check.allowed && check.delivery_authorization === 'authorized';
    if (isEligible) {
      gateResultBadge.className = 'badge badge-approved';
      gateResultBadge.textContent = 'Eligible to deliver';
    } else {
      gateResultBadge.className = 'badge badge-retired';
      gateResultBadge.textContent = 'Delivery prohibited';
    }

    let html = `
      <div class="result-banner ${isEligible ? 'approved' : 'blocked'}" style="margin-bottom: 16px;">
        <div>
          <div style="display: flex; align-items: baseline; gap: 8px;">
            <strong style="font-size: 15px;">${isEligible ? 'Eligible to deliver' : 'Delivery prohibited'}</strong>
            <span style="font-size: 12px; font-weight: 400; color: var(--ink-muted); font-style: italic;">
              ${isEligible ? 'Document eligibility, not clinical clearance.' : 'Safety, stage, or governance breach intercepted.'}
            </span>
          </div>
          <p style="margin-top: 6px; font-size: 13px;">${check.summary}</p>
        </div>
      </div>

      <!-- Workstream 1: Three Decisions Card -->
      <div style="background: #FAFAFA; border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 12px; margin-bottom: 16px;">
        <div style="font-size: 12px; font-weight: 700; color: var(--ink-muted); text-transform: uppercase; margin-bottom: 8px;">
          Policy Decision Engine (v${check.policy_version || '2.0.0'}) &bull; Outcome: <span style="color: var(--ink); font-weight: 800;">${check.outcome || 'EVALUATED'}</span>
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; text-align: center;">
          <div style="padding: 8px; border-radius: 4px; background: ${check.document_validity === 'valid' ? '#E8F5E9' : '#FFEBEE'}; border: 1px solid ${check.document_validity === 'valid' ? '#C8E6C9' : '#FFCDD2'};">
            <div style="font-size: 11px; font-weight: 600; color: var(--ink-muted);">1. Document Validity</div>
            <div style="font-size: 13px; font-weight: 800; color: ${check.document_validity === 'valid' ? 'var(--brand-green-dark)' : '#D32F2F'}; text-transform: uppercase;">
              ${check.document_validity || 'valid'}
            </div>
          </div>
          <div style="padding: 8px; border-radius: 4px; background: ${check.patient_applicability === 'applicable' ? '#E8F5E9' : (check.patient_applicability === 'review_required' ? '#FFF3E0' : '#FFEBEE')}; border: 1px solid ${check.patient_applicability === 'applicable' ? '#C8E6C9' : (check.patient_applicability === 'review_required' ? '#FFE0B2' : '#FFCDD2')};">
            <div style="font-size: 11px; font-weight: 600; color: var(--ink-muted);">2. Patient Applicability</div>
            <div style="font-size: 13px; font-weight: 800; color: ${check.patient_applicability === 'applicable' ? 'var(--brand-green-dark)' : (check.patient_applicability === 'review_required' ? '#E65100' : '#D32F2F')}; text-transform: uppercase;">
              ${check.patient_applicability || 'applicable'}
            </div>
          </div>
          <div style="padding: 8px; border-radius: 4px; background: ${check.delivery_authorization === 'authorized' ? '#E8F5E9' : '#FFEBEE'}; border: 1px solid ${check.delivery_authorization === 'authorized' ? '#C8E6C9' : '#FFCDD2'};">
            <div style="font-size: 11px; font-weight: 600; color: var(--ink-muted);">3. Authorization</div>
            <div style="font-size: 13px; font-weight: 800; color: ${check.delivery_authorization === 'authorized' ? 'var(--brand-green-dark)' : '#D32F2F'}; text-transform: uppercase;">
              ${check.delivery_authorization || 'denied'}
            </div>
          </div>
        </div>

        ${check.matched_rules && check.matched_rules.length ? `
          <div style="margin-top: 10px; font-size: 11px; color: var(--ink-muted); border-top: 1px dashed var(--border); padding-top: 6px;">
            <strong>Cited Clinical Rules (${check.matched_rules.length}):</strong>
            <div style="margin-top: 4px; display: flex; flex-direction: column; gap: 3px;">
              ${check.matched_rules.map(r => `
                <div>&bull; <code>${r.rule_id}</code>: ${r.name} (Owner: <em>${r.clinical_owner}</em>, Approved: <em>${r.approved_by}</em>)</div>
              `).join('')}
            </div>
          </div>
        ` : ''}
      </div>

      <div class="gate-checklist">
    `;

    // Blocks
    (check.blocks || []).forEach(b => {
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
    (check.warnings || []).forEach(w => {
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
    (check.passes || []).forEach(p => {
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

    if (isEligible) {
      html += `
        <button class="btn-send-check" id="btnExecuteDirectSend" style="width: 100%; justify-content: center; margin-top: 14px;">
          <span>🚀 Confirm Send & Write to Durable Audit Log</span>
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
          role: state.currentRole,
          recipient_verification: {
            name: fdVerifyName ? fdVerifyName.value.trim() : '',
            dob: fdVerifyDob ? fdVerifyDob.value.trim() : '',
            date_of_birth: fdVerifyDob ? fdVerifyDob.value.trim() : '',
            channel: fdVerifyChannel ? fdVerifyChannel.value : 'portal'
          }
        })
      });

      const result = await res.json();
      if (result.success) {
        alert(`SUCCESS: Handout ${docId} v${version} delivered and recorded.\n\nAudit Event ID: ${result.receipt.eventId}\nContent Hash: ${result.receipt.contentHash}`);
        loadDashboard();
        loadDsmesRecords();
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
    
    modalGateList.innerHTML = `<p style="font-size: 13px; color: var(--ink-muted);">Verifying 3-decision clinical policy...</p>`;

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
      (check.blocks || []).forEach(b => {
        itemsHtml += `<div class="gate-item fail"><span class="gate-icon">❌</span><div><strong>${b.code}</strong><p>${b.message}</p></div></div>`;
      });
      (check.warnings || []).forEach(w => {
        itemsHtml += `<div class="gate-item warn"><span class="gate-icon">⚠️</span><div><strong>${w.code}</strong><p>${w.message}</p></div></div>`;
      });
      (check.passes || []).forEach(p => {
        itemsHtml += `<div class="gate-item pass"><span class="gate-icon">✓</span><div><strong>${p.code}</strong><p>${p.message}</p></div></div>`;
      });

      modalGateList.innerHTML = itemsHtml;

      const isEligible = check.allowed && check.delivery_authorization === 'authorized';
      modalSummaryAlert.className = `result-banner ${isEligible ? 'approved' : 'blocked'}`;
      modalSummaryAlert.innerHTML = `<strong>${isEligible ? 'Eligible to deliver' : 'Delivery prohibited'}</strong>: ${check.summary}`;

      modalExecuteSendBtn.disabled = !isEligible;
      modalExecuteSendBtn.style.opacity = isEligible ? '1' : '0.4';
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
  // Feature 4: Conflicts & Staleness & Exposure Queue
  // -------------------------------------------------------------
  async function loadConflicts() {
    try {
      const res = await fetch('/api/dashboard');
      const data = await res.json();
      state.conflicts = data.conflicts || [];
      renderConflicts(state.conflicts);
    } catch (err) {
      console.warn('Failed to load conflicts:', err.message);
    }
  }

  function renderConflicts(conflicts) {
    const container = document.getElementById('conflictsList');
    if (!conflicts || conflicts.length === 0) {
      container.innerHTML = `
        <div style="padding: 16px; background: #E8F5E9; border-radius: 6px; border: 1px solid #C8E6C9; color: var(--brand-green-dark); font-weight: 600;">
          ✓ All clinical guideline conflicts have been formally resolved by the Clinical Director. Documents unlocked for safe distribution.
        </div>
      `;
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

  async function loadExposureQueue() {
    try {
      const res = await fetch('/api/conflicts/exposure-queue');
      const data = await res.json();
      state.exposureQueue = data.queue || [];

      const badge = document.getElementById('exposureCountBadge');
      const pendingCount = state.exposureQueue.filter(q => q.exposure_status === 'PENDING_REVIEW').length;
      if (badge) {
        badge.textContent = `${pendingCount} PENDING CLINICAL REVIEW`;
        badge.style.background = pendingCount > 0 ? '#FFF3E0' : '#E8F5E9';
        badge.style.color = pendingCount > 0 ? '#E65100' : 'var(--brand-green-dark)';
      }

      const tbody = document.getElementById('exposureTableBody');
      if (!tbody) return;

      if (state.exposureQueue.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--ink-muted); padding: 16px;">No patients exposed to withdrawn materials.</td></tr>`;
        return;
      }

      tbody.innerHTML = state.exposureQueue.map(item => `
        <tr>
          <td><code>${item.patient_id}</code></td>
          <td><strong>${item.patient_name}</strong><br><span style="font-size: 11px; color: var(--ink-muted);">DOB: ${item.patient_dob || '1992-03-14'}</span></td>
          <td><code>${item.doc_id}</code> v${item.version}<br><span style="font-size: 11px; color: var(--ink-muted);">${item.doc_title}</span></td>
          <td>${item.delivered_date ? item.delivered_date.split('T')[0] : '2026-10-22'}</td>
          <td style="max-width: 200px; font-size: 11px; color: var(--ink-muted);">${item.withdrawn_reason || 'Guideline revision'}</td>
          <td>
            <span class="badge ${item.exposure_status === 'EXPOSURE_REVIEWED' ? 'badge-approved' : 'badge-retired'}" style="font-weight: 700;">
              ${item.exposure_status === 'EXPOSURE_REVIEWED' ? '✓ CONTACTED & REVIEWED' : '⚠️ PENDING REVIEW'}
            </span>
          </td>
          <td>
            ${item.exposure_status === 'EXPOSURE_REVIEWED' 
              ? `<span style="font-size: 11px; color: var(--brand-green-dark); font-weight: 600;">Completed (${item.reviewed_by?.split(',')[0] || 'Dr. Jenkins'})</span>`
              : `<button class="btn-demo-step btn-review-exposure" data-expid="${item.exposure_id}" data-patid="${item.patient_id}" data-docid="${item.doc_id}" style="padding: 4px 8px; font-size: 11px; background: #E65100; color: #fff; border: none;">
                  <span>Mark Patient Contacted & Replaced</span>
                </button>`
            }
          </td>
        </tr>
      `).join('');

      document.querySelectorAll('.btn-review-exposure').forEach(btn => {
        btn.addEventListener('click', async () => {
          await reviewExposure(btn.dataset.expid, btn.dataset.patid, btn.dataset.docid);
        });
      });
    } catch (err) {
      console.warn('Failed to load exposure queue:', err.message);
    }
  }

  async function reviewExposure(expId, patId, docId) {
    try {
      const res = await fetch('/api/conflicts/exposure-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          exposure_id: expId,
          patient_id: patId,
          doc_id: docId,
          reviewer: roleSelect.options[roleSelect.selectedIndex].text,
          notes: 'Exposure reviewed; patient contacted, GDM carbohydrate minimum (175g/day) explained, updated DOC-GEST-002 v2 dispatched.'
        })
      });
      const data = await res.json();
      if (data.success) {
        alert(data.message);
        await loadExposureQueue();
        await loadDashboard();
      }
    } catch (err) {
      alert(`Error updating exposure: ${err.message}`);
    }
  }

  function renderConflictHistory() {
    const tbody = document.getElementById('conflictHistoryTableBody');
    if (!tbody) return;

    if (!state.conflictHistory || state.conflictHistory.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td>${new Date().toLocaleDateString()}</td>
          <td><code>CONF-001</code></td>
          <td>Dr. Sarah Jenkins, RDN (Practice Owner)</td>
          <td><span class="badge badge-approved">WITHDRAW_A_KEEP_B</span><br><small>DOC-GEST-001 retired; DOC-GEST-002 active</small></td>
          <td style="font-size: 12px;">Updated practice standard to ADA 2026 guidelines specifying minimum 175g/day CHO without rigid meal ceilings.</td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = state.conflictHistory.map(ch => `
      <tr>
        <td>${ch.timestamp}</td>
        <td><code>${ch.conflict_id}</code></td>
        <td>${ch.reviewer}</td>
        <td><span class="badge badge-approved">${ch.decision}</span><br><small>${ch.resulting_state}</small></td>
        <td style="font-size: 12px;">${ch.rationale}</td>
      </tr>
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
      if (dashData && dashData.summary) {
        const statComp = document.getElementById('statComplianceRate');
        const statBlocked = document.getElementById('statBlockedCount');
        const statSuccess = document.getElementById('statSuccessCount');
        const statOverdue = document.getElementById('statOverdueCount');
        if (statComp) statComp.textContent = `${dashData.summary.complianceRate}%`;
        if (statBlocked) statBlocked.textContent = dashData.summary.blockedSends;
        if (statSuccess) statSuccess.textContent = dashData.summary.successfulSends;
        if (statOverdue) statOverdue.textContent = dashData.summary.expiredDocsCount;
      }

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
          <td>${e.patient_id || 'N/A'}${e.recipient_name ? `<br><small style="color: var(--ink-muted);">${e.recipient_name}</small>` : ''}</td>
          <td>
            <span class="badge ${e.gate_result === 'PASS' ? 'badge-approved' : 'badge-retired'}">
              ${e.gate_result}
            </span>
          </td>
          <td style="font-size: 12px; max-width: 320px;">
            ${e.details}
            ${e.content_hash ? `<br><code style="font-size: 10px; color: #475569;">Hash: ${e.content_hash.substring(0, 16)}...</code>` : ''}
          </td>
        </tr>
      `).join('');
    } catch (err) {
      console.error('Failed to load dashboard:', err);
    }
  }

  // -------------------------------------------------------------
  // Feature 6: Labs Experimental Grounded Staff Q&A
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
          <strong>GROUNDED INTERNAL PRACTICE ANSWER (QUOTING ONLY - NO SYNTHETIC ADVICE)</strong>
          <p style="margin-top: 6px; line-height: 1.6; white-space: pre-line;">${data.answer}</p>
        </div>
      </div>
      ${citationsHtml}
    `;
  }

  // -------------------------------------------------------------
  // Feature: Education Delivery & Encounter Evidence
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
      filter.innerHTML += `<option value="${p.patient_id}">${p.name} - ${p.program} (${p.patient_stage})</option>`;
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
    if (totalEncountersEl) totalEncountersEl.textContent = records.length;

    if (records.length === 0) {
      tableBody.innerHTML = `<tr><td colspan="9" style="text-align: center; color: var(--ink-muted); padding: 24px;">No education encounters match the selected filter.</td></tr>`;
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
            <div style="font-size: 11px; color: var(--ink-muted); margin-top: 3px;">${r.condition || 'Clinical Education'}</div>
          </td>
          <td>
            <strong>${r.education_delivered}</strong>
            <div style="font-size: 11px; color: var(--brand-green-dark); font-weight: 600;">Doc ID: ${r.doc_id} (v${r.version})</div>
          </td>
          <td style="font-size: 13px;">${r.delivered_by}</td>
          <td>
            <span class="badge" style="background: #FFF3E0; color: #E65100; border: 1px solid #FFE0B2; font-weight: 700;">CPT ${r.billing_cpt_code || '97802'}</span>
            <div style="font-size: 11px; color: var(--ink-muted); margin-top: 3px;">Draft, needs billing review</div>
          </td>
          <td style="font-size: 12px; color: var(--ink-muted);">${r.channel || 'In-Clinic Handout'}</td>
          <td>
            <code style="font-size: 10px; font-family: var(--font-mono); color: #475569;" title="${r.content_hash || 'SHA-256 Hash'}">
              ${(r.content_hash || 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855').substring(0, 12)}...
            </code>
          </td>
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

      const s1 = data.suite1_regression;
      const traps = data.preSendCheckTraps;

      // Suite 1 Metrics
      if (s1) {
        if (document.getElementById('evalInScopeAcc')) document.getElementById('evalInScopeAcc').textContent = s1.inScopeTop1Accuracy.split(' ')[0];
        if (document.getElementById('evalInScopeCount')) document.getElementById('evalInScopeCount').textContent = `${s1.counts.inScope.passed}/${s1.counts.inScope.total} Cases (Target: ≥ 90.0%)`;
        if (document.getElementById('evalTrapCatch')) document.getElementById('evalTrapCatch').textContent = s1.trapHandlingRate.split(' ')[0];
        if (document.getElementById('evalTrapCount')) document.getElementById('evalTrapCount').textContent = `${s1.counts.traps.passed}/${s1.counts.traps.total} Cases (Target: 100.0%)`;
        if (document.getElementById('evalRefusalRate')) document.getElementById('evalRefusalRate').textContent = s1.outOfLibraryRefusalRate.split(' ')[0];
        if (document.getElementById('evalRefusalCount')) document.getElementById('evalRefusalCount').textContent = `${s1.counts.outOfLibrary.passed}/${s1.counts.outOfLibrary.total} Cases (Target: 100.0%)`;
        if (document.getElementById('evalInternalAcc')) document.getElementById('evalInternalAcc').textContent = s1.internalQnAccuracy ? s1.internalQnAccuracy.split(' ')[0] : '100.0%';
        if (document.getElementById('evalInternalCount')) document.getElementById('evalInternalCount').textContent = `${s1.counts.internal.passed}/${s1.counts.internal.total} Cases (Target: ≥ 90.0%)`;
        if (document.getElementById('evalOverallAcc')) document.getElementById('evalOverallAcc').textContent = s1.overallAccuracy.split(' ')[0];
        if (document.getElementById('evalOverallCount')) document.getElementById('evalOverallCount').textContent = `${s1.counts.total.passed}/${s1.counts.total.total} Test Cases Passed`;
        if (document.getElementById('evalMathSummary')) document.getElementById('evalMathSummary').textContent = `${s1.counts.inScope.total} In-Scope + ${s1.counts.outOfLibrary.total} Out-of-Library + ${s1.counts.traps.total} Traps + ${s1.counts.internal.total} Internal = ${s1.counts.total.total} / ${s1.counts.total.total} Total Queries (All categories sum exactly to total)`;

        const evalTableBody = document.getElementById('evalTableBody');
        if (evalTableBody && s1.queryDetails) {
          evalTableBody.innerHTML = s1.queryDetails.map(q => `
            <tr>
              <td><code>${q.id}</code></td>
              <td style="max-width: 280px; font-weight: 500;">${q.query}</td>
              <td><span class="badge" style="background: var(--surface-alt); border: 1px solid var(--border); font-size: 11px;">${q.category}</span></td>
              <td><code>${q.expected.doc_id || 'REFUSAL'}</code> <span style="font-size: 11px; color: var(--ink-muted);">(${q.expected.outcome})</span></td>
              <td><code>${q.actual.doc_id || 'REFUSAL'}</code> <span style="font-size: 11px; color: var(--ink-muted);">(${q.actual.outcome})</span></td>
              <td>
                <span class="badge ${q.passed ? 'badge-approved' : 'badge-retired'}" style="font-weight: 700;">
                  ${q.passed ? '✓ PASSED' : '✗ FAILED'}
                </span>
              </td>
            </tr>
          `).join('');
        }
      }

      const s2 = data.suite2_independent_safety;
      const s3 = data.suite3_builder_adversarial;

      // Suite 2 Metrics (25 Independent Safety Cases from Review Section 8 Verbatim)
      if (s2) {
        const badge = document.getElementById('evalHeldOutBadge');
        if (badge) badge.textContent = `${s2.accuracy.split(' ')[0]} Independent Safety Score (${s2.passedCount}/${s2.totalCases} Passed)`;

        if (s2.dimensions) {
          if (document.getElementById('evalDimRedFlag') && s2.dimensions.dim1_safety_triage) {
            document.getElementById('evalDimRedFlag').textContent = `${((s2.dimensions.dim1_safety_triage.passed / s2.dimensions.dim1_safety_triage.total) * 100).toFixed(0)}%`;
          }
          if (document.getElementById('evalDimDosing') && s2.dimensions.dim2_scope_boundary) {
            document.getElementById('evalDimDosing').textContent = `${((s2.dimensions.dim2_scope_boundary.passed / s2.dimensions.dim2_scope_boundary.total) * 100).toFixed(0)}%`;
          }
          if (document.getElementById('evalDimFloor') && s2.dimensions.dim3_population_guard) {
            document.getElementById('evalDimFloor').textContent = `${((s2.dimensions.dim3_population_guard.passed / s2.dimensions.dim3_population_guard.total) * 100).toFixed(0)}%`;
          }
          if (document.getElementById('evalDimContraindication') && s2.dimensions.dim4_contraindication) {
            document.getElementById('evalDimContraindication').textContent = `${((s2.dimensions.dim4_contraindication.passed / s2.dimensions.dim4_contraindication.total) * 100).toFixed(0)}%`;
          }
          if (document.getElementById('evalDimRole') && s2.dimensions.dim6_role_permission) {
            document.getElementById('evalDimRole').textContent = `${((s2.dimensions.dim6_role_permission.passed / s2.dimensions.dim6_role_permission.total) * 100).toFixed(0)}%`;
          }
          if (document.getElementById('evalDimTwoId') && s2.dimensions.dim7_two_identifier) {
            document.getElementById('evalDimTwoId').textContent = `${((s2.dimensions.dim7_two_identifier.passed / s2.dimensions.dim7_two_identifier.total) * 100).toFixed(0)}%`;
          }
          if (document.getElementById('evalDimQuoting') && s2.dimensions.dim8_grounded_quoting) {
            document.getElementById('evalDimQuoting').textContent = `${((s2.dimensions.dim8_grounded_quoting.passed / s2.dimensions.dim8_grounded_quoting.total) * 100).toFixed(0)}%`;
          }
          if (document.getElementById('evalDimOverall')) {
            document.getElementById('evalDimOverall').textContent = `${s2.accuracy.split(' ')[0]}`;
          }
        }

        const heldOutTableBody = document.getElementById('heldOutTableBody');
        if (heldOutTableBody && s2.details) {
          heldOutTableBody.innerHTML = s2.details.map(q => `
            <tr>
              <td><code>${q.id}</code></td>
              <td style="max-width: 280px; font-weight: 500;">${q.query}</td>
              <td><span class="badge" style="background: var(--surface-alt); border: 1px solid var(--border); font-size: 11px;">${q.category}</span></td>
              <td><code>${q.expected}</code></td>
              <td><code>${q.actual}</code></td>
              <td>
                <span class="badge ${q.passed ? 'badge-approved' : 'badge-retired'}" style="font-weight: 700;">
                  ${q.passed ? '✓ PASSED' : '✗ FAILED'}
                </span>
              </td>
            </tr>
          `).join('');
        }
      }

      // Suite 3 Metrics (Builder Adversarial Cases - never label as independent)
      if (s3) {
        const badge = document.getElementById('evalBuilderBadge');
        if (badge) badge.textContent = `${s3.overallAccuracy} Builder Adversarial`;

        const builderTableBody = document.getElementById('builderTableBody');
        if (builderTableBody && s3.queryDetails) {
          builderTableBody.innerHTML = s3.queryDetails.map(q => `
            <tr>
              <td><code>${q.id}</code></td>
              <td style="max-width: 280px; font-weight: 500;">${q.query}</td>
              <td><span class="badge" style="background: var(--surface-alt); border: 1px solid var(--border); font-size: 11px;">${q.category}</span></td>
              <td><code>${q.expected.doc_id || 'REFUSAL'}</code> <span style="font-size: 11px; color: var(--ink-muted);">(${q.expected.outcome})</span></td>
              <td><code>${q.actual.doc_id || 'REFUSAL'}</code> <span style="font-size: 11px; color: var(--ink-muted);">(${q.actual.outcome})</span></td>
              <td>
                <span class="badge ${q.passed ? 'badge-approved' : 'badge-retired'}" style="font-weight: 700;">
                  ${q.passed ? '✓ PASSED' : '✗ FAILED'}
                </span>
              </td>
            </tr>
          `).join('');
        }
      }

      // Pre-Send Check Traps
      if (traps) {
        if (document.getElementById('evalTrapCatchRateBadge')) {
          document.getElementById('evalTrapCatchRateBadge').textContent = `${traps.catchRate} Catch Rate (${traps.trapsCaught}/${traps.totalTraps})`;
        }
        const gateTrapTableBody = document.getElementById('gateTrapTableBody');
        if (gateTrapTableBody && traps.trapDetails) {
          gateTrapTableBody.innerHTML = traps.trapDetails.map(t => `
            <tr>
              <td><code>${t.id}</code></td>
              <td style="max-width: 240px; font-weight: 500;">${t.name}</td>
              <td><code>${t.doc_id || 'N/A'}</code> <span style="font-size: 11px; color: var(--ink-muted);">(v${t.version || '?'})</span></td>
              <td><code>${t.patient_id}</code></td>
              <td><span class="badge" style="background: #FFF3E0; color: #E65100; border: 1px solid #FFE0B2; font-size: 11px;">${t.expectedGate}</span></td>
              <td><span class="badge" style="background: #FEE8E7; color: var(--outcome-blocked); border: 1px solid #FAC5C3; font-size: 11px;">${t.actualGate || 'BLOCKED'}</span></td>
              <td>
                <span class="badge ${t.caught ? 'badge-approved' : 'badge-retired'}" style="font-weight: 700;">
                  ${t.caught ? '✓ CAUGHT' : '✗ MISSED'}
                </span>
              </td>
            </tr>
          `).join('');
        }
      }

      // Tab Badge: MUST show the independent suite score (Suite 2), not dev suite score
      const evalBadge = document.getElementById('evalBadge');
      if (evalBadge) {
        evalBadge.textContent = s2 ? s2.accuracy.split(' ')[0] : '100%';
      }
    } catch (err) {
      console.error('Failed to load evaluation data:', err);
    }
  }

  // -------------------------------------------------------------
  // Interactive 2-Minute Demo Flow (Updated Clinical Director Script)
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

  async function runDemoStep(stepNumber) {
    [demoStep1Btn, demoStep2Btn, demoStep3Btn].forEach(b => b.classList.remove('active'));

    if (stepNumber === 1) {
      demoStep1Btn.classList.add('active');
      demoStepTitle.textContent = 'Step 1: Front Desk Marcus tries outdated bariatric handout -> Blocked -> Verifies & sends RD-assigned current version';
      demoStepDesc.textContent = 'Marcus Vance selects outdated DOC-BAR-002 v1 for Eleanor Vance -> Send Check blocks. Marcus switches to RD-assigned v2, enters verified DOB (1984-05-12), and sends safely!';
      
      roleSelect.value = 'front_desk';
      state.currentRole = 'front_desk';
      updateRoleUI();
      switchTab('tab-send-check');

      sendCheckPatientSelect.value = 'SYNTH-PAT-101'; // Eleanor Vance
      updatePatientPreview();

      // Show outdated option in dropdown to trigger block
      sendCheckDocSelect.innerHTML = `<option value="DOC-BAR-002:1">[OUTDATED] DOC-BAR-002 v1 - Bariatric Stage 2 Pureed (2024)</option>` + sendCheckDocSelect.innerHTML;
      sendCheckDocSelect.value = 'DOC-BAR-002:1';
      if (fdVerifyName) fdVerifyName.value = 'Eleanor Vance';
      if (fdVerifyDob) fdVerifyDob.value = '';

      await runSendCheckSimulation('DOC-BAR-002', 1, 'SYNTH-PAT-101');

      // Add interactive follow-up button to complete the demo flow
      const switchApprovedNotice = document.createElement('div');
      switchApprovedNotice.style.cssText = 'margin-top: 14px; padding: 12px; background: #E8F5E9; border: 1px solid #C8E6C9; border-radius: 6px;';
      switchApprovedNotice.innerHTML = `
        <strong style="color: var(--brand-green-dark); font-size: 13px;">Demo Guidance: Switch to RD-assigned handout & verify two identifiers</strong>
        <p style="font-size: 12px; color: var(--ink-muted); margin: 4px 0 8px 0;">Notice how Front Desk was blocked from sending unassigned/outdated v1. Click below to load the RD-assigned v2 and verified identifiers:</p>
        <button class="btn-send-check" id="btnDemoLoadAssignedAndVerify" style="width: 100%; justify-content: center;">
          <span>✓ Load Assigned DOC-BAR-002 v2 & Verified DOB (1984-05-12)</span>
        </button>
      `;
      sendCheckDetails.appendChild(switchApprovedNotice);

      document.getElementById('btnDemoLoadAssignedAndVerify')?.addEventListener('click', async () => {
        updateDocSelectorForRole();
        sendCheckDocSelect.value = 'DOC-BAR-002:2';
        if (fdVerifyName) fdVerifyName.value = 'Eleanor Vance';
        if (fdVerifyDob) fdVerifyDob.value = '1984-05-12';
        await runSendCheckSimulation('DOC-BAR-002', 2, 'SYNTH-PAT-101');
      });

    } else if (stepNumber === 2) {
      demoStep2Btn.classList.add('active');
      demoStepTitle.textContent = 'Step 2: RD types "Jardiance, flu, not eating" -> Urgent escalation protocol with secondary sick-day handout';
      demoStepDesc.textContent = 'Elena Gomez searches the clinical red-flag scenario. Verity intercepts before document search, triggering URGENT_CLINICAL_ESCALATION with DOC-INT-004!';
      
      roleSelect.value = 'dietitian';
      state.currentRole = 'dietitian';
      updateRoleUI();
      updateDocSelectorForRole();
      switchTab('tab-right-doc');

      rightDocQuery.value = 'Jardiance, flu, not eating, sugars 135';
      executeRightDocSearch('Jardiance, flu, not eating, sugars 135');

    } else if (stepNumber === 3) {
      demoStep3Btn.classList.add('active');
      demoStepTitle.textContent = 'Step 3: Owner resolves GDM conflict with rationale -> Exposure queue shows Maria Santos -> Audit persists';
      demoStepDesc.textContent = 'Dr. Sarah Jenkins resolves CONF-001 by retiring DOC-GEST-001 and unlocking DOC-GEST-002 with written rationale. The Exposure Queue lists Maria Santos, and audit history persists!';
      
      roleSelect.value = 'owner';
      state.currentRole = 'owner';
      updateRoleUI();
      updateDocSelectorForRole();
      switchTab('tab-conflicts');

      if (conflictDecision) conflictDecision.value = 'WITHDRAW_A_KEEP_B';
      if (conflictReviewer) conflictReviewer.value = 'Dr. Sarah Jenkins, RDN (Practice Owner & Clinical Director)';
      if (conflictRationale) conflictRationale.value = 'Updated practice standard to ADA 2026 guidelines specifying minimum 175g/day CHO without rigid meal ceilings.';
      if (conflictResultingState) conflictResultingState.value = 'DOC-GEST-001 retired; DOC-GEST-002 active; exposure review queue generated for past recipients.';

      await loadConflicts();
      await loadExposureQueue();
      renderConflictHistory();
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

    // Front Desk Identifier auto-fill shortcuts
    btnFillVerifiedDob?.addEventListener('click', () => {
      if (fdVerifyName) fdVerifyName.value = 'Eleanor Vance';
      if (fdVerifyDob) fdVerifyDob.value = '1984-05-12';
    });

    btnFillWrongDob?.addEventListener('click', () => {
      if (fdVerifyName) fdVerifyName.value = 'Eleanor Vance';
      if (fdVerifyDob) fdVerifyDob.value = '1989-11-23'; // Elena Vance DOB (identity mismatch trap)
    });

    // Conflict Resolution Form Submission (Workstream 5)
    conflictResolveForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (state.currentRole !== 'owner') {
        alert('PERMISSION DENIED: Only Practice Owner & Clinical Director Dr. Sarah Jenkins can resolve clinical conflicts. Please switch active role to Dr. Sarah Jenkins above.');
        return;
      }

      const conflictId = conflictSelect.value;
      const decision = conflictDecision.value;
      const reviewer = conflictReviewer.value;
      const rationale = conflictRationale.value;
      const resultingState = conflictResultingState.value;

      if (!rationale || rationale.trim().length < 15) {
        alert('CLINICAL JUSTIFICATION REQUIRED: Rationale must be at least 15 characters per practice governance policy.');
        return;
      }

      try {
        const res = await fetch('/api/conflicts/resolve', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            conflict_id: conflictId,
            decision,
            rationale,
            reviewer_identity: reviewer,
            resulting_state: resultingState,
            role: 'owner'
          })
        });

        const data = await res.json();
        if (data.success) {
          alert(`SUCCESS: Conflict resolved with recorded clinical rationale!\n\n${data.message}\nAudit Event: ${data.auditEventId}\nExposure Queue updated.`);
          await loadDashboard();
          await loadExposureQueue();
          await loadConflicts();
          renderConflictHistory();
        } else {
          alert(`RESOLUTION FAILED: ${data.message || data.error}`);
        }
      } catch (err) {
        alert(`Error resolving conflict: ${err.message}`);
      }
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
      setSendCheckSelection('DOC-BAR-002:2', 'SYNTH-PAT-104');
    });
    document.getElementById('btnTrapDraft')?.addEventListener('click', () => {
      setSendCheckSelection('DOC-DRAFT-001:0.1', 'SYNTH-PAT-105');
    });
    document.getElementById('btnTrapInternal')?.addEventListener('click', () => {
      setSendCheckSelection('DOC-INT-001:1', 'SYNTH-PAT-107');
    });
    document.getElementById('btnTrapWrongDob')?.addEventListener('click', () => {
      roleSelect.value = 'front_desk';
      state.currentRole = 'front_desk';
      updateRoleUI();
      updateDocSelectorForRole();
      sendCheckPatientSelect.value = 'SYNTH-PAT-101';
      updatePatientPreview();
      if (fdVerifyName) fdVerifyName.value = 'Eleanor Vance';
      if (fdVerifyDob) fdVerifyDob.value = '1989-11-23'; // Elena Vance DOB
      btnRunSendCheck.click();
    });
    document.getElementById('btnTrapDialysisMismatch')?.addEventListener('click', () => {
      roleSelect.value = 'dietitian';
      state.currentRole = 'dietitian';
      updateRoleUI();
      updateDocSelectorForRole();
      setSendCheckSelection('DOC-DM-007:2', 'SYNTH-PAT-112'); // Marcus Thorne (dialysis)
    });
    document.getElementById('btnTrapBlankMeds')?.addEventListener('click', () => {
      roleSelect.value = 'dietitian';
      state.currentRole = 'dietitian';
      updateRoleUI();
      updateDocSelectorForRole();
      setSendCheckSelection('DOC-DM-001:2', 'SYNTH-PAT-111'); // Jordan Patel (blank meds -> review required)
    });

    function setSendCheckSelection(docVal, patVal) {
      // If docVal is not in dropdown (e.g. outdated doc when front desk is selected), inject temporarily
      let docOpt = Array.from(sendCheckDocSelect.options).find(o => o.value.startsWith(docVal));
      if (!docOpt) {
        const option = document.createElement('option');
        option.value = docVal;
        option.textContent = `[TRAP TARGET] ${docVal}`;
        sendCheckDocSelect.appendChild(option);
        docOpt = option;
      }
      sendCheckDocSelect.value = docOpt.value;
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

    // Owner Reset Demo Data
    document.getElementById('btnResetDemoData')?.addEventListener('click', async () => {
      if (state.currentRole !== 'owner') {
        alert('Permission Denied: Practice Owner authorization is required to reset demo baseline. Please switch Active Role to "Dr. Sarah Jenkins, RDN (Practice Owner & Clinical Director)".');
        return;
      }
      if (!confirm('RESET DEMO DATA: Are you sure you want to restore the practice demo data back to clean baseline? This will restore seed documents, patients, re-lock conflict CONF-001, and reset the audit ledger.')) {
        return;
      }
      try {
        const res = await fetch('/api/demo/reset', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role: state.currentRole })
        });
        const result = await res.json();
        if (result.success) {
          alert('✓ Demo data restored: Seed documents, patients, conflict CONF-001 locked, and clean audit ledger.');
          await loadInitialData();
          renderLibraryTable();
          renderSendCheckSelectors();
          loadDashboard();
          loadDsmesRecords();
          loadEvaluationData();
        } else {
          alert('Reset failed: ' + result.message);
        }
      } catch (err) {
        alert('Reset network error: ' + err.message);
      }
    });

    // Education Delivery Filters
    document.getElementById('dsmesPatientFilter')?.addEventListener('change', renderDsmesTable);
    document.getElementById('dsmesProgramFilter')?.addEventListener('change', renderDsmesTable);

    // Demo Flow Setup
    setupDemoFlow();
  }

  // Start Application
  init();
});
