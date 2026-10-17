// report.js — builds the client-ready report (HTML + JSON) and the suggested client message.
// Pure functions: given a project and a comparison they return strings. No network.

import { esc, fmtDate, fmtDateTime, formatMoney, truncate, plural } from './utils.js';
import { TYPE_LABELS, STATUS_LABELS, summarizeFindings, splitStatements } from './comparison.js';

export const REPORT_CSS = `
.sl-report{--r-text:#1c1c1e;--r-muted:#66666d;--r-line:#dcdce0;--r-soft:#f6f6f7;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;color:var(--r-text);line-height:1.55;font-size:15px;max-width:780px;margin:0 auto}
.sl-report *{box-sizing:border-box}
.sl-report h1{font-size:1.65rem;line-height:1.2;margin:.2rem 0 .3rem;letter-spacing:-.01em}
.sl-report h2{font-size:1.1rem;margin:2rem 0 .6rem;padding-bottom:.4rem;border-bottom:1px solid var(--r-line)}
.sl-report h3{font-size:1rem;margin:0 0 .5rem}
.sl-report p{margin:.4rem 0}
.sl-report .r-brand{display:flex;align-items:center;gap:.6rem;font-weight:650;letter-spacing:.01em}
.sl-report .r-brand svg{width:28px;height:28px}
.sl-report .r-tag{color:var(--r-muted);font-size:.85rem;margin:0 0 1.2rem}
.sl-report .r-meta{display:grid;grid-template-columns:max-content 1fr;gap:.25rem 1rem;margin:1rem 0;padding:.9rem 1rem;background:var(--r-soft);border:1px solid var(--r-line);border-radius:10px}
.sl-report .r-meta dt{color:var(--r-muted)}
.sl-report .r-meta dd{margin:0;overflow-wrap:anywhere}
.sl-report .r-counts{display:flex;flex-wrap:wrap;gap:.5rem;margin:.8rem 0;padding:0;list-style:none}
.sl-report .r-counts li{border:1px solid var(--r-line);border-radius:8px;padding:.45rem .75rem;font-size:.9rem}
.sl-report .r-counts strong{font-size:1.15rem;margin-right:.3rem}
.sl-report .r-note{color:var(--r-muted);font-size:.9rem}
.sl-report .r-disclaimer{border:1px solid var(--r-line);border-left:4px solid var(--r-text);background:var(--r-soft);padding:.75rem 1rem;border-radius:6px;font-size:.9rem;margin:1.2rem 0}
.sl-report .r-finding{border:1px solid var(--r-line);border-radius:10px;padding:.9rem 1rem;margin:.8rem 0;break-inside:avoid}
.sl-report .r-finding dl{display:grid;grid-template-columns:max-content 1fr;gap:.3rem 1rem;margin:.4rem 0 0}
.sl-report .r-finding dt{color:var(--r-muted);font-size:.85rem;padding-top:.1rem}
.sl-report .r-finding dd{margin:0;overflow-wrap:anywhere}
.sl-report .r-decision{display:inline-block;border:1px solid var(--r-text);border-radius:999px;padding:0 .6rem;font-size:.82rem}
.sl-report .r-decision.pending{border-color:var(--r-line);color:var(--r-muted)}
.sl-report .r-decision.clarify{border-style:dashed}
.sl-report .r-decision.irrelevant{border-color:var(--r-line);color:var(--r-muted)}
.sl-report .r-label{font-size:.72rem;text-transform:uppercase;letter-spacing:.06em;color:var(--r-muted);margin-top:.6rem}
.sl-report ul.r-list{margin:.3rem 0 0;padding-left:1.2rem}
.sl-report .r-message{white-space:pre-wrap;background:var(--r-soft);border:1px solid var(--r-line);border-radius:10px;padding:.9rem 1rem}
.sl-report .r-foot{margin-top:2rem;padding-top:.8rem;border-top:1px solid var(--r-line);color:var(--r-muted);font-size:.82rem}
@media (max-width:560px){.sl-report .r-meta,.sl-report .r-finding dl{grid-template-columns:1fr;gap:0}.sl-report .r-finding dt{margin-top:.5rem}}
@media print{.sl-report{font-size:11.5pt;max-width:none}.sl-report h2{break-after:avoid}}
`;

const LOGO_SVG = '<svg viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="8" fill="#1c1c1e"/><circle cx="15" cy="15" r="7" fill="none" stroke="#fff" stroke-width="2.4"/><path d="M20.2 20.2l5 5" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/><path d="M11.5 15h7" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg>';

export const DISCLAIMER = 'This report helps you check what was agreed against what is now being asked. It was made by simple word matching and by notes the user wrote. It is not legal advice. It does not say that any request is outside the agreement, or that any extra payment is owed. Items that say “may” need a person to decide.';

/* -------------------------- client message -------------------------- */

function plainList(items, max) {
  return items.slice(0, max).map((f, i) => `${i + 1}. ${truncate(f.updated || f.original, 140)}`).join('\n');
}

