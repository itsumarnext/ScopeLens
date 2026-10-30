// ai.js — checks a client request against an agreement.
//
// IMPORTANT: this is NOT a live AI model. It runs entirely in the browser using the same word-matching
// rules as the original WorkSphare comparison (comparison.js). It cannot read meaning the way a person
// can, so every result is a prompt for the freelancer's own judgement. It is not legal advice.

import { compareScope, contentTokens, LIMITS } from './comparison.js';
import { truncate } from './utils.js';

export const ENGINE_ID = 'local-rules-v1';
export const ENGINE_NOTE = 'This check runs in your browser using word-matching rules. It is not a live AI model and it is not legal advice. Use it as a prompt for your own judgement.';

const lines = (text) => String(text || '').split(/\n+/).map((l) => l.replace(/^[\s\-*•\d.)]+/, '').trim()).filter(Boolean);

/** Joins the agreement's parts into one text the comparison rules can read. */
export function composeAgreementText({ scope = '', deliverables = '', exclusions = '', revisions = '', conditions = '', constraints = '' }) {
  const parts = [String(scope || '').trim()];
  const d = lines(deliverables);
  if (d.length) parts.push(`Deliverables:\n${d.map((x) => `- ${x}`).join('\n')}`);
  const e = lines(exclusions);
  if (e.length) parts.push(`Exclusions:\n${e.map((x) => `- Not included: ${x}`).join('\n')}`);
  if (String(revisions || '').trim()) parts.push(`Revisions: ${String(revisions).trim()}`);
  const c = lines(conditions);
  if (c.length) parts.push(`Conditions:\n${c.map((x) => `- ${x}`).join('\n')}`);
  const k = lines(constraints);
  if (k.length) parts.push(`Extra rules entered for this check:\n${k.map((x) => `- ${x}`).join('\n')}`);
  return parts.filter(Boolean).join('\n\n');
}

const REVISION_RE = /\b(revisions?|revise|revised|rework|redo|another round|one more (?:round|pass)|changes? to (?:the )?(?:design|layout|logo|copy|text))\b/i;

const item = (f, extra = {}) => ({
  request: f.updated || f.title,
  agreement: f.original || f.closest?.text || '',
  exclusion: f.related?.text || '',
  reason: f.reason,
  flags: f.flags || [],
  confidence: f.confidence || 'low',
  ...extra,
});

/**
 * Compares one client request with an agreement.
 * Returns { ok:false, error } or { ok:true, result } where result sorts every part of the request into:
 *   covered   — looks close to something already agreed
 *   possible  — related to agreed work, but may change it (or may already be included)
 *   outside   — nothing in the agreement seems to cover it
 *   unclear   — too vague to tell
 */
