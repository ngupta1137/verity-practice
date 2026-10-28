// Smoke Test for Verity Practice Web Client
// Ensures zero syntax errors, verifies clean page load, and asserts zero console errors.

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

console.log('===============================================================');
console.log('       VERITY PRACTICE - CLIENT SMOKE & BROWSER TEST            ');
console.log('===============================================================\n');

let failed = false;
const errors = [];

// 1. Verify all client scripts parse with zero syntax errors
const clientFiles = [
  'public/js/app.js',
  'src/ui/js/app.js'
];

for (const relPath of clientFiles) {
  const fullPath = path.join(ROOT_DIR, relPath);
  console.log(`[CHECK] Validating JavaScript syntax: ${relPath}...`);
  if (!fs.existsSync(fullPath)) {
    console.error(`[FAIL] File not found: ${relPath}`);
    errors.push(`Missing file: ${relPath}`);
    failed = true;
    continue;
  }

  const code = fs.readFileSync(fullPath, 'utf8');
  try {
    new vm.Script(code, { filename: relPath });
    console.log(`[PASS] Syntax clean: ${relPath}`);
  } catch (err) {
    console.error(`[FAIL] Syntax error in ${relPath}:`, err.message);
    errors.push(`Syntax error in ${relPath}: ${err.message}`);
    failed = true;
  }
}

// 2. Validate HTML Structure and Element IDs expected by app.js
console.log('\n[CHECK] Validating HTML elements and IDs in public/index.html...');
const htmlPath = path.join(ROOT_DIR, 'public/index.html');
const htmlContent = fs.readFileSync(htmlPath, 'utf8');

const requiredElementIds = [
  'currentRole',
  'rightDocQuery',
  'btnSearchRightDoc',
  'rightDocResults',
  'sendCheckDocSelect',
  'sendCheckPatientSelect',
  'selectedPatientPreview',
  'btnRunSendCheck',
  'sendCheckDetails',
  'gateResultBadge',
  'sendCheckModal',
  'diffModal',
  'docDetailModal',
  'startDemoBtn',
  'demoBanner',
  'tab-right-doc',
  'tab-send-check',
  'tab-library',
  'tab-conflicts',
  'tab-owner',
  'tab-dsmes',
  'tab-qa',
  'tab-eval'
];

for (const id of requiredElementIds) {
  if (!htmlContent.includes(`id="${id}"`) && !htmlContent.includes(`id='${id}'`)) {
    console.error(`[FAIL] Required element id="${id}" missing from public/index.html`);
    errors.push(`Missing required element #${id}`);
    failed = true;
  }
}
console.log(`[PASS] All ${requiredElementIds.length} required interactive element IDs present.`);

// 3. Validate Seed Data Integrity (Patient Assignments against Document Library)
console.log('\n[CHECK] Validating synthetic patient document assignments against document library...');
const patientsPath = path.join(ROOT_DIR, 'data/synthetic_patients.json');
const docsPath = path.join(ROOT_DIR, 'data/documents.json');

if (fs.existsSync(patientsPath) && fs.existsSync(docsPath)) {
  const seedPatients = JSON.parse(fs.readFileSync(patientsPath, 'utf8'));
  const seedDocs = JSON.parse(fs.readFileSync(docsPath, 'utf8'));
  let seedAssignmentErrors = 0;

  for (const pat of seedPatients) {
    for (const ad of (pat.assigned_documents || [])) {
      const match = seedDocs.find(d => d.doc_id === ad.doc_id && Number(d.version) === Number(ad.version));
      if (!match) {
        seedAssignmentErrors++;
        const msg = `Patient ${pat.patient_id} (${pat.name}) assigned non-existent document ${ad.doc_id} v${ad.version}`;
        console.error(`[FAIL] ${msg}`);
        errors.push(msg);
        failed = true;
      }
    }
  }

  if (seedAssignmentErrors === 0) {
    console.log('[PASS] All synthetic patient assignments reference valid doc_ids and versions in the document library.');
  }
}

// 4. Execution Smoke Test with Virtual Browser Environment
console.log('\n[CHECK] Running execution smoke test with DOM environment...');
const consoleErrors = [];

class MockElement {
  constructor(tag = 'div', id = '') {
    this.tagName = tag.toUpperCase();
    this.id = id;
    this.classList = new Set();
    this.classList.add = (c) => this.classList.add(c);
    this.classList.remove = (c) => this.classList.delete(c);
    this.classList.contains = (c) => this.classList.has(c);
    this.dataset = {};
    this.innerHTML = '';
    this.textContent = '';
    this.style = {};
    this.value = '';
    this.options = [];
    this.listeners = {};
    this.disabled = false;
  }
  addEventListener(event, fn) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(fn);
  }
  click() {
    if (this.listeners['click']) {
      this.listeners['click'].forEach(fn => fn({ preventDefault: () => {} }));
    }
  }
}