/** Neutral, editable message built from the real findings. Local template, no AI. */
export function buildClientMessage(project, comparison) {
  const first = (project.client || '').trim().split(/\s+/)[0];
  const greeting = first ? `Hi ${first},` : 'Hi,';
  const base = project.baseline && comparison.baseline
    ? `what we first agreed${comparison.baseline.date ? ` (${fmtDate(comparison.baseline.date)})` : ''}`
    : 'what we first agreed';
  const items = comparison.findings.filter((f) => f.type !== 'unchanged' && f.status !== 'irrelevant');
  const what = comparison.mode === 'manual' ? 'the new version' : 'your latest requests';

  if (!items.length) {
    return `${greeting}\n\nI've looked at ${what} for ${project.name} and compared them with ${base}. I didn't find anything that seems to go beyond what we agreed, so I'll carry on with the agreed work. If you'd like to change or add anything, just let me know and we can talk it through.\n\nThanks.`;
  }
  const max = 8;
  const list = plainList(items, max);
  const more = items.length > max ? `\n…and ${items.length - max} more (details are in the report).` : '';
  return `${greeting}\n\nI've looked at ${what} for ${project.name} and compared them with ${base}. A few items seem to add something new, change what we agreed, or need a bit more detail:\n\n${list}${more}\n\nCould we go through these together and confirm what you need, the timeline, and any change to the agreed cost before I start? If I've misunderstood anything, or something is already included in what we agreed, please tell me.\n\nThanks.`;
}

export const effectiveMessage = (project, comparison) =>
  comparison.messageEdited ? comparison.message : buildClientMessage(project, comparison);

/* ------------------------------ report ------------------------------ */

function findingBlock(f, mode) {
  const rows = [];
  if (f.updated) rows.push([mode === 'manual' ? 'New version' : 'What the client asked for', f.updated]);
  if (f.original) rows.push(['Original agreement', f.original]);
  if (f.source && f.source.label) rows.push(['Where it came from', f.source.label]);
  rows.push(['Why it was flagged', f.reason + (f.flags && f.flags.length ? ' ' + f.flags.join(' ') : '')]);
  if (f.related) rows.push(['The agreement may say this is not included', f.related.text]);
  const statusHtml = `<span class="r-decision ${esc(f.status)}">${esc(STATUS_LABELS[f.status])}</span>`;
  const noteHtml = f.note ? esc(f.note).replace(/\n/g, '<br>') : '<span class="r-note">No note.</span>';
  return `<div class="r-finding"><h3>${esc(f.title)}</h3><dl>${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}<dt>Your decision</dt><dd>${statusHtml}</dd><dt>Your note</dt><dd>${noteHtml}</dd></dl></div>`;
}

function section(title, intro, findings, mode) {
  if (!findings.length) return '';
  return `<h2>${esc(title)} (${findings.length})</h2>${intro ? `<p class="r-note">${esc(intro)}</p>` : ''}${findings.map((f) => findingBlock(f, mode)).join('')}`;
}

