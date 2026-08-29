import { randomUUID } from "node:crypto";
import { createServer, type Server, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { openCompanionUrl } from "../utils/companion-window.ts";
import type { GlimpseWindow } from "../utils/glimpse.ts";
import { buildMetaReviewClientState } from "./view-model.ts";
import {
	createPrReviewQuestion,
	dispatchPrReviewQuestionToSession,
	failPrReviewQuestion,
	resolvePrReviewQuestionContext,
	type PrReviewQuestion,
} from "./chat.ts";
import {
	loadPrReviewRun,
	saveHumanDecision,
	type HumanReviewDecision,
	type PrReviewRunState,
} from "./run.ts";

interface StudioHandle {
	runId: string;
	runDir: string;
	token: string;
	server: Server;
	url: string;
	closed: boolean;
	window?: GlimpseWindow;
	onQuestion?: (question: PrReviewQuestion) => void;
}

const handles = new Map<string, StudioHandle>();
const DECISIONS = new Set<HumanReviewDecision>(["review-only", "review-with-meta", "edit", "follow-up", "hold", "dismiss"]);

function escapeHtml(value: string): string {
	return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
	const body = JSON.stringify(value);
	response.writeHead(status, {
		"Content-Type": "application/json; charset=utf-8",
		"Content-Length": Buffer.byteLength(body),
		"Cache-Control": "no-store",
	});
	response.end(body);
}

function sendHtml(response: ServerResponse, html: string): void {
	response.writeHead(200, {
		"Content-Type": "text/html; charset=utf-8",
		"Content-Length": Buffer.byteLength(html),
		"Cache-Control": "no-store",
	});
	response.end(html);
}

async function readBody(request: import("node:http").IncomingMessage, limit = 64 * 1024): Promise<Record<string, unknown>> {
	let body = "";
	for await (const chunk of request) {
		body += chunk;
		if (Buffer.byteLength(body) > limit) throw new Error("request body too large");
	}
	return body ? JSON.parse(body) as Record<string, unknown> : {};
}


export function buildPrReviewStudioHtml(title: string): string {
	return String.raw`<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
:root{color-scheme:light;--paper:#f8f7f4;--paper-raised:#fff;--ink:#181b1f;--ink-secondary:#515860;--ink-tertiary:#858b91;--rule:#dcdad4;--rule-strong:#b9b6ae;--code:#f4f4f2;--code-line:#e6e4df;--accent:#b63b2f;--accent-soft:#f7e9e5;--confirm:#6d5710;--confirm-soft:#f6f0d9;--success:#1e6847;--success-soft:#e7f3ed;--shadow:0 18px 52px rgba(29,27,23,.07)}
*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--paper);color:var(--ink);font:14px/1.62 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.shell{max-width:1580px;margin:0 auto;padding:56px 48px 80px}.report-header{padding-bottom:42px;border-bottom:1px solid var(--rule-strong)}.report-kicker,.section-label{margin:0 0 13px;color:var(--accent);font:650 10px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.15em;text-transform:uppercase}.report-header h1{max-width:1080px;margin:0;font-size:38px;line-height:1.18;letter-spacing:-.045em;font-weight:670}.report-meta{display:flex;gap:9px;flex-wrap:wrap;margin-top:18px;color:var(--ink-tertiary);font:11px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}.report-meta a{color:inherit}.report-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:1px;margin:32px 0 0;background:var(--rule);border:1px solid var(--rule)}.report-stat{margin:0;padding:16px 18px;background:var(--paper-raised)}.report-stat dt{color:var(--ink-tertiary);font:10px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;text-transform:uppercase}.report-stat dd{margin:4px 0 0;font-size:21px;font-weight:640}.report-section{padding:42px 0;border-bottom:1px solid var(--rule-strong)}.overview{display:grid;grid-template-columns:minmax(220px,.55fr) minmax(0,1.45fr);gap:52px}.overview h2,.attention h2,.verification h2{margin:0;font-size:24px;letter-spacing:-.035em}.summary{margin:0;color:var(--ink-secondary);font-size:17px;line-height:1.7}.reading-order{display:flex;flex-wrap:wrap;gap:7px;margin-top:18px}.reading-order span{padding:5px 9px;border:1px solid var(--rule);background:var(--paper-raised);color:var(--ink-tertiary);font:10px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace}.review-layout{display:grid;grid-template-columns:minmax(0,1fr) 410px;gap:44px;align-items:start}.review-content{min-width:0}.attention{padding-top:42px}.attention-list{display:grid;gap:1px;margin-top:20px;background:var(--rule);border:1px solid var(--rule)}.attention-item{display:grid;grid-template-columns:90px minmax(0,1fr) auto;gap:16px;align-items:start;padding:16px 18px;background:var(--paper-raised);text-decoration:none;color:var(--ink)}.attention-item:hover{background:#fbfaf7}.attention-kind{color:var(--accent);font:650 10px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;text-transform:uppercase}.attention-title{font-weight:620}.attention-path{color:var(--ink-tertiary);font:10px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}.review-section{border-top:1px solid var(--rule-strong);scroll-margin-top:20px}.review-section:last-of-type{border-bottom:1px solid var(--rule-strong)}.review-section>summary{display:grid;grid-template-columns:44px minmax(220px,.85fr) minmax(260px,1.1fr) auto auto;gap:16px;align-items:center;padding:19px 0;cursor:pointer;list-style:none}.review-section>summary::-webkit-details-marker{display:none}.review-section>summary::after{content:"+";color:var(--ink-tertiary);font:18px/1 ui-monospace,monospace}.review-section[open]>summary::after{content:"−";color:var(--ink)}.section-number{color:var(--accent);font:650 11px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace}.section-heading{font-size:18px;font-weight:630;letter-spacing:-.02em;overflow-wrap:anywhere}.section-summary{color:var(--ink-secondary);font-size:13px}.section-count{color:var(--ink-tertiary);font:10px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:nowrap}.section-body{padding:0 0 52px 44px}.file{border:1px solid var(--rule);background:var(--paper-raised)}.file-header{display:grid;grid-template-columns:minmax(260px,1fr) auto;gap:22px;align-items:start;padding:13px 16px;border-bottom:1px solid var(--rule);background:var(--paper)}.file-header h3{display:grid;gap:2px;margin:0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}.file-name{font-size:12.5px;font-weight:650;overflow-wrap:anywhere}.file-path{color:var(--ink-tertiary);font-size:10.5px}.file-header p{margin:0;color:var(--ink-tertiary);font:10px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}.diff{overflow-x:auto;background:var(--code)}.line{display:grid;grid-template-columns:58px 58px minmax(720px,1fr);min-height:23px;border-top:1px solid color-mix(in srgb,var(--code-line) 36%,transparent);font:11.5px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace}.line:first-child{border-top:0}.line-no{padding:2px 8px;text-align:right;color:#aaa7a0;user-select:none;border-right:1px solid var(--code-line)}.line-code{padding:2px 12px;white-space:pre}.line.line-kind-addition{background:#edf6ef}.line.line-kind-deletion{background:#fbeeee}.line.line-kind-hunk-header,.line.line-kind-file-header,.line.line-kind-old-file,.line.line-kind-new-file{background:#eeece6;color:#706d65}.line.line-kind-hunk-header .line-code{color:#625595}.inline-fold{border-top:1px solid var(--code-line);background:#efeee9}.inline-fold>summary{padding:8px 14px;cursor:pointer;color:var(--ink-tertiary);font:10.5px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;list-style:none}.inline-fold>summary::-webkit-details-marker{display:none}.inline-fold>summary::before{content:"+ ";color:var(--accent)}.inline-fold[open]>summary::before{content:"− "}.inline-code-note{margin:14px 18px 18px;padding:17px 18px;border-left:3px solid var(--accent);background:var(--paper-raised);box-shadow:var(--shadow);scroll-margin-top:18px}.note-head{display:flex;justify-content:space-between;gap:18px;align-items:flex-start}.note-kicker{margin:0 0 4px;color:var(--accent);font:650 10px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;text-transform:uppercase}.note-head h4{margin:0;font-size:16px;line-height:1.4}.note-badges{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}.badge{padding:3px 7px;border:1px solid var(--rule);color:var(--ink-tertiary);font:9.5px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace}.badge.required{border-color:#d9a8a2;color:#8f2f25;background:var(--accent-soft)}.badge.decision{border-color:#9bc4ae;color:var(--success);background:var(--success-soft)}.review-draft{margin:15px 0 0;padding:14px 16px;background:#f8f7f2;border:1px solid var(--rule);font-weight:560;white-space:pre-wrap}.review-explanation{margin:13px 0 0;color:var(--ink-secondary);white-space:pre-wrap}.note-details{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:14px}.note-details details{border:1px solid var(--rule);background:var(--paper);padding:10px 12px}.note-details summary{cursor:pointer;font-weight:610}.meta-grid{display:grid;gap:8px;margin-top:10px}.meta-item{padding-top:8px;border-top:1px solid var(--rule);color:var(--ink-secondary)}.meta-item b{display:block;margin-bottom:2px;color:var(--ink-tertiary);font:9.5px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;text-transform:uppercase}.precedent{padding:8px 0;border-top:1px solid var(--rule)}.precedent a{color:var(--accent)}.edit-review textarea{width:100%;min-height:88px;margin-top:9px;padding:10px;border:1px solid var(--rule);background:#fff;resize:vertical;font:13px/1.55 inherit}.note-actions{display:flex;gap:7px;flex-wrap:wrap;margin-top:13px;padding-top:13px;border-top:1px solid var(--rule)}.note-actions button{padding:6px 9px;border:1px solid var(--rule);background:#fff;color:var(--ink-secondary);cursor:pointer}.note-actions button:hover{border-color:var(--accent);color:var(--accent)}.note-actions button.primary{background:var(--ink);border-color:var(--ink);color:#fff}.note-actions button.danger{color:#9b3027}.save-state{margin-left:auto;align-self:center;color:var(--ink-tertiary);font-size:11px}.verification-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;margin-top:20px;background:var(--rule);border:1px solid var(--rule)}.verification-item{padding:15px 16px;background:var(--paper-raised)}.verification-item b{display:block;font-size:18px}.verification-item span{color:var(--ink-tertiary);font-size:11px}.technical>summary{cursor:pointer;font-weight:620}.technical pre{overflow:auto;padding:14px;background:var(--code);font:11px/1.5 ui-monospace,monospace}.review-companion{position:sticky;top:20px;display:flex;flex-direction:column;max-height:calc(100vh - 40px);border:1px solid var(--rule-strong);background:var(--paper-raised);box-shadow:var(--shadow)}.companion-head{padding:17px 18px;border-bottom:1px solid var(--rule)}.companion-head p{margin:0;color:var(--accent);font:650 9.5px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;text-transform:uppercase}.companion-head h2{margin:3px 0 0;font-size:18px}.companion-context{padding:12px 16px;border-bottom:1px solid var(--rule);background:var(--paper)}.context-label{font-weight:620}.context-detail{margin-top:3px;color:var(--ink-tertiary);font:10px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;overflow-wrap:anywhere}.quick-questions{display:flex;gap:6px;flex-wrap:wrap;padding:10px 14px;border-bottom:1px solid var(--rule)}.quick-questions button{padding:5px 7px;border:1px solid var(--rule);background:#fff;color:var(--ink-secondary);font-size:10.5px;cursor:pointer}.conversation-thread{flex:1;min-height:190px;overflow:auto;padding:14px;display:flex;flex-direction:column;gap:10px}.chat-empty{color:var(--ink-tertiary);font-size:12px}.bubble{max-width:94%;padding:10px 12px;border:1px solid var(--rule);white-space:pre-wrap;font-size:12.5px}.bubble.learner{align-self:flex-end;background:var(--ink);color:#fff;border-color:var(--ink)}.bubble.coach{align-self:flex-start;background:var(--paper)}.bubble.pending{color:var(--ink-tertiary)}.bubble.failed{border-color:#d9a8a2;background:var(--accent-soft);color:#8f2f25}.chat-evidence{margin-top:8px;padding-top:7px;border-top:1px solid var(--rule);font-size:10.5px;color:var(--ink-tertiary)}.chat-evidence a{color:var(--accent)}.chat-compose{padding:12px 14px;border-top:1px solid var(--rule);background:var(--paper)}.chat-compose textarea{width:100%;min-height:78px;max-height:180px;padding:10px;border:1px solid var(--rule);resize:vertical;font:12.5px/1.5 inherit}.chat-compose-row{display:flex;align-items:center;gap:8px;margin-top:8px}.chat-compose-row button{padding:7px 11px;border:1px solid var(--ink);background:var(--ink);color:#fff;cursor:pointer}.chat-status{color:var(--ink-tertiary);font-size:10.5px}.companion-contents{border-top:1px solid var(--rule)}.companion-contents>summary{padding:9px 14px;cursor:pointer;color:var(--ink-tertiary);font:10px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;text-transform:uppercase}.companion-contents nav{display:grid;padding:0 14px 10px}.companion-contents a{display:grid;grid-template-columns:24px 1fr;gap:8px;padding:6px 0;border-top:1px solid var(--rule);color:var(--ink-secondary);text-decoration:none;font-size:10.5px}.companion-contents a:hover{color:var(--accent)}.loading{padding:38px 0;color:var(--ink-tertiary)}@media(max-width:980px){.shell{padding:42px 28px 90px}.review-layout{grid-template-columns:1fr}.review-companion{position:static;max-height:720px}.overview{grid-template-columns:1fr;gap:20px}.section-body{padding-left:0}}@media(max-width:700px){.shell{padding:28px 14px 80px}.report-header h1{font-size:29px}.report-stats{grid-template-columns:1fr 1fr}.review-section>summary{grid-template-columns:34px minmax(0,1fr) auto}.section-summary{grid-column:2/4}.section-count{grid-column:2}.file-header{grid-template-columns:1fr}.line{grid-template-columns:44px 44px minmax(620px,1fr)}.note-head{display:block}.note-badges{justify-content:flex-start;margin-top:8px}.note-details{grid-template-columns:1fr}.attention-item{grid-template-columns:72px 1fr}.attention-path{display:none}.verification-grid{grid-template-columns:1fr}}
</style>
</head>
<body><main class="shell"><header class="report-header"><p class="report-kicker">Human PR Review · evidence bound</p><h1 id="title">PR Review 문서를 만드는 중...</h1><div class="report-meta"><a id="prLink" target="_blank" rel="noreferrer"></a><span id="head"></span><span>GitHub 자동 게시 없음</span></div><dl class="report-stats"><div class="report-stat"><dt>Files</dt><dd id="files">-</dd></div><div class="report-stat"><dt>Diff</dt><dd id="diffStats">-</dd></div><div class="report-stat"><dt>Coverage</dt><dd id="chunks">-</dd></div><div class="report-stat"><dt>Findings</dt><dd id="cards">-</dd></div></dl></header><section class="overview report-section" id="overview"><div><p class="section-label">Overview</p><h2>이 변경을 읽는 방법</h2><div class="reading-order"><span>변경 목적</span><span>먼저 볼 점</span><span>파일별 diff</span><span>검증</span></div></div><p class="summary" id="summary">PR source snapshot을 불러오는 중입니다.</p></section><div class="review-layout"><div class="review-content"><section class="attention report-section" id="attention"><p class="section-label">Review attention</p><h2>먼저 볼 점</h2><div class="attention-list" id="attentionList"><div class="loading">리뷰 포인트를 준비하는 중입니다.</div></div></section><div id="sections"></div><section class="verification report-section" id="verification"><p class="section-label">Verification</p><h2>검토 범위</h2><div class="verification-grid" id="verificationGrid"></div></section><details class="technical report-section" id="technical"><summary>기술 세부 정보</summary><pre id="technicalText"></pre></details></div><aside class="review-companion"><div class="companion-head"><p>Guided Review</p><h2>이해하면서 질문하기</h2></div><div class="companion-context"><div class="context-label" id="contextLabel">전체 PR</div><div class="context-detail" id="contextDetail">문서·코드·리뷰 포인트를 선택하면 질문 문맥이 바뀝니다.</div></div><div class="quick-questions"><button data-quick="더 쉽게 설명해줘.">더 쉽게</button><button data-quick="변경 전과 변경 후 흐름으로 설명해줘.">전후 흐름</button><button data-quick="코드에서 확인된 사실과 아직 추측인 부분을 나눠줘.">사실/추측</button><button data-quick="이 리뷰가 과한 것은 아닌지 반례까지 검토해줘.">과한가?</button><button data-quick="작성자에게 어떻게 질문하면 좋을지 리뷰 문장으로 만들어줘.">리뷰 문장</button><button id="resetContext">전체 PR</button></div><div class="conversation-thread" id="conversationThread"><div class="chat-empty">선택한 코드나 리뷰에 대해 바로 질문할 수 있습니다.</div></div><div class="chat-compose"><textarea id="questionInput" placeholder="예: reserved_stays가 무엇이고 왜 이 migration과 관련돼?"></textarea><div class="chat-compose-row"><button id="questionSend">질문 보내기</button><span class="chat-status" id="questionStatus"></span></div></div><details class="companion-contents"><summary>문서 목차</summary><nav id="minimap"><a href="#overview"><span>00</span><span>Overview</span></a><a href="#attention"><span>01</span><span>먼저 볼 점</span></a><a href="#verification"><span>—</span><span>검증</span></a></nav></details></aside></div></main>
<script>
(() => {
  const token = new URLSearchParams(location.search).get('token') || '';
  let selectedContext={scope:'session'};
  let latestState=null;
  let questionDraft='';
  let pollTimer=null;
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const slug = (value) => String(value).replace(/[^a-zA-Z0-9_-]+/g,'-');
  const finalDraft = (card) => card.editedReviewDraft || card.reviewDraft || '';
  const firstParagraph = (body) => String(body||'').split(/\n\s*\n/).map((part)=>part.replace(/^#+\s*/gm,'').replace(/^[-*]\s*/gm,'').trim()).find(Boolean) || '변경 목적은 PR 본문과 diff를 함께 확인하세요.';
  const basename = (path) => String(path||'').split('/').pop() || path;
  const lineClass = (kind) => 'line-kind-'+String(kind||'metadata').replaceAll('_','-');
  function lineHtml(line,file){return '<div class="line '+esc(lineClass(line.kind))+'" id="'+esc(line.id)+'" data-evidence-id="'+esc(line.id)+'" data-file-id="'+esc(file&&file.id||'')+'" data-file-path="'+esc(file&&file.path||'')+'"><span class="line-no">'+esc(line.oldLine??'')+'</span><span class="line-no">'+esc(line.newLine??'')+'</span><span class="line-code">'+esc(line.text)+'</span></div>';}
  function metaItem(label,value){return value?'<div class="meta-item"><b>'+esc(label)+'</b>'+esc(value)+'</div>':'';}
  function precedentHtml(item){return '<div class="precedent"><a href="'+esc(item.url)+'" target="_blank" rel="noreferrer">'+esc(item.label)+'</a><div>'+esc(item.similarity||'')+'</div>'+(item.difference?'<small>차이: '+esc(item.difference)+'</small>':'')+'</div>';}
  function noteHtml(card){const precedents=(card.precedents||[]).length?'<details><summary>인간 리뷰 precedent '+card.precedents.length+'건</summary>'+card.precedents.map(precedentHtml).join('')+'</details>':'';return '<aside class="inline-code-note" id="finding-'+esc(slug(card.id))+'" data-card="'+esc(card.id)+'" data-file-path="'+esc(card.code&&card.code.path||'')+'" data-evidence-ids="'+esc((card.evidenceIds||[]).join(','))+'"><div class="note-head"><div><p class="note-kicker">'+esc(card.strength)+' review</p><h4>'+esc(card.id)+' · '+esc(card.title)+'</h4></div><div class="note-badges"><span class="badge '+esc(card.strength)+'">'+esc(card.strength)+'</span><span class="badge">confidence '+esc(card.confidence)+'</span>'+(card.decision?'<span class="badge decision">'+esc(card.decision)+'</span>':'')+'</div></div><div class="review-draft">'+esc(finalDraft(card))+'</div><p class="review-explanation">'+esc(card.explanation)+'</p><div class="note-details"><details><summary>메타적 관점</summary><div class="meta-grid">'+metaItem('결론',card.meta?.summary)+metaItem('기존 가드',card.meta?.existingGuard)+metaItem('구조적 방지',card.meta?.structuralPrevention)+metaItem('기계적 방지',card.meta?.machinePrevention)+metaItem('범위',card.meta?.scope)+'</div></details>'+precedents+'<details class="edit-review"><summary>리뷰 문구 수정</summary><textarea data-draft>'+esc(finalDraft(card))+'</textarea></details></div><div class="note-actions"><button class="primary" data-decision="review-only">리뷰 채택</button><button data-decision="review-with-meta">메타 포함</button><button data-decision="edit">수정 저장</button><button data-decision="follow-up">후속</button><button data-decision="hold">보류</button><button class="danger" data-decision="dismiss">폐기</button><button data-copy>복사</button><span class="save-state" data-state></span></div></aside>';}
  function fileCards(file,state){const ids=new Set(file.lines.map((line)=>line.id));return state.cards.filter((card)=>(card.evidenceIds||[]).some((id)=>ids.has(id)));}
  function interestingIndices(file,cards){const indexById=new Map(file.lines.map((line,index)=>[line.id,index]));const set=new Set();file.lines.forEach((line,index)=>{if(['file-header','old-file','new-file','hunk-header'].includes(line.kind))set.add(index);});cards.forEach((card)=>(card.evidenceIds||[]).forEach((id)=>{const index=indexById.get(id);if(index===undefined)return;for(let next=Math.max(0,index-4);next<=Math.min(file.lines.length-1,index+4);next++)set.add(next);}));return set;}
  function diffHtml(file,cards){const interesting=interestingIndices(file,cards);const noteByLine=new Map();cards.forEach((card)=>{const anchor=(card.evidenceIds||[]).find((id)=>file.lines.some((line)=>line.id===id));if(anchor)noteByLine.set(anchor,[...(noteByLine.get(anchor)||[]),card]);});let html='';let hidden=[];const flush=()=>{if(!hidden.length)return;if(hidden.length<=8)html+=hidden.map((line)=>lineHtml(line,file)).join('');else html+='<details class="inline-fold"><summary>검토했지만 현재 리뷰와 직접 관련 없는 '+hidden.length+'줄</summary>'+hidden.map((line)=>lineHtml(line,file)).join('')+'</details>';hidden=[];};file.lines.forEach((line,index)=>{if(interesting.has(index)){flush();html+=lineHtml(line,file);for(const card of noteByLine.get(line.id)||[])html+=noteHtml(card);}else hidden.push(line);});flush();return html;}
  function sectionHtml(file,index,state){const cards=fileCards(file,state);const summary=cards.length?cards.map((card)=>card.title).join(' · '):'전체 diff를 검토했고 별도 리뷰 포인트는 없습니다.';return '<details class="review-section" id="section-'+esc(slug(file.id))+'" data-file-id="'+esc(file.id)+'" data-file-path="'+esc(file.path)+'" '+(cards.length?'open':'')+'><summary><span class="section-number">'+String(index+1).padStart(2,'0')+'</span><span class="section-heading">'+esc(basename(file.path))+'</span><span class="section-summary">'+esc(summary)+'</span><span class="section-count">+'+file.additions+' / -'+file.deletions+'</span></summary><div class="section-body"><article class="file"><header class="file-header"><h3><span class="file-name">'+esc(basename(file.path))+'</span><span class="file-path">'+esc(file.path)+'</span></h3><p>'+esc(file.status)+' · '+file.lines.length+' diff lines</p></header><div class="diff">'+diffHtml(file,cards)+'</div></article></div></details>';}
  function attentionHtml(card){return '<a class="attention-item" data-attention-card="'+esc(card.id)+'" href="#finding-'+esc(slug(card.id))+'"><span class="attention-kind">'+esc(card.strength)+'</span><span class="attention-title">'+esc(card.title)+'</span><span class="attention-path">'+esc(card.code?.path||'')+'</span></a>';}
  function contextLabel(context){if(!latestState)return{label:'전체 PR',detail:'문서·코드·리뷰 포인트를 선택하면 질문 문맥이 바뀝니다.'};if(context.scope==='card'){const card=latestState.cards.find((item)=>item.id===context.cardId);return{label:card?card.id+' · '+card.title:'리뷰 카드',detail:[context.filePath,(context.evidenceIds||[]).join(', ')].filter(Boolean).join(' · ')};}if(context.scope==='evidence')return{label:'코드 근거 '+(context.evidenceIds||[]).join(', '),detail:context.filePath||''};if(context.scope==='file')return{label:'파일 '+(context.filePath||context.fileId||''),detail:'이 파일의 역할과 전체 PR 영향 기준'};return{label:'전체 PR',detail:'변경 목적·파일 관계·리뷰 판단 전체 기준'};}
  function setContext(next){selectedContext=next||{scope:'session'};renderConversation();}
  function answerHtml(text){const lines=String(text||'').split(/\r?\n/);let html='';let list=[];const flush=()=>{if(!list.length)return;html+='<ul>'+list.map((item)=>'<li>'+esc(item)+'</li>').join('')+'</ul>';list=[];};for(const line of lines){const bullet=line.match(/^[-*]\s+(.*)$/);if(bullet){list.push(bullet[1]);continue;}flush();if(line.trim())html+='<p>'+esc(line)+'</p>';}flush();return html;}
  function questionEvidenceHtml(question){if(!question.evidence||!question.evidence.length)return'';return'<div class="chat-evidence"><b>확인 근거</b>'+question.evidence.map((item)=>'<div>'+(item.url?'<a href="'+esc(item.url)+'" target="_blank" rel="noreferrer">'+esc(item.label)+'</a>':esc(item.label))+(item.path?' · '+esc(item.path)+(item.line?':'+item.line:''):'')+(item.note?' — '+esc(item.note):'')+'</div>').join('')+'</div>';}
  function questionHtml(question){const context=[question.cardId,question.filePath,(question.evidenceIds||[]).join(', ')].filter(Boolean).join(' · ');let response='';if(question.status==='answered')response='<div class="bubble coach">'+answerHtml(question.answer)+questionEvidenceHtml(question)+(question.uncertainty?'<div class="chat-evidence"><b>아직 확인이 필요한 것</b><div>'+esc(question.uncertainty)+'</div></div>':'')+'</div>';else if(question.status==='failed')response='<div class="bubble coach failed">'+esc(question.error||'질문 처리에 실패했습니다.')+'</div>';else response='<div class="bubble coach pending">실제 PR source를 조사하고 있습니다…</div>';return'<div class="bubble learner">'+esc(question.question)+(context?'<div style="opacity:.68;font-size:10px;margin-top:5px">'+esc(context)+'</div>':'')+'</div>'+response;}
  function renderConversation(){const info=contextLabel(selectedContext);document.getElementById('contextLabel').textContent=info.label;document.getElementById('contextDetail').textContent=info.detail;const thread=document.getElementById('conversationThread');const questions=latestState&&latestState.questions||[];thread.innerHTML=questions.length?questions.map(questionHtml).join(''):'<div class="chat-empty">선택한 코드나 리뷰에 대해 바로 질문할 수 있습니다.</div>';thread.scrollTop=thread.scrollHeight;const input=document.getElementById('questionInput');if(input&&input.value!==questionDraft)input.value=questionDraft;}
  async function askQuestion(){const input=document.getElementById('questionInput'),button=document.getElementById('questionSend'),status=document.getElementById('questionStatus'),question=input.value.trim();if(!question)return;button.disabled=true;status.textContent='같은 Pi 세션에 전달 중…';const response=await fetch('/ask?token='+encodeURIComponent(token),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({question,...selectedContext})});const payload=await response.json();if(!response.ok)throw new Error(payload.error||'질문 전달 실패');questionDraft='';input.value='';status.textContent='실제 코드를 조사하고 있습니다.';button.disabled=false;await refresh();}
  async function decide(note,decision){const textarea=note.querySelector('[data-draft]');const status=note.querySelector('[data-state]');status.textContent='저장 중...';const response=await fetch('/decision?token='+encodeURIComponent(token),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({cardId:note.dataset.card,decision,editedReviewDraft:textarea?.value})});const payload=await response.json();if(!response.ok)throw new Error(payload.error||'저장 실패');status.textContent='저장됨 · '+decision;await refresh();}
  function bind(){document.querySelectorAll('[data-decision]').forEach((button)=>button.addEventListener('click',(event)=>{event.stopPropagation();decide(button.closest('.inline-code-note'),button.dataset.decision).catch((error)=>{button.closest('.inline-code-note').querySelector('[data-state]').textContent=error.message;});}));document.querySelectorAll('[data-copy]').forEach((button)=>button.addEventListener('click',async(event)=>{event.stopPropagation();const note=button.closest('.inline-code-note');const text=note.querySelector('[data-draft]')?.value||note.querySelector('.review-draft')?.textContent||'';const status=note.querySelector('[data-state]');try{await navigator.clipboard.writeText(text);status.textContent='복사됨';}catch{status.textContent='복사 실패';}}));document.querySelectorAll('.inline-code-note').forEach((note)=>note.addEventListener('click',()=>setContext({scope:'card',cardId:note.dataset.card,filePath:note.dataset.filePath,evidenceIds:(note.dataset.evidenceIds||'').split(',').filter(Boolean)})));document.querySelectorAll('.line[data-evidence-id]').forEach((line)=>line.addEventListener('click',()=>setContext({scope:'evidence',fileId:line.dataset.fileId,filePath:line.dataset.filePath,evidenceIds:[line.dataset.evidenceId]})));document.querySelectorAll('.review-section>summary').forEach((summary)=>summary.addEventListener('click',()=>{const section=summary.closest('.review-section');setContext({scope:'file',fileId:section.dataset.fileId,filePath:section.dataset.filePath});}));document.querySelectorAll('[data-attention-card]').forEach((item)=>item.addEventListener('click',()=>{const card=latestState.cards.find((candidate)=>candidate.id===item.dataset.attentionCard);if(card)setContext({scope:'card',cardId:card.id,filePath:card.code&&card.code.path,evidenceIds:card.evidenceIds||[]});}));document.querySelectorAll('[data-quick]').forEach((button)=>{if(button.dataset.bound)return;button.dataset.bound='1';button.addEventListener('click',()=>{const input=document.getElementById('questionInput');input.value=button.dataset.quick;questionDraft=input.value;input.focus();});});const input=document.getElementById('questionInput');if(input&&!input.dataset.bound){input.dataset.bound='1';input.addEventListener('input',()=>{questionDraft=input.value;});}const send=document.getElementById('questionSend');if(send&&!send.dataset.bound){send.dataset.bound='1';send.addEventListener('click',()=>askQuestion().catch((error)=>{send.disabled=false;document.getElementById('questionStatus').textContent=error.message;}));}const reset=document.getElementById('resetContext');if(reset&&!reset.dataset.bound){reset.dataset.bound='1';reset.addEventListener('click',()=>setContext({scope:'session'}));}}
  function minimapHtml(files){return '<a href="#overview"><span>00</span><span>Overview</span></a><a href="#attention"><span>01</span><span>먼저 볼 점</span></a>'+files.map((file,index)=>'<a href="#section-'+esc(slug(file.id))+'"><span>'+String(index+2).padStart(2,'0')+'</span><span>'+esc(basename(file.path))+'</span></a>').join('')+'<a href="#verification"><span>—</span><span>검증</span></a>';}
  async function refresh(){if(pollTimer){clearTimeout(pollTimer);pollTimer=null;}const response=await fetch('/state?token='+encodeURIComponent(token),{cache:'no-store'});if(!response.ok)throw new Error('state load failed');const state=await response.json();latestState=state;const target=state.run.target;document.getElementById('title').textContent='#'+target.number+' '+target.title;const prLink=document.getElementById('prLink');prLink.href=target.url;prLink.textContent=target.owner+'/'+target.repo+'#'+target.number;document.getElementById('head').textContent='head '+String(target.headSha||'unknown').slice(0,12);document.getElementById('files').textContent=state.source.stats.files;document.getElementById('diffStats').textContent='+'+state.source.stats.additions+' / -'+state.source.stats.deletions;document.getElementById('chunks').textContent=state.inspection.inspected+'/'+state.inspection.total;document.getElementById('cards').textContent=state.cards.length;document.getElementById('summary').textContent=firstParagraph(target.body)+' 이 문서는 Git 파일 순서보다 리뷰 포인트와 데이터 흐름을 먼저 읽도록 구성했습니다.';document.getElementById('attentionList').innerHTML=state.cards.length?state.cards.map(attentionHtml).join(''):'<div class="attention-item"><span class="attention-kind">NO FINDING</span><span class="attention-title">직접 근거로 닫을 수 있는 리뷰 포인트를 찾지 못했습니다.</span><span class="attention-path">승인이나 안전 보장을 의미하지 않습니다.</span></div>';document.getElementById('sections').innerHTML=state.source.files.map((file,index)=>sectionHtml(file,index,state)).join('');document.getElementById('verificationGrid').innerHTML='<div class="verification-item"><b>'+state.inspection.inspected+'/'+state.inspection.total+'</b><span>source chunk inspection</span></div><div class="verification-item"><b>'+state.source.stats.files+'/'+state.source.stats.files+'</b><span>files represented</span></div><div class="verification-item"><b>'+state.cards.filter((card)=>card.decision).length+'/'+state.cards.length+'</b><span>human decisions</span></div>';document.getElementById('technicalText').textContent='source sha256: '+state.source.sourceSha256+'\nreport: '+state.run.reportPath+'\nstatus: '+state.run.status+'\npending chunks: '+(state.inspection.pending.join(', ')||'none');document.getElementById('minimap').innerHTML=minimapHtml(state.source.files);bind();renderConversation();const active=(state.questions||[]).some((question)=>question.status==='queued'||question.status==='answering');if(state.run.status!=='ready'||active)pollTimer=setTimeout(()=>refresh().catch(()=>{}),1200);}
  refresh().catch((error)=>{document.getElementById('summary').textContent=error.message;});
})();
</script></body></html>`;
}

export async function startPrReviewStudioServer(
	state: PrReviewRunState,
	options: { onQuestion?: (question: PrReviewQuestion) => void } = {},
): Promise<StudioHandle> {
	const existing = handles.get(state.runId);
	if (existing && !existing.closed) {
		if (options.onQuestion) existing.onQuestion = options.onQuestion;
		return existing;
	}
	const token = randomUUID();
	const html = buildPrReviewStudioHtml(`PR Review · #${state.target.number}`);
	let handle!: StudioHandle;
	const server = createServer(async (request, response) => {
		try {
			const url = new URL(request.url || "/", "http://127.0.0.1");
			if (url.searchParams.get("token") !== token) {
				sendJson(response, 403, { error: "forbidden" });
				return;
			}
			if (request.method === "GET" && url.pathname === "/") {
				sendHtml(response, html);
				return;
			}
			if (request.method === "GET" && url.pathname === "/state") {
				sendJson(response, 200, buildMetaReviewClientState(state.runDir));
				return;
			}
			if (request.method === "GET" && url.pathname === "/report") {
				const latest = loadPrReviewRun(state.runDir);
				response.writeHead(200, { "Content-Type": "text/markdown; charset=utf-8", "Cache-Control": "no-store" });
				response.end(readFileSync(latest.reportPath, "utf8"));
				return;
			}
			if (request.method === "POST" && url.pathname === "/ask") {
				const body = await readBody(request);
				const questionText = typeof body.question === "string" ? body.question.trim() : "";
				if (!questionText) throw new Error("question is required");
				const snapshot = buildMetaReviewClientState(state.runDir);
				const context = resolvePrReviewQuestionContext(snapshot, body);
				const question = createPrReviewQuestion(state.runDir, {
					runId: state.runId,
					question: questionText,
					...context,
				});
				if (!handle.onQuestion) {
					failPrReviewQuestion(state.runDir, question.id, "이 Studio가 PR worktree Pi session과 연결되지 않았습니다.");
					throw new Error("PR review question session is not connected");
				}
				handle.onQuestion(question);
				sendJson(response, 202, { ok: true, question });
				return;
			}
			if (request.method === "POST" && url.pathname === "/decision") {
				const body = await readBody(request);
				const cardId = typeof body.cardId === "string" ? body.cardId : "";
				const decision = typeof body.decision === "string" ? body.decision as HumanReviewDecision : undefined;
				if (!cardId || !decision || !DECISIONS.has(decision)) throw new Error("invalid decision payload");
				const latest = loadPrReviewRun(state.runDir);
				const cards = saveHumanDecision(latest, cardId, decision, typeof body.editedReviewDraft === "string" ? body.editedReviewDraft : undefined);
				sendJson(response, 200, { ok: true, card: cards.find((card) => card.id === cardId) });
				return;
			}
			sendJson(response, 404, { error: "not found" });
		} catch (error) {
			sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
		}
	});
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => resolve());
	});
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("PR Review Studio server address를 확인하지 못했습니다.");
	handle = {
		runId: state.runId,
		runDir: state.runDir,
		token,
		server,
		url: `http://127.0.0.1:${address.port}/?token=${encodeURIComponent(token)}`,
		closed: false,
		onQuestion: options.onQuestion,
	};
	server.on("close", () => { handle.closed = true; });
	handles.set(state.runId, handle);
	return handle;
}

export async function openPrReviewStudio(
	pi: ExtensionAPI,
	ctx: Pick<ExtensionContext, "cwd" | "sessionManager">,
	state: PrReviewRunState,
): Promise<{ mode: string; url: string }> {
	const handle = await startPrReviewStudioServer(state, {
		onQuestion: (question) => dispatchPrReviewQuestionToSession(pi, state, question),
	});
	const result = await openCompanionUrl(pi, ctx, handle.url, `PR Review · #${state.target.number} ${state.target.title}`, {
		key: `pr-review:${state.runId}`,
		width: 1380,
		height: 940,
		openLinks: true,
	});
	handle.window = result.window;
	return { mode: result.mode, url: handle.url };
}

export function closePrReviewStudios(): void {
	for (const handle of handles.values()) {
		if (!handle.closed) handle.server.close();
		handle.closed = true;
	}
	handles.clear();
}
