// comparison.js — deterministic, local comparison engine. No network, no AI service.
//
// Two layers:
//   1. diffText()      word-level text diff (ignores case, punctuation and whitespace).
//   2. compareScope()  requirement-level comparison built on simple, transparent heuristics:
//                      sentence splitting, stemmed keyword overlap (Dice coefficient),
//                      cue words ("remove", "change ... to"), and a vague-wording list.
//
// These heuristics do NOT understand meaning. Every finding carries a plain-language
// reason and a confidence label, and the user always makes the final call.

import { hashString, truncate } from './utils.js';

export const LIMITS = { maxChars: 60000, maxStatements: 1500, dpCells: 16000000 };

export const FINDING_TYPES = ['new', 'modified', 'removed', 'ambiguous', 'duplicate', 'unchanged'];

export const TYPE_LABELS = {
  new: 'Potentially new requirement',
  modified: 'Modified requirement',
  removed: 'Potentially removed requirement',
  ambiguous: 'Ambiguous change',
  duplicate: 'Possible duplicate',
  unchanged: 'Unchanged requirement',
};

export const STATUS_LABELS = {
  pending: 'Not reviewed',
  relevant: 'Relevant change',
  irrelevant: 'Not relevant',
  clarify: 'Needs clarification',
};

/* ------------------------------------------------------------------ */
/* Tokenising and word-level diff                                      */
/* ------------------------------------------------------------------ */