export function buildReportBody(project, comparison, { generatedAt = new Date().toISOString() } = {}) {
  const s = summarizeFindings(comparison.findings);
  const live = comparison.findings.filter((f) => f.type !== 'unchanged');
  const dismissed = live.filter((f) => f.status === 'irrelevant');
  const clarify = live.filter((f) => f.status !== 'irrelevant' && (f.status === 'clarify' || f.type === 'ambiguous'));
  const rest = live.filter((f) => f.status !== 'irrelevant' && !clarify.includes(f));
  const pick = (t) => rest.filter((f) => f.type === t);
  const decided = live.filter((f) => f.status === 'relevant');

  const excerpt = splitStatements(comparison.originalText).slice(0, 6);
  const totalStatements = splitStatements(comparison.originalText).length;
  const budget = project.budget !== '' && project.budget != null ? formatMoney(project.budget, project.currency) : '';

  const meta = [
    ['Project', project.name],
    project.client ? ['Client', project.client] : null,
    comparison.baseline.date ? ['Date agreed', fmtDate(comparison.baseline.date)] : null,
    ['Original agreement', `${comparison.baseline.title}${comparison.baseline.revision > 1 ? ` (version ${comparison.baseline.revision})` : ''}`],
    budget ? ['Agreed price (as entered)', budget] : null,
    ['Compared on', fmtDateTime(comparison.createdAt)],
    ['Compared with', comparison.mode === 'manual' ? 'A new version of the agreement' : plural(comparison.requests.length, 'client request')],
  ].filter(Boolean);

  const reqList = comparison.requests.length
    ? `<h2>Client requests checked</h2><p class="r-note">“Received” is the date the user typed in. “Saved” is when it was added to ScopeLens. Neither date was checked with the email or chat app.</p><ul class="r-list">${comparison.requests.map((r) =>
      `<li><strong>Received ${esc(fmtDate(r.date) || 'date not given')}</strong>${r.source ? ` by ${esc(r.source)}` : ''}${r.reference ? ` (${esc(r.reference)})` : ''}; saved ${esc(fmtDateTime(r.enteredAt))}<br>${esc(truncate(r.text, 220))}</li>`).join('')}</ul>`
    : '';

  const decisionsHtml = decided.length
    ? `<h2>What you confirmed (${decided.length})</h2><p class="r-note">These are the items marked “Real change”. Everything else below is only what ScopeLens noticed, and has not been confirmed.</p><ul class="r-list">${decided.map((f) => `<li><strong>${esc(f.title)}</strong>${f.note ? `: ${esc(f.note)}` : ''}</li>`).join('')}</ul>`
    : `<h2>What you confirmed</h2><p class="r-note">Nothing has been marked “Real change” yet. Everything below is only what ScopeLens noticed.</p>`;

  const dismissedHtml = dismissed.length
    ? `<h2>Marked “Not a change” (${dismissed.length})</h2><p class="r-note">These were looked at and set aside.</p><ul class="r-list">${dismissed.map((f) => `<li>${esc(f.title)}${f.note ? `: ${esc(f.note)}` : ''}</li>`).join('')}</ul>`
    : '';

  const empty = !live.length
    ? '<p>No changes were found. This does not prove that nothing changed. ScopeLens only matches words, so it can miss a request that uses different words.</p>'
    : '';

  const m = comparison.mode;
  return `<article class="sl-report" aria-label="Change report for ${esc(project.name)}">
<div class="r-brand">${LOGO_SVG}<span>ScopeLens</span></div>
<p class="r-tag">Catch the changes nobody noticed.</p>
<h1>Project change report</h1>
<dl class="r-meta">${meta.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
<div class="r-disclaimer"><strong>Please note.</strong> ${esc(DISCLAIMER)}</div>
<h2>What may have changed</h2>
<ul class="r-counts">
<li><strong>${s.additions}</strong>may be new work</li>
<li><strong>${s.modified}</strong>may change agreed work</li>
<li><strong>${s.removals}</strong>may be removed</li>
<li><strong>${s.clarify}</strong>need clarification</li>
</ul>
<p class="r-note">${s.reviewed} of ${s.flagged} results reviewed${s.duplicates ? `; ${s.duplicates} possibly already included` : ''}${s.unchanged ? `; ${plural(s.unchanged, 'point')} with no change` : ''}.</p>
${empty}
<h2>The original agreement</h2>
<p class="r-note">“${esc(comparison.baseline.title)}” has ${plural(totalStatements, 'point')}. The first ones:</p>
<ul class="r-list">${excerpt.map((x) => `<li>${esc(truncate(x.text, 200))}</li>`).join('')}${totalStatements > excerpt.length ? `<li class="r-note">…and ${totalStatements - excerpt.length} more.</li>` : ''}</ul>
${reqList}
${decisionsHtml}
${section('May be new work', 'Nothing in the original agreement seems to cover these. They may still be included.', pick('new'), m)}
${section('May change agreed work', 'These seem to change, or are similar to, something already agreed.', pick('modified'), m)}
${section('May be removed', 'These parts of the agreement seem to have been dropped or replaced.', pick('removed'), m)}
${section('Possibly already included', 'These seem to repeat something that is already covered.', pick('duplicate'), m)}
${section('Needs clarification', 'These were marked “Ask the client”, or the wording is too vague to tell what is meant.', clarify, m)}
${dismissedHtml}
<h2>Message to the client</h2>
<div class="r-message">${esc(effectiveMessage(project, comparison))}</div>
<p class="r-foot">Made with ScopeLens on ${esc(fmtDateTime(generatedAt))}. Based on text the user pasted or typed. Dates are the ones the user entered and were not checked with any email or chat app. Saved only in the user's browser.</p>
</article>`;
}

export function buildReportDocument(project, comparison) {
  const title = `ScopeLens report — ${project.name}`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light"><title>${esc(title)}</title>
<style>body{margin:0;padding:24px 16px;background:#fff}@page{margin:16mm}${REPORT_CSS}</style></head>
<body>${buildReportBody(project, comparison)}</body></html>`;
}

export function buildReportJSON(project, comparison) {
  const s = summarizeFindings(comparison.findings);
  return {
    app: 'ScopeLens',
    kind: 'change-report',
    generatedAt: new Date().toISOString(),
    disclaimer: DISCLAIMER,
    project: {
      name: project.name, client: project.client, description: project.description,
      startDate: project.startDate, budget: project.budget, currency: project.currency,
    },
    originalScope: { title: comparison.baseline.title, date: comparison.baseline.date, revision: comparison.baseline.revision },
    comparison: {
      id: comparison.id, createdAt: comparison.createdAt, mode: comparison.mode,
      summary: s,
      requests: comparison.requests.map((r) => ({
        receivedDate: r.date, source: r.source, reference: r.reference, enteredIntoScopeLens: r.enteredAt, text: r.text,
      })),
      findings: comparison.findings.map((f) => ({
        type: f.type, typeLabel: TYPE_LABELS[f.type], title: f.title, original: f.original, updated: f.updated,
        detectedBecause: f.reason, flags: f.flags, confidence: f.confidence,
        reviewerDecision: f.status, reviewerDecisionLabel: STATUS_LABELS[f.status], reviewerNote: f.note,
      })),
    },
    suggestedMessage: effectiveMessage(project, comparison),
  };
}
