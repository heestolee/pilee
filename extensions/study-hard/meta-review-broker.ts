import { randomUUID } from "node:crypto";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@mariozechner/pi-coding-agent";

export const STUDY_HARD_META_REVIEW_OPEN_EVENT = "pilee:study-hard:open-meta-review";

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

interface StudyHardMetaReviewOpenRequest extends StudyHardMetaReviewOpenInput {
	kind: "study-hard-meta-review-open";
	requestId: string;
	claim(): boolean;
	onOpened(result: StudyHardMetaReviewOpenResult): void;
	onRejected(error: unknown): void;
}

interface StudyHardMetaReviewBrokerRegistry {
	owners: WeakMap<object, () => void>;
}

const BROKER_REGISTRY = Symbol.for("pilee.study-hard.meta-review-open-broker");

function brokerRegistry(): StudyHardMetaReviewBrokerRegistry {
	const root = globalThis as typeof globalThis & { [BROKER_REGISTRY]?: StudyHardMetaReviewBrokerRegistry };
	return root[BROKER_REGISTRY] ??= { owners: new WeakMap<object, () => void>() };
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
	registry.owners.get(ownerKey)?.();

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
		if (registry.owners.get(ownerKey) === dispose) registry.owners.delete(ownerKey);
	};
	registry.owners.set(ownerKey, dispose);
	return dispose;
}
