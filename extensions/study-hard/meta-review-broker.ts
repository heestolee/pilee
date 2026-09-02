import { randomUUID } from "node:crypto";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@mariozechner/pi-coding-agent";

export const STUDY_HARD_META_REVIEW_OPEN_EVENT = "pilee:study-hard:open-meta-review";
export const STUDY_HARD_META_REVIEW_START_EVENT = "pilee:study-hard:start-meta-review";

export interface StudyHardMetaReviewOpenInput {
	ctx: ExtensionCommandContext | ExtensionContext;
	url: string;
	title: string;
	fallbackRunId: string;
	patch: Record<string, unknown>;
}

export interface StudyHardMetaReviewOpenResult {
	runId: string;
	url: string;
	statePath: string;
	revision: number;
}

export interface StudyHardMetaReviewStartInput {
	cwd: string;
	studyRunId: string;
}

export interface StudyHardMetaReviewStartResult {
	runId: string;
	runDir: string;
	source: "current-work" | "github-pr";
}

interface StudyHardMetaReviewOpenRequest extends StudyHardMetaReviewOpenInput {
	kind: "study-hard-meta-review-open";
	requestId: string;
	claim(): boolean;
	onOpened(result: StudyHardMetaReviewOpenResult): void;
	onRejected(error: unknown): void;
}

interface StudyHardMetaReviewStartRequest extends StudyHardMetaReviewStartInput {
	kind: "study-hard-meta-review-start";
	requestId: string;
	claim(): boolean;
	onStarted(result: StudyHardMetaReviewStartResult): void;
	onRejected(error: unknown): void;
}

interface StudyHardMetaReviewBrokerRegistry {
	openOwners: WeakMap<object, () => void>;
	startOwners: WeakMap<object, () => void>;
}

const BROKER_REGISTRY = Symbol.for("pilee.study-hard.meta-review-open-broker");

function brokerRegistry(): StudyHardMetaReviewBrokerRegistry {
	const root = globalThis as typeof globalThis & { [BROKER_REGISTRY]?: StudyHardMetaReviewBrokerRegistry };
	const registry = root[BROKER_REGISTRY] ??= {
		openOwners: new WeakMap<object, () => void>(),
		startOwners: new WeakMap<object, () => void>(),
	};
	registry.openOwners ??= new WeakMap<object, () => void>();
	registry.startOwners ??= new WeakMap<object, () => void>();
	return registry;
}

export function requestStudyHardMetaReviewOpen(
	pi: ExtensionAPI,
	input: StudyHardMetaReviewOpenInput,
): Promise<StudyHardMetaReviewOpenResult> | undefined {
	if (!pi.events || typeof pi.events.emit !== "function") return undefined;
	let claimed = false;
	let resolveRequest!: (result: StudyHardMetaReviewOpenResult) => void;
	let rejectRequest!: (error: unknown) => void;
	const completion = new Promise<StudyHardMetaReviewOpenResult>((resolve, reject) => {
		resolveRequest = resolve;
		rejectRequest = reject;
	});
	const request: StudyHardMetaReviewOpenRequest = {
		...input,
		kind: "study-hard-meta-review-open",
		requestId: randomUUID(),
		claim() {
			if (claimed) return false;
			claimed = true;
			return true;
		},
		onOpened: resolveRequest,
		onRejected: rejectRequest,
	};

	pi.events.emit(STUDY_HARD_META_REVIEW_OPEN_EVENT, request);
	return claimed ? completion : undefined;
}

export function registerStudyHardMetaReviewOpenBroker(
	pi: ExtensionAPI,
	open: (request: StudyHardMetaReviewOpenInput) => Promise<StudyHardMetaReviewOpenResult>,
): () => void {
	if (!pi.events || typeof pi.events.on !== "function") return () => {};
	const registry = brokerRegistry();
	const ownerKey = pi.events as object;
	registry.openOwners.get(ownerKey)?.();

	const disposeListener = pi.events.on(STUDY_HARD_META_REVIEW_OPEN_EVENT, (payload) => {
		const request = payload as StudyHardMetaReviewOpenRequest;
		if (!request || request.kind !== "study-hard-meta-review-open" || !request.claim()) return;
		void open(request).then(request.onOpened, request.onRejected);
	});
	let disposed = false;
	const dispose = () => {
		if (disposed) return;
		disposed = true;
		disposeListener();
		if (registry.openOwners.get(ownerKey) === dispose) registry.openOwners.delete(ownerKey);
	};
	registry.openOwners.set(ownerKey, dispose);
	return dispose;
}

export function requestStudyHardMetaReviewStart(
	pi: ExtensionAPI,
	input: StudyHardMetaReviewStartInput,
): Promise<StudyHardMetaReviewStartResult> | undefined {
	if (!pi.events || typeof pi.events.emit !== "function") return undefined;
	let claimed = false;
	let resolveRequest!: (result: StudyHardMetaReviewStartResult) => void;
	let rejectRequest!: (error: unknown) => void;
	const completion = new Promise<StudyHardMetaReviewStartResult>((resolve, reject) => {
		resolveRequest = resolve;
		rejectRequest = reject;
	});
	const request: StudyHardMetaReviewStartRequest = {
		...input,
		kind: "study-hard-meta-review-start",
		requestId: randomUUID(),
		claim() {
			if (claimed) return false;
			claimed = true;
			return true;
		},
		onStarted: resolveRequest,
		onRejected: rejectRequest,
	};

	pi.events.emit(STUDY_HARD_META_REVIEW_START_EVENT, request);
	return claimed ? completion : undefined;
}

export function registerStudyHardMetaReviewStartBroker(
	pi: ExtensionAPI,
	start: (request: StudyHardMetaReviewStartInput) => Promise<StudyHardMetaReviewStartResult>,
): () => void {
	if (!pi.events || typeof pi.events.on !== "function") return () => {};
	const registry = brokerRegistry();
	const ownerKey = pi.events as object;
	registry.startOwners.get(ownerKey)?.();

	const disposeListener = pi.events.on(STUDY_HARD_META_REVIEW_START_EVENT, (payload) => {
		const request = payload as StudyHardMetaReviewStartRequest;
		if (!request || request.kind !== "study-hard-meta-review-start" || !request.claim()) return;
		void start(request).then(request.onStarted, request.onRejected);
	});
	let disposed = false;
	const dispose = () => {
		if (disposed) return;
		disposed = true;
		disposeListener();
		if (registry.startOwners.get(ownerKey) === dispose) registry.startOwners.delete(ownerKey);
	};
	registry.startOwners.set(ownerKey, dispose);
	return dispose;
}
