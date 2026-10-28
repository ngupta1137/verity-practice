// Verity Practice diff engine: Line and Word level comparison
// Lineage: Adapted from ngupta1137/verity src/engine/drift.ts

export function wordDiff(oldText, newText) {
  const oldWords = (oldText || '').split(/\s+/).filter(Boolean);
  const newWords = (newText || '').split(/\s+/).filter(Boolean);

  const lcs = computeLCS(oldWords, newWords);
  const diff = [];
  let i = 0, j = 0, k = 0;

  while (i < oldWords.length || j < newWords.length) {
    if (k < lcs.length && i < oldWords.length && oldWords[i] === lcs[k] && j < newWords.length && newWords[j] === lcs[k]) {
      diff.push({ type: 'equal', text: lcs[k] });
      i++;
      j++;
      k++;
    } else if (i < oldWords.length && (k >= lcs.length || oldWords[i] !== lcs[k])) {
      diff.push({ type: 'removed', text: oldWords[i] });
      i++;
    } else if (j < newWords.length && (k >= lcs.length || newWords[j] !== lcs[k])) {
      diff.push({ type: 'added', text: newWords[j] });
      j++;
    }
  }

  return diff;
}

function computeLCS(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  const result = [];
  let i = m, j = n;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      result.unshift(a[i - 1]);
      i--;
      j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }
  return result;
}

export function compareDocumentVersions(oldDoc, newDoc) {
  if (!oldDoc || !newDoc) return null;

  const sectionDiffs = [];
  const oldSections = oldDoc.sections || [];
  const newSections = newDoc.sections || [];

  for (const newSec of newSections) {
    const matchingOld = oldSections.find(s => s.heading.toLowerCase() === newSec.heading.toLowerCase());
    if (matchingOld) {
      const words = wordDiff(matchingOld.content, newSec.content);
      const changesCount = words.filter(w => w.type !== 'equal').length;
      sectionDiffs.push({
        heading: newSec.heading,
        status: changesCount > 0 ? 'modified' : 'identical',
        wordDiff: words,
        oldText: matchingOld.content,
        newText: newSec.content
      });
    } else {
      sectionDiffs.push({
        heading: newSec.heading,
        status: 'added',
        wordDiff: wordDiff('', newSec.content),
        oldText: '',
        newText: newSec.content
      });
    }
  }

  for (const oldSec of oldSections) {
    const exists = newSections.some(s => s.heading.toLowerCase() === oldSec.heading.toLowerCase());
    if (!exists) {
      sectionDiffs.push({
        heading: oldSec.heading,
        status: 'removed',
        wordDiff: wordDiff(oldSec.content, ''),
        oldText: oldSec.content,
        newText: ''
      });
    }
  }

  return {
    oldVersion: { doc_id: oldDoc.doc_id, version: oldDoc.version, title: oldDoc.title, status: oldDoc.status },
    newVersion: { doc_id: newDoc.doc_id, version: newDoc.version, title: newDoc.title, status: newDoc.status },
    sectionDiffs
  };
}
