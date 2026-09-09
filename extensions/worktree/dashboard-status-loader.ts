export interface DashboardStatusTarget<T> {
	key: string;
	load: () => Promise<T>;
	apply: (value: T) => void;
}

export interface DashboardStatusLoader<T> {
	schedule: (targets: DashboardStatusTarget<T>[]) => void;
	close: () => void;
}

export function createDashboardStatusLoader<T>(options: {
	concurrency?: number;
	onUpdate?: () => void;
} = {}): DashboardStatusLoader<T> {
	const concurrency = Math.max(1, options.concurrency ?? 4);
	const queuedKeys = new Set<string>();
	const completedKeys = new Set<string>();
	const queue: DashboardStatusTarget<T>[] = [];
	let active = 0;
	let closed = false;

	const pump = () => {
		while (!closed && active < concurrency && queue.length > 0) {
			const target = queue.shift()!;
			active += 1;
			void target.load()
				.then((value) => {
					completedKeys.add(target.key);
					if (closed) return;
					target.apply(value);
					options.onUpdate?.();
				})
				.catch(() => {
					completedKeys.add(target.key);
				})
				.finally(() => {
					queuedKeys.delete(target.key);
					active -= 1;
					pump();
				});
		}
	};

	return {
		schedule(targets) {
			if (closed) return;
			for (const target of targets) {
				if (queuedKeys.has(target.key) || completedKeys.has(target.key)) continue;
				queuedKeys.add(target.key);
				queue.push(target);
			}
			pump();
		},
		close() {
			closed = true;
			queue.length = 0;
			queuedKeys.clear();
		},
	};
}