export function analyzeRequest({ agreement, requestText, constraints = '' }) {
  const request = String(requestText || '').replace(/\r\n?/g, '\n').trim();
  const text = composeAgreementText({ ...agreement, constraints });
  if (!text.trim()) return { ok: false, error: 'There is no agreement text to check against. Paste it, or add the text to the agreement first.', field: 'agreement' };
  if (!request) return { ok: false, error: 'Paste or type what the client asked for.', field: 'requestText' };
  if (request.length > LIMITS.maxChars) return { ok: false, error: `That request is too long. The limit is ${LIMITS.maxChars.toLocaleString()} letters.`, field: 'requestText' };
  if (text.length > LIMITS.maxChars) return { ok: false, error: `The agreement text is too long to check (limit ${LIMITS.maxChars.toLocaleString()} letters).`, field: 'agreement' };

  const cmp = compareScope({ originalText: text, mode: 'requests', requests: [{ id: 'request', text: request, label: '' }] });
  const result = { summary: '', covered: [], possible: [], outside: [], unclear: [], notes: [], nextSteps: [] };
  for (const f of cmp.findings) {
    if (f.type === 'unchanged') continue;
    if (f.type === 'duplicate') result.covered.push(item(f));
    else if (f.type === 'modified') result.possible.push(item(f));
    else if (f.type === 'removed') result.possible.push(item(f, { reason: `${f.reason} This could reduce the agreed work.` }));
    else if (f.type === 'ambiguous') result.unclear.push(item(f));
    else {
      result.outside.push(item(f, f.related ? { reason: 'Nothing in the agreement seems to cover this, and the agreement lists something similar as not included.' } : {}));
    }
  }

  // The engine links an exclusion only when two words match. For a short exclusion such as "hosting" one shared
  // word is enough, so check the exclusion lines (and any "not included" rule typed for this check) again here.
  const GENERIC = new Set(['includ', 'exclud', 'scope', 'cover', 'part', 'outsid', 'item', 'work', 'extra', 'addit', 'agreement']);
  const exLines = [
    ...lines(agreement.exclusions),
    ...lines(constraints).filter((l) => /\b(not include|not included|exclude|excluded|out of scope|not covered|outside)\b/i.test(l)),
  ];
  for (const o of result.outside) {
    if (o.exclusion) continue;
    const req = new Set(contentTokens(o.request));
    const hit = exLines.find((l) => contentTokens(l).some((t) => !GENERIC.has(t) && req.has(t)));
    if (hit) { o.exclusion = hit; o.reason = 'Nothing in the agreement seems to cover this, and the agreement lists something similar as not included.'; }
  }

  // Revision limits: point at the agreement's own words, never decide for the person.
  const revLine = lines(text).find((l) => /\brevisions?\b/i.test(l)) || '';
  if (REVISION_RE.test(request) && revLine) {
    result.notes.push(`This request may count as a revision. The agreement says: “${truncate(revLine, 220)}” Check how many revisions have already been used.`);
  } else if (REVISION_RE.test(request)) {
    result.notes.push('This request may count as a revision, but the agreement does not seem to say how many revisions are included. Consider asking the client to agree on this.');
  }

  const n = (a) => a.length;
  const parts = [];
  if (n(result.covered)) parts.push(`${n(result.covered)} ${n(result.covered) === 1 ? 'part appears' : 'parts appear'} to be covered`);
  if (n(result.possible)) parts.push(`${n(result.possible)} may change agreed work`);
  if (n(result.outside)) parts.push(`${n(result.outside)} may be outside the agreed scope`);
  if (n(result.unclear)) parts.push(`${n(result.unclear)} ${n(result.unclear) === 1 ? 'is' : 'are'} unclear`);
  result.summary = parts.length ? `${parts.join(', ')}.` : 'No clear request was found in this text. Try pasting the client’s exact words.';

  if (n(result.covered)) result.nextSteps.push('Read the agreement wording shown next to each covered part. If you agree it is included, you can go ahead with those parts.');
  if (n(result.possible)) result.nextSteps.push('Ask the client whether they want to change something already agreed. Agree the details in writing before changing the work.');
  if (n(result.outside)) result.nextSteps.push('Check the agreement yourself. If the work really is new, offer a short discussion about scope, timeline and any change in price.');
  if (n(result.unclear)) result.nextSteps.push('Ask the client to say exactly what they mean before you decide anything.');
  if (n(result.outside) || n(result.possible)) result.nextSteps.push('Record the request in the Scope Change Tracker so it is not forgotten. Do not change the price or the agreement until both sides agree.');
  if (!result.nextSteps.length) result.nextSteps.push('Add the client’s exact message and check again.');
  return { ok: true, result };
}

const bullets = (list) => list.map((i) => `- ${truncate(i.request, 150)}`).join('\n');

/** A polite, collaborative reply the freelancer can edit and send themselves. */
export function buildResponseDraft({ business, clientName, agreementTitle, result }) {
  const first = (clientName || 'there').split(/\s+/)[0];
  const out = [`Hi ${first},`, '', `Thank you for sending this over. I compared your request with what we agreed${agreementTitle ? ` in “${agreementTitle}”` : ''}.`, ''];
  const open = [...result.possible, ...result.outside];
  if (result.covered.length) {
    out.push('These parts look like they are already included, so I am happy to go ahead:', bullets(result.covered), '');
  }
  if (open.length) {
    out.push('These parts may not be covered by our current agreement, so I would like to talk them through with you first:', bullets(open), '');
  }
  if (result.unclear.length) {
    out.push('I want to be sure I understand these correctly. Could you tell me a little more about what you have in mind?', bullets(result.unclear), '');
  }
  if (open.length) {
    out.push('If you would like to include the extra items, we can agree on the scope, the timeline and any change in cost before I start. I am happy to put the options in writing. Would a quick call or a message thread work best for you?');
  } else if (result.unclear.length) {
    out.push('Once I have a little more detail, I can confirm how we should proceed.');
  } else if (result.covered.length) {
    out.push('Let me know if I have misunderstood anything.');
  } else {
    out.push('Could you share the request again in a little more detail? Then I can check it against our agreement.');
  }
  out.push('', 'Best regards,', business || '');
  return out.join('\n').trim();
}