const WORD_RE = /[\p{L}\p{N}]+(?:[.,'’\-/][\p{L}\p{N}]+)*%?/gu;

function normWord(w) {
  let n = w.toLowerCase().replace(/’/g, "'");
  if (/^\d[\d,]*(\.\d+)?%?$/.test(n)) n = n.replace(/,/g, '');
  return NUMBER_WORDS[n] || n;
}

/** Splits text into words (kept with the punctuation/whitespace that follows each). */
export function tokenize(text) {
  const src = String(text ?? '').replace(/\r\n?/g, '\n');
  const words = [];
  let lastEnd = 0;
  let lead = '';
  for (const m of src.matchAll(WORD_RE)) {
    const gap = src.slice(lastEnd, m.index);
    if (words.length === 0) lead = gap;
    else words[words.length - 1].gap = gap;
    words.push({ text: m[0], norm: normWord(m[0]), gap: '' });
    lastEnd = m.index + m[0].length;
  }
  if (words.length) words[words.length - 1].gap = src.slice(lastEnd);
  else lead = src;
  return { words, lead };
}

function tidyGap(g) {
  if (!g) return '';
  return g.replace(/[ \t\f\v ]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{3,}/g, '\n\n');
}

/** Longest-common-subsequence diff over arrays of strings. */
function diffArrays(a, b) {
  const ops = [];
  const n = a.length;
  const m = b.length;
  let s = 0;
  while (s < n && s < m && a[s] === b[s]) s++;
  let ea = n;
  let eb = m;
  while (ea > s && eb > s && a[ea - 1] === b[eb - 1]) { ea--; eb--; }
  for (let i = 0; i < s; i++) ops.push({ t: 'eq', ai: i, bi: i });

  const N = ea - s;
  const M = eb - s;
  let approximate = false;
  if (N === 0) {
    for (let j = 0; j < M; j++) ops.push({ t: 'add', bi: s + j });
  } else if (M === 0) {
    for (let i = 0; i < N; i++) ops.push({ t: 'del', ai: s + i });
  } else if (N * M > LIMITS.dpCells) {
    approximate = true; // too big for exact DP: report the middle block as replaced
    for (let i = 0; i < N; i++) ops.push({ t: 'del', ai: s + i });
    for (let j = 0; j < M; j++) ops.push({ t: 'add', bi: s + j });
  } else {
    const W = M + 1;
    const L = new Uint16Array((N + 1) * W);
    for (let i = N - 1; i >= 0; i--) {
      for (let j = M - 1; j >= 0; j--) {
        L[i * W + j] = a[s + i] === b[s + j]
          ? L[(i + 1) * W + j + 1] + 1
          : Math.max(L[(i + 1) * W + j], L[i * W + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < N && j < M) {
      if (a[s + i] === b[s + j]) { ops.push({ t: 'eq', ai: s + i, bi: s + j }); i++; j++; }
      else if (L[(i + 1) * W + j] >= L[i * W + j + 1]) { ops.push({ t: 'del', ai: s + i }); i++; }
      else { ops.push({ t: 'add', bi: s + j }); j++; }
    }
    while (i < N) { ops.push({ t: 'del', ai: s + i }); i++; }
    while (j < M) { ops.push({ t: 'add', bi: s + j }); j++; }
  }
  for (let k = 0; k < n - ea; k++) ops.push({ t: 'eq', ai: ea + k, bi: eb + k });
  return { ops, approximate };
}

/**
 * Word-level diff of two texts. Case, punctuation and whitespace differences are ignored,
 * so reflowed or re-punctuated text is not reported as changed.
 * Returns { chunks:[{type:'eq'|'add'|'del', text}], stats, identical, formattingOnly }.
 */
export function diffText(a, b) {
  const ta = tokenize(a);
  const tb = tokenize(b);
  const { ops, approximate } = diffArrays(ta.words.map((w) => w.norm), tb.words.map((w) => w.norm));

  const chunks = [];
  const push = (type, text) => {
    if (!text) return;
    const last = chunks[chunks.length - 1];
    if (last && last.type === type) last.text += text;
    else chunks.push({ type, text });
  };
  const lead = tidyGap(tb.lead || ta.lead);
  if (lead.trim()) push('eq', lead);

  let added = 0;
  let removed = 0;
  let unchanged = 0;
  let i = 0;
  while (i < ops.length) {
    if (ops[i].t === 'eq') {
      const w = tb.words[ops[i].bi];
      push('eq', w.text + tidyGap(w.gap));
      unchanged++;
      i++;
      continue;
    }
    let dels = '';
    let adds = '';
    while (i < ops.length && ops[i].t !== 'eq') {
      if (ops[i].t === 'del') {
        const w = ta.words[ops[i].ai];
        dels += w.text + tidyGap(w.gap);
        removed++;
      } else {
        const w = tb.words[ops[i].bi];
        adds += w.text + tidyGap(w.gap);
        added++;
      }
      i++;
    }
    push('del', dels);
    push('add', adds);
  }

  const total = ta.words.length + tb.words.length;
  const similarity = total === 0 ? 100 : Math.round((2 * unchanged / total) * 100);
  const identical = added === 0 && removed === 0;
  const squash = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
  return {
    chunks,
    stats: { added, removed, unchanged, similarity, approximate },
    identical,
    formattingOnly: identical && squash(a) !== squash(b),
  };
}

/** Collapses long unchanged runs so the diff stays readable on small screens. */
export function collapseChunks(chunks, context = 12) {
  const out = [];
  chunks.forEach((c, idx) => {
    if (c.type !== 'eq') { out.push(c); return; }
    const toks = c.text.match(/\S+\s*|\s+/g) || [];
    const head = idx === 0 ? 0 : context;
    const tail = idx === chunks.length - 1 ? 0 : context;
    if (toks.length <= head + tail + 8) { out.push(c); return; }
    if (head) out.push({ type: 'eq', text: toks.slice(0, head).join('') });
    const hidden = toks.slice(head, toks.length - tail);
    out.push({ type: 'gap', text: hidden.join(''), hidden: hidden.filter((t) => t.trim()).length });
    if (tail) out.push({ type: 'eq', text: toks.slice(toks.length - tail).join('') });
  });
  return out;
}

/* ------------------------------------------------------------------ */
/* Statement splitting and keyword analysis                            */
/* ------------------------------------------------------------------ */

const STOP = new Set(('a an the and or but of to in on at for with by from as is are be been being was were will shall would should can could may might must ' +
  'that this these those it its their there we you i our your us them they he she which who whom what when where also so then than into per via have has had do does did ' +
  'not no any all each every up out about over only just very more most such if please thanks thank hi hello hey dear like want need able include includes included including ' +
  'add adding added new make get let know sure sounds good great').split(' '));

const NUMBER_WORDS = { one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10' };

export function stem(word) {
  let w = word;
  if (/\d/.test(w) || w.length <= 3) return w;
  if (w.endsWith('ies') && w.length > 4) w = w.slice(0, -3) + 'y';
  else if (w.endsWith('sses')) w = w.slice(0, -2);
  else if (w.endsWith('ing') && w.length > 5) { w = w.slice(0, -3); if (/([^aeiou])\1$/.test(w)) w = w.slice(0, -1); }
  else if (w.endsWith('ed') && w.length > 4) { w = w.slice(0, -2); if (/([^aeiou])\1$/.test(w)) w = w.slice(0, -1); }
  else if (/(s|x|z|ch|sh)es$/.test(w) && w.length > 4) w = w.slice(0, -2);
  else if (w.endsWith('s') && !/(ss|us|is)$/.test(w)) w = w.slice(0, -1);
  if (w.length > 3 && w.endsWith('e')) w = w.slice(0, -1);
  return w;
}

/** Stemmed, stop-word-free keywords of a statement. */
export function contentTokens(text) {
  const words = String(text ?? '').toLowerCase().replace(/’/g, "'").replace(/'s\b/g, '').match(/[\p{L}\p{N}]+/gu) || [];
  const out = [];
  for (const raw of words) {
    const w = NUMBER_WORDS[raw] || raw;
    if (STOP.has(w)) continue;
    if (w.length < 2 && !/\d/.test(w)) continue;
    out.push(stem(w));
  }
  return out;
}

function dice(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return (2 * inter) / (a.size + b.size);
}
const shared = (a, b) => { let n = 0; for (const x of a) if (b.has(x)) n++; return n; };
const containment = (r, o) => (r.size ? shared(r, o) / r.size : 0);

const ABBR = /\b(e\.g|i\.e|vs|approx|incl|mr|mrs|ms|dr|inc|ltd|co|st|fig|min|max)\./gi;
const BULLET = /^\s*(?:[-*•▪‣◦–—>]+|\d{1,3}[.)]|\(?[a-zA-Z]\)|\(\d{1,3}\)|[ivxIVX]{1,4}\.)\s+/;
const SENTENCE_SPLIT = /(?<=[.!?]["')\]]?)\s+(?=[\p{Lu}\p{N}"'(\[])/u;
const COURTESY = /^(hi|hello|hey|dear|thanks|thank you|regards|best|cheers|hope|let me know|looking forward|sounds good|ok|okay|great|sure|noted)\b/i;
const LEAD = /^(?:(?:hi|hello|hey|dear)\b[^,.!?\n]{0,30}[,!.:]?\s*)?(?:(?:also|and|additionally|one more thing|another thing|btw|by the way|so|ok(?:ay)?|well)[,:]?\s+)*(?:(?:can|could|would|will) you (?:please |kindly )?(?:also )?|please (?:also )?|kindly |we(?:'d| would) like (?:you )?to |we(?:'d| would) like |we want (?:you )?to |we need (?:you )?to |i(?:'d| would) like (?:you )?to |i want (?:you )?to |i need (?:you )?to |it would be (?:great|nice) if (?:you could |we could )?|would it be possible to |is it possible to |how about |what about )?/i;

function cleanRequestText(text) {
  let t = text.replace(LEAD, '').replace(/\s*(?:thanks!?|thank you!?|please!?)[.!\s]*$/i, '').trim();
  t = t.replace(/\?+$/, '.').trim();
  if (!t) t = text.trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/**
 * Splits text into requirement-like statements: bullet items and sentences.
 * Headings (short lines ending in ":" or ALL CAPS) are skipped.
 */
export function splitStatements(text, { conversational = false } = {}) {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n').map((l) => l.trim());
  const units = [];
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    if (!line) continue;
    const isBullet = BULLET.test(line);
    if (!isBullet) {
      // Re-join hard-wrapped lines: no terminal punctuation and the next line continues in lowercase.
      while (!/[.!?:;]["')\]]?$/.test(line) && i + 1 < lines.length && lines[i + 1] && !BULLET.test(lines[i + 1]) && /^[a-z]/.test(lines[i + 1])) {
        line += ' ' + lines[++i];
      }
    }
    units.push({ text: line, bullet: isBullet });
  }

  const out = [];
  for (const u of units) {
    let line = u.text.replace(BULLET, '').trim();
    if (/^#{1,6}\s/.test(line)) continue; // markdown heading
    const wordCount = (line.match(/\S+/g) || []).length;
    if (/:$/.test(line) && wordCount <= 10) continue; // "Deliverables:"
    if (!u.bullet && /\p{L}/u.test(line) && line === line.toUpperCase() && wordCount <= 8 && !/[.!?]$/.test(line)) continue;
    const protectedLine = line.replace(ABBR, (m) => m.replace('.', '\u0000'));
    const sentences = protectedLine.split(SENTENCE_SPLIT).map((s) => s.replace(/\u0000/g, '.').trim()).filter(Boolean);
    for (const s of sentences) {
      const words = (s.match(/[\p{L}\p{N}]+/gu) || []).length;
      if (words < 2) continue;
      if (conversational && words <= 8 && COURTESY.test(s) && contentTokens(s).length < 2) continue;
      out.push({ text: s, clean: conversational ? cleanRequestText(s) : s });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Wording heuristics                                                  */
/* ------------------------------------------------------------------ */

const VAGUE = ['etc', 'and so on', 'and more', 'and similar', 'as needed', 'as required', 'if needed', 'if possible', 'where possible', 'tbd',
  'to be decided', 'to be confirmed', 'asap', 'soon', 'some', 'several', 'various', 'a few', 'simple', 'simply', 'minor', 'small', 'quick',
  'quickly', 'easy', 'basic', 'similar to', 'something like', 'user-friendly', 'modern', 'nice', 'better', 'improve', 'improved', 'enhance',
  'polish', 'tweak', 'revamp', 'unlimited', 'any number of', 'as many as', 'whatever', 'anything', 'maybe', 'probably', 'fast', 'intuitive'];
const VAGUE_RE = new RegExp(`(?<![\\p{L}\\p{N}])(${VAGUE.map((v) => v.replace(/[\\^$*+?.()|[\]{}]/g, '\\$&')).join('|')})(?![\\p{L}\\p{N}])`, 'giu');

export function findVagueTerms(text) {
  const found = new Set();
  for (const m of String(text).matchAll(VAGUE_RE)) found.add(m[1].toLowerCase());
  return [...found];
}

const QUESTION_RE = /\?\s*$|^(can|could|would) you\b|^(would it be|is it) possible\b|^(what|how) about\b/i;
const REMOVE_RE = /\b(remove|drop|delete|discard|scrap|cancel|eliminate|get rid of|take out|leave out|skip|no longer (?:need|want|require)|(?:do not|don't|dont|doesn't|does not) (?:need|want|require)|not (?:needed|required|necessary))\b/i;
const CHANGE_RE = /\b(change|switch|replace|swap|update|modify|convert|instead of|rather than|rename|increase|reduce|decrease|extend|shorten)\b/i;
const EXCLUSION_RE = /\b(not include|does not include|do not include|doesn't include|not included|excluded?|exclusions?|out of scope|not covered|not part of|outside (?:the )?scope|excluding|except)\b/i;
const CUE_STEMS = new Set(['remove', 'drop', 'delete', 'discard', 'scrap', 'cancel', 'eliminate', 'longer', 'skip', 'leave', 'change', 'switch', 'replace',
  'swap', 'update', 'modify', 'convert', 'instead', 'rather', 'rename', 'increase', 'reduce', 'decrease', 'extend', 'shorten', 'now', 'currently', 'rid', 'take']
  .map(stem));

const INSIGNIFICANT = new Set(('a an the of to in on at for by from as is are be been being was were that this these those it its their there which so then into via with have has had do does did').split(' '));
const NEGATION = new Set(['not', 'no', 'without', 'never', 'exclude', 'excluding', 'excluded', 'except', "n't", "don't", "doesn't", "won't", "isn't", "aren't"]);
const MODAL = new Set(['must', 'shall', 'will', 'should', 'may', 'might', 'can', 'could', 'optional', 'mandatory', 'required', 'would']);
const BREADTH = new Set(['all', 'any', 'every', 'each', 'unlimited', 'additional', 'extra', 'more', 'also', 'including', 'plus', 'only', 'maximum', 'minimum', 'least', 'most', 'up', 'fewer', 'less', 'between']);

function prep(stmt) {
  const base = stmt.clean || stmt.text;
  const list = contentTokens(base);
  return {
    ...stmt,
    norm: tokenize(stmt.text).words.map((w) => w.norm).join(' '),
    set: new Set(list),
    vague: findVagueTerms(stmt.text),
    question: QUESTION_RE.test(stmt.text.trim()),
    exclusion: EXCLUSION_RE.test(stmt.text),
  };
}

/** Words that differ between two statements, plus plain-language meaning flags. */
function describeChange(a, b) {
  const d = diffText(a, b);
  const words = (type) => d.chunks.filter((c) => c.type === type).flatMap((c) => tokenize(c.text).words.map((w) => w.norm));
  const del = words('del');
  const add = words('add');
  const all = [...del, ...add];
  const meaningful = all.some((w) => !INSIGNIFICANT.has(w));
  const flags = [];
  const nums = (arr) => arr.filter((w) => /\d/.test(w) || NUMBER_WORDS[w] || ['twice', 'double', 'triple', 'once'].includes(w));
  if (nums(del).length || nums(add).length) {
    flags.push(`Numbers or quantities differ (${nums(del).join(', ') || 'none'} → ${nums(add).join(', ') || 'none'}).`);
  }
  if (all.some((w) => NEGATION.has(w))) flags.push('Wording about exclusions or negation changed (e.g. not / without / except).');
  if (all.some((w) => MODAL.has(w))) flags.push('Obligation wording changed (e.g. must / should / may / optional).');
  if (all.some((w) => BREADTH.has(w))) flags.push('Wording about breadth or limits changed (e.g. all / any / unlimited / additional / up to).');
  return { diff: d, del, add, meaningful, flags };
}

/* ------------------------------------------------------------------ */
/* Findings                                                            */
/* ------------------------------------------------------------------ */

const pct = (x) => `${Math.round(x * 100)}%`;
const confidenceFor = (s) => (s >= 0.8 ? 'high' : s >= 0.6 ? 'medium' : 'low');
const listWords = (arr) => [...new Set(arr)].slice(0, 8).join(' ');

let counter = 0;
function makeFinding({ type, original = '', updated = '', title, reason, flags = [], confidence = 'medium', similarity = null, source = null, closest = null, related = null, diff = null }) {
  const key = hashString(`${type}|${tokenize(original).words.map((w) => w.norm).join(' ')}|${tokenize(updated).words.map((w) => w.norm).join(' ')}`);
  counter += 1;
  return {
    id: `f_${key}_${counter}`,
    key,
    type,
    title: truncate(title || updated || original, 70) || TYPE_LABELS[type],
    original,
    updated,
    reason,
    flags,
    confidence,
    similarity,
    source,
    closest,
    related,
    diff: diff && diff.length ? diff : null,
    status: 'pending',
    note: '',
  };
}

function applyWording(f, prepared) {
  // Adds vague-wording notes; may reclassify a short, vague "new" statement as ambiguous.
  if (!prepared || !prepared.vague.length) return f;
  const shortText = (prepared.text.match(/\S+/g) || []).length < 8;
  f.flags.push(`Possibly vague wording: ${prepared.vague.map((v) => `“${v}”`).join(', ')}. Worth confirming exactly what is meant.`);
  if (f.type === 'new' && (prepared.question || shortText)) {
    f.type = 'ambiguous';
    f.reason = 'Reads as a request, but the wording is vague, so it is unclear what would actually change.';
    f.confidence = 'low';
  }
  return f;
}

function closestInfo(p, O, skip = new Set()) {
  let best = null;
  let bestSim = 0;
  O.forEach((o, i) => {
    if (skip.has(i)) return;
    const s = dice(p.set, o.set);
    if (s > bestSim) { bestSim = s; best = o; }
  });
  return best && bestSim >= 0.25 ? { text: best.text, similarity: bestSim } : null;
}

function relatedExclusion(p, O) {
  let best = null;
  let bestShared = 1;
  for (const o of O) {
    if (!EXCLUSION_RE.test(o.text)) continue;
    const n = shared(p.set, o.set);
    if (n > bestShared) { bestShared = n; best = o; }
  }
  return best ? { text: best.text } : null;
}

/** Greedy best-first matching of statements between two lists. */
function matchStatements(O, U) {
  const pairs = [];
  const usedO = new Set();
  const usedU = new Set();
  // 1. exact matches (normalised), preserving order for repeated statements
  const byNorm = new Map();
  U.forEach((u, j) => { if (!byNorm.has(u.norm)) byNorm.set(u.norm, []); byNorm.get(u.norm).push(j); });
  O.forEach((o, i) => {
    const q = byNorm.get(o.norm);
    if (q && q.length) { const j = q.shift(); pairs.push({ i, j, sim: 1, weak: false }); usedO.add(i); usedU.add(j); }
  });
  // 2. fuzzy matches by keyword overlap
  const cands = [];
  O.forEach((o, i) => {
    if (usedO.has(i)) return;
    U.forEach((u, j) => {
      if (usedU.has(j)) return;
      const s = dice(o.set, u.set);
      if (s < 0.34) return;
      const pos = 0.02 * (1 - Math.abs(i / Math.max(O.length, 1) - j / Math.max(U.length, 1)));
      cands.push({ i, j, sim: s, score: s + pos });
    });
  });
  cands.sort((a, b) => b.score - a.score);
  for (const c of cands) {
    if (usedO.has(c.i) || usedU.has(c.j)) continue;
    const strong = c.sim >= 0.5;
    if (!strong && shared(O[c.i].set, U[c.j].set) < 2) continue;
    pairs.push({ i: c.i, j: c.j, sim: c.sim, weak: !strong });
    usedO.add(c.i);
    usedU.add(c.j);
  }
  return {
    pairs,
    unmatchedO: O.map((_, i) => i).filter((i) => !usedO.has(i)),
    unmatchedU: U.map((_, j) => j).filter((j) => !usedU.has(j)),
  };
}

function pairFinding(o, u, sim, weak, source) {
  const ch = describeChange(o.text, u.text);
  if (ch.diff.identical) {
    return makeFinding({
      type: 'unchanged', original: o.text, updated: u.text, similarity: 1, confidence: 'high', source,
      reason: ch.diff.formattingOnly ? 'Only formatting, capitalisation or punctuation differs.' : 'Identical wording.',
    });
  }
  if (!ch.meaningful && !weak) {
    return makeFinding({
      type: 'unchanged', original: o.text, updated: u.text, similarity: sim, confidence: 'high', source,
      reason: 'Only minor connecting words differ (for example “the”, “of”, “to”). The meaning appears unchanged.',
    });
  }
  const parts = [`${weak ? 'Possible rewrite — low confidence. ' : ''}Wording changed (${pct(sim)} keyword overlap).`];
  if (ch.del.length) parts.push(`Removed: “${listWords(ch.del)}”.`);
  if (ch.add.length) parts.push(`Added: “${listWords(ch.add)}”.`);
  return applyWording(makeFinding({
    type: 'modified', original: o.text, updated: u.text, similarity: sim, confidence: weak ? 'low' : confidenceFor(sim),
    reason: parts.join(' '), flags: ch.flags, source, diff: ch.diff.chunks,
  }), u);
}

function compareManual(origText, updText) {
  const O = splitStatements(origText).slice(0, LIMITS.maxStatements).map(prep);
  const U = splitStatements(updText).slice(0, LIMITS.maxStatements).map(prep);
  const { pairs, unmatchedO, unmatchedU } = matchStatements(O, U);
  const findings = [];
  const order = [];

  for (const p of pairs) order.push({ at: p.j, f: pairFinding(O[p.i], U[p.j], p.sim, p.weak, null) });

  for (const i of unmatchedO) {
    order.push({
      at: i - 0.5,
      f: makeFinding({
        type: 'removed', original: O[i].text, updated: '', confidence: 'medium',
        reason: 'No corresponding statement was found in the updated text. It may have been removed, merged into another statement, or reworded beyond recognition.',
        closest: closestInfo(O[i], U),
      }),
    });
  }

  const pairedU = new Set(pairs.map((p) => p.j));
  for (const j of unmatchedU) {
    const u = U[j];
    let dup = null;
    U.forEach((x, k) => {
      if (k === j || (!pairedU.has(k) && k > j)) return;
      const s = dice(u.set, x.set);
      if (s >= 0.8 && (!dup || s > dup.sim)) dup = { sim: s, text: x.text };
    });
    O.forEach((x) => {
      const s = dice(u.set, x.set);
      if (s >= 0.8 && (!dup || s > dup.sim)) dup = { sim: s, text: x.text };
    });
    if (dup) {
      order.push({ at: j, f: makeFinding({ type: 'duplicate', original: dup.text, updated: u.text, similarity: dup.sim, confidence: confidenceFor(dup.sim), reason: `Closely matches another statement (${pct(dup.sim)} keyword overlap). It may repeat something already covered.` }) });
      continue;
    }
    const f = makeFinding({
      type: 'new', updated: u.text, confidence: 'medium',
      reason: 'No corresponding statement was found in the original scope.',
      closest: closestInfo(u, O), related: relatedExclusion(u, O),
    });
    order.push({ at: j, f: applyWording(f, u) });
  }

  order.sort((a, b) => a.at - b.at).forEach((x) => findings.push(x.f));
  return { findings, stats: { originalStatements: O.length, updatedStatements: U.length } };
}

function figureFlags(requestText, originalText) {
  const figs = [...new Set(requestText.match(/\d[\d,.]*%?/g) || [])].map((n) => n.replace(/[.,]$/, '')).filter((n) => n && !originalText.includes(n));
  return figs.length ? [`The request mentions figures that are not in the original statement: ${figs.join(', ')}.`] : [];
}

function bestByContainment(set, O, minContainment) {
  let best = null;
  for (let i = 0; i < O.length; i++) {
    if (O[i].exclusion) continue; // exclusions are context, not requirements to remove or change
    const n = shared(set, O[i].set);
    if (!n) continue;
    const c = n / set.size;
    // accept a strong share of the request's terms, or at least two shared terms with a smaller share
    if (c < minContainment && !(n >= 2 && c >= minContainment * 0.75)) continue;
    const d = dice(set, O[i].set);
    if (!best || n > best.n || (n === best.n && d > best.d)) best = { i, n, c, d };
  }
  return best;
}

function compareWithRequests(origText, requests) {
  const O = splitStatements(origText).slice(0, LIMITS.maxStatements).map(prep);
  const findings = [];
  const touched = new Set();
  const seen = []; // earlier request statements, for duplicate detection
  let requestStatements = 0;

  for (const req of requests) {
    const source = { requestId: req.id, label: req.label || '' };
    const stmts = splitStatements(req.text, { conversational: true }).map(prep);
    for (const r of stmts) {
      requestStatements += 1;
      const display = r.clean;
      const intentRemove = REMOVE_RE.test(r.text) && !/\b(don'?t|do not|never)\s+(remove|drop|delete)\b/i.test(r.text);
      const intentChange = !intentRemove && CHANGE_RE.test(r.text);
      const core = new Set([...r.set].filter((t) => !CUE_STEMS.has(t)));

      if (intentRemove) {
        const hit = core.size ? bestByContainment(core, O, 0.5) : null;
        if (hit) {
          touched.add(hit.i);
          findings.push(applyWording(makeFinding({
            type: 'removed', original: O[hit.i].text, updated: display, title: `Remove: ${O[hit.i].text}`, source,
            confidence: hit.c === 1 ? 'medium' : 'low', similarity: hit.d,
            reason: 'The request contains removal wording and mentions terms found in this original statement. The closest match is shown — please check it is the item meant.',
          }), r));
        } else {
          findings.push(makeFinding({
            type: 'ambiguous', updated: display, title: display, source, confidence: 'low',
            reason: 'The request suggests removing or dropping something, but no original statement clearly matches. Confirm what is being removed.',
          }));
        }
        continue;
      }

      if (intentChange) {
        const hit = core.size ? bestByContainment(core, O, 0.4) : null;
        if (hit) {
          touched.add(hit.i);
          const flags = figureFlags(r.text, O[hit.i].text);
          findings.push(applyWording(makeFinding({
            type: 'modified', original: O[hit.i].text, updated: display, title: display, source, similarity: hit.d,
            confidence: hit.c >= 0.7 ? 'medium' : 'low', flags,
            reason: 'The request uses change wording (for example “change”, “replace”, “increase”) and mentions terms from this original statement, so it may alter what was agreed.',
          }), r));
          continue;
        }
      }

      // Plain request: compare with the original, then with earlier requests.
      let bestO = null;
      O.forEach((o, i) => { if (o.exclusion) return; const s = dice(r.set, o.set); if (s > 0 && (!bestO || s > bestO.s)) bestO = { i, s }; });
      if (bestO && bestO.s >= 0.8) {
        touched.add(bestO.i);
        findings.push(makeFinding({
          type: 'duplicate', original: O[bestO.i].text, updated: display, title: display, source, similarity: bestO.s, confidence: confidenceFor(bestO.s),
          reason: `This request closely matches an existing requirement (${pct(bestO.s)} keyword overlap). It may already be covered by the original agreement.`,
        }));
      } else if (bestO && bestO.s >= 0.5) {
        touched.add(bestO.i);
        findings.push(applyWording(makeFinding({
          type: 'modified', original: O[bestO.i].text, updated: display, title: display, source, similarity: bestO.s, confidence: bestO.s >= 0.65 ? 'medium' : 'low',
          flags: figureFlags(r.text, O[bestO.i].text),
          reason: `This request overlaps with an existing requirement (${pct(bestO.s)} keyword overlap) and may adjust it. It could also simply be covered already.`,
        }), r));
      } else {
        let dupReq = null;
        for (const s of seen) { const sim = dice(r.set, s.set); if (sim >= 0.8 && (!dupReq || sim > dupReq.sim)) dupReq = { sim, text: s.text }; }
        if (dupReq) {
          findings.push(makeFinding({
            type: 'duplicate', original: dupReq.text, updated: display, title: display, source, similarity: dupReq.sim, confidence: confidenceFor(dupReq.sim),
            reason: `This repeats an earlier request (${pct(dupReq.sim)} keyword overlap).`,
          }));
        } else {
          findings.push(applyWording(makeFinding({
            type: 'new', updated: display, title: display, source, confidence: 'medium',
            reason: 'No statement in the original scope appears to cover this request.',
            closest: bestO && bestO.s >= 0.25 ? { text: O[bestO.i].text, similarity: bestO.s } : null,
            related: relatedExclusion(r, O),
          }), r));
        }
      }
      seen.push(r);
    }
  }

  O.forEach((o, i) => {
    if (touched.has(i)) return;
    findings.push(makeFinding({ type: 'unchanged', original: o.text, updated: o.text, similarity: 1, confidence: 'high', reason: 'No request appears to touch this statement.' }));
  });

  return { findings, stats: { originalStatements: O.length, updatedStatements: O.length, requestStatements } };
}

export function assembleUpdatedText(originalText, requests) {
  return [originalText.trim(), ...requests.map((r) => r.text.trim())].join('\n\n');
}

/**
 * Main entry point.
 *  mode 'requests': original scope + selected client requests (each request has {id,text,label}).
 *  mode 'manual'  : original scope vs a full updated scope pasted by the user.
 */
export function compareScope({ originalText, mode, requests = [], manualText = '' }) {
  counter = 0;
  const updatedText = mode === 'manual' ? manualText : assembleUpdatedText(originalText, requests);
  const result = mode === 'manual' ? compareManual(originalText, manualText) : compareWithRequests(originalText, requests);
  const rank = Object.fromEntries(FINDING_TYPES.map((t, i) => [t, i]));
  const findings = result.findings
    .map((f, idx) => ({ f, idx }))
    .sort((a, b) => rank[a.f.type] - rank[b.f.type] || a.idx - b.idx)
    .map((x) => x.f);
  return { findings, stats: result.stats, updatedText };
}

/** Counts shown in the summary. Always derived from the findings, never hardcoded. */
export function summarizeFindings(findings) {
  const s = { additions: 0, removals: 0, modified: 0, duplicates: 0, ambiguous: 0, unchanged: 0, clarify: 0, reviewed: 0, pending: 0, flagged: 0 };
  for (const f of findings) {
    if (f.type === 'new') s.additions++;
    else if (f.type === 'removed') s.removals++;
    else if (f.type === 'modified') s.modified++;
    else if (f.type === 'duplicate') s.duplicates++;
    else if (f.type === 'ambiguous') s.ambiguous++;
    else s.unchanged++;
    if (f.type === 'unchanged') continue;
    s.flagged++;
    if (f.status === 'pending') s.pending++; else s.reviewed++;
    if (f.status === 'clarify' || (f.type === 'ambiguous' && f.status === 'pending')) s.clarify++;
  }
  return s;
}
