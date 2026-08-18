import { randomUUID } from "node:crypto";
import { createServer, type Server, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { openCompanionUrl } from "../utils/companion-window.ts";
import type { GlimpseWindow } from "../utils/glimpse.ts";
import type { ReviewSourceBundle } from "./evidence.ts";
import {
	loadInspection,
	loadPrReviewRun,
	readJson,
	saveHumanDecision,
	type HumanReviewDecision,
	type PrReviewRunState,
	type ReviewCard,
} from "./run.ts";

interface StudioHandle {
	runId: string;
	runDir: string;
	token: string;
	server: Server;
	url: string;
	closed: boolean;
	window?: GlimpseWindow;
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

function currentState(runDir: string) {
	const run = loadPrReviewRun(runDir);
	const source = readJson<ReviewSourceBundle>(run.sourcePath);
	const inspection = loadInspection(run);
	const cards = readJson<ReviewCard[]>(run.cardsPath);
	return {
		run: {
			runId: run.runId,
			status: run.status,
			target: run.target,
			reportPath: run.reportPath,
		},
		source: {
			stats: source.stats,
			files: source.files.map((file) => ({ id: file.id, path: file.path, status: file.status, additions: file.additions, deletions: file.deletions })),
		},
		inspection: {
			inspected: inspection.inspectedChunkIds.length,
			total: source.chunks.length,
			pending: source.chunks.filter((chunk) => !inspection.inspectedChunkIds.includes(chunk.id)).map((chunk) => chunk.id),
		},
		cards,
	};
}

export function buildPrReviewStudioHtml(title: string): string {
	return String.raw`<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
:root{color-scheme:light;--bg:#f4f5f6;--panel:#fff;--soft:#eef0f2;--line:#d7dce1;--text:#20242a;--muted:#68717c;--accent:#00a99d;--accentSoft:#d9f0ee;--danger:#a33b3b;--warning:#966100;--shadow:0 12px 34px rgba(25,31,38,.08)}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.58 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}button,textarea{font:inherit}.shell{max-width:1280px;margin:0 auto;padding:28px 24px 80px}.hero{background:linear-gradient(135deg,#20242a,#38414b);color:white;padding:28px;border-radius:20px;box-shadow:var(--shadow)}.hero .eyebrow{font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#8be0d9}.hero h1{font-size:27px;line-height:1.25;margin:7px 0 10px}.hero p{margin:0;color:#d4d9df}.summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-top:18px}.metric{background:rgba(255,255,255,.09);border:1px solid rgba(255,255,255,.12);padding:12px 14px;border-radius:12px}.metric b{display:block;font-size:18px}.metric span{font-size:12px;color:#c9d0d8}.notice{margin:18px 0;padding:14px 16px;background:#fff;border:1px solid var(--line);border-radius:12px;color:var(--muted)}.cards{display:flex;flex-direction:column;gap:18px}.card{background:var(--panel);border:1px solid var(--line);border-radius:18px;box-shadow:var(--shadow);overflow:hidden}.cardHead{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:20px 22px;border-bottom:1px solid var(--line)}.cardHead h2{font-size:18px;margin:2px 0}.cardHead .location{font-size:12px;color:var(--muted)}.badges{display:flex;gap:7px;flex-wrap:wrap}.badge{padding:4px 9px;border-radius:999px;background:var(--soft);font-size:11px;font-weight:700}.badge.required{background:#fbe8e8;color:#8c2d2d}.badge.question{background:#fff2cf;color:#7a5400}.badge.optional{background:var(--accentSoft);color:#006f66}.decision{background:#e8f4ed;color:#17643b}.section{padding:20px 22px;border-bottom:1px solid #eceff1}.section:last-child{border-bottom:0}.section h3{font-size:13px;letter-spacing:.02em;margin:0 0 10px;color:#39434e}.code{margin:0;background:#1f242b;color:#eef3f7;padding:17px;border-radius:12px;overflow:auto;white-space:pre;font:12px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace}.draft{width:100%;min-height:98px;resize:vertical;border:1px solid var(--line);border-radius:12px;padding:13px 14px;color:var(--text);background:#fbfcfc}.explanation{margin:0;white-space:pre-wrap}.meta{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.metaItem{padding:13px 14px;border-radius:12px;background:var(--soft)}.metaItem b{display:block;font-size:11px;color:var(--muted);margin-bottom:4px}.metaSummary{grid-column:1/-1;background:var(--accentSoft)}details{border:1px solid var(--line);border-radius:12px;padding:10px 12px}summary{cursor:pointer;font-weight:700}.precedent{padding:10px 0;border-top:1px solid var(--line)}.precedent:first-of-type{border-top:0}.precedent a{color:#087d74}.actions{display:flex;gap:8px;flex-wrap:wrap;padding:16px 22px;background:#fafbfb}.actions button{border:1px solid var(--line);background:white;border-radius:10px;padding:8px 11px;cursor:pointer}.actions button:hover{border-color:var(--accent);background:var(--accentSoft)}.actions button.primary{background:var(--accent);border-color:var(--accent);color:white}.actions button.danger{color:var(--danger)}.copyState{margin-left:auto;color:var(--muted);align-self:center}.empty{padding:34px;background:white;border:1px solid var(--line);border-radius:16px;text-align:center;color:var(--muted)}@media(max-width:760px){.shell{padding:16px 12px 64px}.summary{grid-template-columns:repeat(2,minmax(0,1fr))}.meta{grid-template-columns:1fr}.metaSummary{grid-column:auto}.cardHead{flex-direction:column}.copyState{width:100%;margin:0}}
</style>
</head>
<body><main class="shell"><header class="hero"><div class="eyebrow">Human PR Review · read-only</div><h1 id="title">PR Review를 준비하는 중...</h1><p id="subtitle">독립 리뷰 → 인간 precedent → 메타 관점 → 인간 결정</p><div class="summary"><div class="metric"><b id="files">-</b><span>변경 파일</span></div><div class="metric"><b id="chunks">-</b><span>검사 chunk</span></div><div class="metric"><b id="cards">-</b><span>리뷰 카드</span></div><div class="metric"><b id="decisions">-</b><span>인간 결정</span></div></div></header><div class="notice" id="notice">source snapshot을 불러오는 중입니다.</div><section class="cards" id="cardList"></section></main>
<script>
(() => {
  const token = new URLSearchParams(location.search).get('token') || '';
  let latestSignature = '';
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const finalDraft = (card) => card.editedReviewDraft || card.reviewDraft || '';
  function precedentHtml(item){return '<div class="precedent"><a href="'+esc(item.url)+'" target="_blank" rel="noreferrer">'+esc(item.label)+'</a><div>'+esc(item.similarity||'')+'</div>'+(item.difference?'<small>차이: '+esc(item.difference)+'</small>':'')+'</div>';}
  function metaItem(label,value,klass=''){return value?'<div class="metaItem '+klass+'"><b>'+esc(label)+'</b><span>'+esc(value)+'</span></div>':'';}
  function cardHtml(card){
    const location=[card.code?.path,card.code?.startLine?String(card.code.startLine)+(card.code.endLine&&card.code.endLine!==card.code.startLine?'-'+card.code.endLine:''):''].filter(Boolean).join(':');
    const precedents=(card.precedents||[]).length?'<details><summary>참고한 인간 리뷰 '+card.precedents.length+'건</summary>'+card.precedents.map(precedentHtml).join('')+'</details>':'';
    return '<article class="card" data-card="'+esc(card.id)+'"><div class="cardHead"><div><div class="location">'+esc(location)+'</div><h2>'+esc(card.id)+' · '+esc(card.title)+'</h2></div><div class="badges"><span class="badge '+esc(card.strength)+'">'+esc(card.strength)+'</span><span class="badge">confidence '+esc(card.confidence)+'</span>'+(card.decision?'<span class="badge decision">'+esc(card.decision)+'</span>':'')+'</div></div><div class="section"><h3>코드</h3><pre class="code">'+esc(card.code?.text||'')+'</pre></div><div class="section"><h3>리뷰 초안</h3><textarea class="draft" data-draft>'+esc(finalDraft(card))+'</textarea></div><div class="section"><h3>설명</h3><p class="explanation">'+esc(card.explanation)+'</p></div><div class="section"><h3>메타적 관점</h3><div class="meta">'+metaItem('결론',card.meta?.summary,'metaSummary')+metaItem('기존 가드',card.meta?.existingGuard)+metaItem('구조적 방지',card.meta?.structuralPrevention)+metaItem('기계적 방지',card.meta?.machinePrevention)+metaItem('범위',card.meta?.scope)+'</div>'+(precedents?'<div style="margin-top:12px">'+precedents+'</div>':'')+'</div><div class="actions"><button class="primary" data-decision="review-only">리뷰만 채택</button><button data-decision="review-with-meta">메타까지 채택</button><button data-decision="edit">수정 저장</button><button data-decision="follow-up">후속 분리</button><button data-decision="hold">보류</button><button class="danger" data-decision="dismiss">폐기</button><button data-copy>리뷰 복사</button><span class="copyState" data-state></span></div></article>';
  }
  async function decide(card,decision){const textarea=card.querySelector('[data-draft]');const state=card.querySelector('[data-state]');state.textContent='저장 중...';const response=await fetch('/decision?token='+encodeURIComponent(token),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({cardId:card.dataset.card,decision,editedReviewDraft:textarea.value})});const payload=await response.json();if(!response.ok)throw new Error(payload.error||'저장 실패');state.textContent='저장됨 · '+decision;await refresh(true);}
  function bind(){document.querySelectorAll('[data-decision]').forEach((button)=>button.addEventListener('click',()=>decide(button.closest('.card'),button.dataset.decision).catch((error)=>{button.closest('.card').querySelector('[data-state]').textContent=error.message;})));document.querySelectorAll('[data-copy]').forEach((button)=>button.addEventListener('click',async()=>{const card=button.closest('.card');const value=card.querySelector('[data-draft]').value;try{await navigator.clipboard.writeText(value);card.querySelector('[data-state]').textContent='리뷰 복사됨';}catch{card.querySelector('[data-state]').textContent='복사 실패';}}));}
  async function refresh(force=false){const response=await fetch('/state?token='+encodeURIComponent(token),{cache:'no-store'});if(!response.ok)throw new Error('state load failed');const state=await response.json();const signature=JSON.stringify([state.run.status,state.inspection.inspected,state.cards]);if(!force&&signature===latestSignature)return;latestSignature=signature;document.getElementById('title').textContent='#'+state.run.target.number+' '+state.run.target.title;document.getElementById('subtitle').textContent=state.run.target.owner+'/'+state.run.target.repo+' · '+(state.run.target.headSha||'unknown').slice(0,12);document.getElementById('files').textContent=state.source.stats.files;document.getElementById('chunks').textContent=state.inspection.inspected+'/'+state.inspection.total;document.getElementById('cards').textContent=state.cards.length;document.getElementById('decisions').textContent=state.cards.filter((card)=>card.decision).length;document.getElementById('notice').textContent=state.cards.length?'ReviewCard는 exact diff evidence에서 파생됐습니다. GitHub에는 자동 게시되지 않습니다.':state.run.status==='ready'?'직접 근거로 닫을 수 있는 리뷰 포인트를 찾지 못했습니다. 승인이나 안전 보장을 의미하지 않습니다.':'agent가 '+state.inspection.pending.join(', ')+' source chunk를 검토하고 있습니다.';document.getElementById('cardList').innerHTML=state.cards.length?state.cards.map(cardHtml).join(''):'<div class="empty">리뷰 카드를 준비하는 중입니다.</div>';bind();}
  refresh(true).catch((error)=>{document.getElementById('notice').textContent=error.message;});setInterval(()=>refresh(false).catch(()=>{}),1500);
})();
</script></body></html>`;
}

export async function startPrReviewStudioServer(state: PrReviewRunState): Promise<StudioHandle> {
	const existing = handles.get(state.runId);
	if (existing && !existing.closed) return existing;
	const token = randomUUID();
	const html = buildPrReviewStudioHtml(`PR Review · #${state.target.number}`);
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
				sendJson(response, 200, currentState(state.runDir));
				return;
			}
			if (request.method === "GET" && url.pathname === "/report") {
				const latest = loadPrReviewRun(state.runDir);
				response.writeHead(200, { "Content-Type": "text/markdown; charset=utf-8", "Cache-Control": "no-store" });
				response.end(readFileSync(latest.reportPath, "utf8"));
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
	const handle: StudioHandle = {
		runId: state.runId,
		runDir: state.runDir,
		token,
		server,
		url: `http://127.0.0.1:${address.port}/?token=${encodeURIComponent(token)}`,
		closed: false,
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
	const handle = await startPrReviewStudioServer(state);
	const result = await openCompanionUrl(pi, ctx, handle.url, `PR Review · #${state.target.number} ${state.target.title}`, {
		key: `pr-review:${state.runId}`,
		width: 1320,
		height: 920,
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
