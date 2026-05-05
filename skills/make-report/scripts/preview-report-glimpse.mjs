#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { prompt } from 'glimpseui';

const USAGE = `Usage: node skills/make-report/scripts/preview-report-glimpse.mjs [report.html]

Opens a local make-report HTML report in a Glimpse WebView and prints JSON:
  {"action":"approve"|"upload"|"recapture"|"closed","reportPath":"..."}
`;

function findLatestReport(cwd) {
  const workDir = path.join(cwd, '.context', 'work');
  if (!fs.existsSync(workDir)) return null;

  const reports = [];
  for (const workspace of fs.readdirSync(workDir)) {
    const capturesDir = path.join(workDir, workspace, 'captures');
    if (!fs.existsSync(capturesDir)) continue;
    for (const file of fs.readdirSync(capturesDir)) {
      if (!file.endsWith('.html')) continue;
      const reportPath = path.join(capturesDir, file);
      const stat = fs.statSync(reportPath);
      reports.push({ reportPath, mtimeMs: stat.mtimeMs });
    }
  }

  reports.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return reports[0]?.reportPath ?? null;
}

function mimeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.svg') return 'image/svg+xml';
  return 'application/octet-stream';
}

function inlineLocalImageSrc(html, reportDir) {
  return html.replace(/(<img\b[^>]*\bsrc=["'])([^"']+)(["'][^>]*>)/gi, (match, prefix, src, suffix) => {
    if (/^(https?:|data:|blob:|file:)/i.test(src)) return match;
    const assetPath = path.resolve(reportDir, src);
    const relative = path.relative(reportDir, assetPath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) return match;
    if (!fs.existsSync(assetPath)) return match;
    const b64 = fs.readFileSync(assetPath).toString('base64');
    return `${prefix}data:${mimeFor(assetPath)};base64,${b64}${suffix}`;
  });
}

function escapeAttr(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function buildPreviewHtml(reportHtml, reportPath) {
  const reportDataUri = `data:text/html;base64,${Buffer.from(reportHtml, 'utf8').toString('base64')}`;
  const reportName = path.basename(reportPath);
  const fileUrl = pathToFileURL(reportPath).href;

  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Make Report Preview</title>
<style>
  :root { color-scheme: light dark; --bar: rgba(20,20,24,.92); --text: #f5f5f5; --muted: #b8b8b8; --accent: #6ee7b7; }
  * { box-sizing: border-box; }
  html, body { width: 100%; height: 100%; margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
  body { display: grid; grid-template-rows: auto 1fr; background: #111; }
  .bar { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 10px 14px; background: var(--bar); color: var(--text); border-bottom: 1px solid rgba(255,255,255,.12); }
  .title { min-width: 0; }
  .title strong { display: block; font-size: 14px; line-height: 1.2; }
  .title span { display: block; font-size: 11px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 62vw; }
  .actions { display: flex; gap: 8px; align-items: center; flex-shrink: 0; }
  button, a.button { border: 1px solid rgba(255,255,255,.18); border-radius: 8px; padding: 7px 10px; background: rgba(255,255,255,.08); color: var(--text); font-size: 12px; text-decoration: none; cursor: pointer; }
  button:hover, a.button:hover { background: rgba(255,255,255,.15); }
  button.primary { background: #16a34a; border-color: #16a34a; color: white; }
  button.warn { background: #92400e; border-color: #92400e; color: white; }
  iframe { width: 100%; height: 100%; border: 0; background: white; }
</style>
</head>
<body>
  <div class="bar">
    <div class="title">
      <strong>Make Report Preview — ${escapeAttr(reportName)}</strong>
      <span>${escapeAttr(reportPath)}</span>
    </div>
    <div class="actions">
      <a class="button" href="${escapeAttr(fileUrl)}" target="_blank" rel="noreferrer">Open in Browser</a>
      <button class="warn" onclick="glimpse.send({ action: 'recapture' })">Recapture</button>
      <button onclick="glimpse.send({ action: 'approve' })">Looks good</button>
      <button class="primary" onclick="glimpse.send({ action: 'upload' })">Upload now</button>
      <button onclick="glimpse.send({ action: 'closed' })">Close</button>
    </div>
  </div>
  <iframe src="${reportDataUri}" title="Verify report"></iframe>
</body>
</html>`;
}

const arg = process.argv[2];
if (arg === '--help' || arg === '-h') {
  console.log(USAGE);
  process.exit(0);
}

const reportPath = path.resolve(arg || findLatestReport(process.cwd()) || '');
if (!reportPath || !fs.existsSync(reportPath)) {
  console.error(JSON.stringify({ action: 'error', error: 'report_not_found', message: 'No report.html found', cwd: process.cwd() }));
  process.exit(1);
}

const reportDir = path.dirname(reportPath);
const reportHtml = inlineLocalImageSrc(fs.readFileSync(reportPath, 'utf8'), reportDir);
const previewHtml = buildPreviewHtml(reportHtml, reportPath);

const result = await prompt(previewHtml, {
  width: 1280,
  height: 900,
  title: 'Make Report Preview',
  openLinks: true,
});

console.log(JSON.stringify({ action: result?.action ?? 'closed', reportPath }));