const mockElements = new Map();
function getMockElement(id) {
  if (!mockElements.has(id)) {
    const el = new MockElement('div', id);
    if (id.includes('Select') || id.includes('Filter')) {
      el.tagName = 'SELECT';
      el.options = [];
    }
    if (id.includes('btn') || id.includes('Btn')) {
      el.tagName = 'BUTTON';
    }
    mockElements.set(id, el);
  }
  return mockElements.get(id);
}

const mockDocListeners = {};
const mockWindowListeners = {};

const mockDocuments = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'data/documents.json'), 'utf8'));
const mockPatients = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'data/synthetic_patients.json'), 'utf8'));
const mockDsmes = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'data/dsmes_records.json'), 'utf8'));

const virtualSandbox = {
  console: {
    log: () => {},
    warn: (msg) => console.warn('[BROWSER WARN]', msg),
    error: (...args) => {
      console.error('[BROWSER ERROR TRAPPED]:', ...args);
      consoleErrors.push(args.join(' '));
    }
  },
  document: {
    addEventListener: (event, fn) => {
      if (!mockDocListeners[event]) mockDocListeners[event] = [];
      mockDocListeners[event].push(fn);
    },
    getElementById: (id) => getMockElement(id),
    querySelectorAll: (selector) => {
      if (selector === '.nav-tab') {
        return [
          getMockElement('tab-btn-1'),
          getMockElement('tab-btn-2'),
          getMockElement('tab-btn-3')
        ];
      }
      if (selector === '.tab-pane') {
        return [
          getMockElement('tab-right-doc'),
          getMockElement('tab-send-check')
        ];
      }
      return [];
    },
    createElement: (tag) => new MockElement(tag)
  },
  window: {
    addEventListener: (event, fn) => {
      if (!mockWindowListeners[event]) mockWindowListeners[event] = [];
      mockWindowListeners[event].push(fn);
    }
  },
  fetch: async (url) => {
    if (url.includes('/api/documents')) return { json: async () => mockDocuments };
    if (url.includes('/api/patients')) return { json: async () => mockPatients };
    if (url.includes('/api/dashboard')) return {
      json: async () => ({
        summary: { complianceRate: 98, blockedSends: 2, successfulSends: 45, expiredDocsCount: 5 },
        mostUsed: [],
        recentBlockedSends: [],
        conflicts: [],
        documentsDueForReview: []
      })
    };
    if (url.includes('/api/audit-log')) return { json: async () => ({ entries: [] }) };
    if (url.includes('/api/dsmes-records')) return { json: async () => mockDsmes };
    if (url.includes('/api/eval')) return {
      json: async () => ({
        suite1_regression: { overallAccuracy: '100%', inScopeTop1Accuracy: '100%', trapHandlingRate: '100%', outOfLibraryRefusalRate: '100%', counts: { inScope: { passed: 21, total: 21 }, traps: { passed: 4, total: 4 }, outOfLibrary: { passed: 6, total: 6 }, internal: { passed: 4, total: 4 }, total: { passed: 35, total: 35 } }, queryDetails: [] },
        suite2_held_out: { overallAccuracy: '100%', inScopeTop1Accuracy: '100%', trapHandlingRate: '100%', outOfLibraryRefusalRate: '100%', counts: { inScope: { passed: 17, total: 17 }, traps: { passed: 1, total: 1 }, outOfLibrary: { passed: 2, total: 2 }, total: { passed: 20, total: 20 } }, queryDetails: [] },
        preSendCheckTraps: { catchRate: '100%', trapsCaught: 17, totalTraps: 17, trapDetails: [] }
      })
    };
    return { json: async () => ({}) };
  },
  setTimeout: (fn) => fn(),
  clearTimeout: () => {},
  alert: () => {}
};

try {
  const code = fs.readFileSync(path.join(ROOT_DIR, 'public/js/app.js'), 'utf8');
  vm.createContext(virtualSandbox);
  vm.runInContext(code, virtualSandbox);

  // Trigger DOMContentLoaded
  if (mockDocListeners['DOMContentLoaded']) {
    for (const listener of mockDocListeners['DOMContentLoaded']) {
      listener();
    }
  }

  // Allow async promises in init() to flush
  await new Promise(r => setTimeout(r, 200));

  if (consoleErrors.length > 0) {
    failed = true;
    errors.push(...consoleErrors);
  } else {
    console.log('[PASS] DOMContentLoaded and init() executed with ZERO console errors.');
  }
} catch (err) {
  failed = true;
  console.error('[FAIL] Runtime crash during execution:', err);
  errors.push(`Runtime crash: ${err.message}`);
}

if (failed || errors.length > 0) {
  console.error('\n❌ SMOKE TEST FAILED! DEPLOYMENT BLOCKED.');
  console.error('Errors detected:');
  for (const e of errors) {
    console.error(`  - ${e}`);
  }
  process.exit(1);
} else {
  console.log('\n✅ SMOKE TEST PASSED: All client code is syntax-clean, DOM-compatible, and error-free.');
  process.exit(0);
}
