import assert from "node:assert/strict";
import test from "node:test";
import { createDashboardStatusLoader } from "./dashboard-status-loader.ts";

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => { resolve = done; });
	return { promise, resolve };
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

test("dashboard status loader bounds concurrency and deduplicates visible targets", async () => {
	const gates = Array.from({ length: 8 }, () => deferred<number>());
	const applied: number[] = [];
	let started = 0;
	let active = 0;
	let maxActive = 0;
	const targets = gates.map((gate, index) => ({
		key: `wt-${index}`,
		load: async () => {
			started += 1;
			active += 1;
			maxActive = Math.max(maxActive, active);
			const value = await gate.promise;
			active -= 1;
			return value;
		},
		apply: (value: number) => { applied.push(value); },
	}));
	const loader = createDashboardStatusLoader<number>({ concurrency: 3 });

	loader.schedule(targets);
	loader.schedule(targets.slice(0, 3));
	assert.equal(started, 3);
	assert.equal(maxActive, 3);

	gates[0].resolve(0);
	await flush();
	assert.equal(started, 4);

	for (let index = 1; index < gates.length; index++) {
		gates[index].resolve(index);
		await flush();
	}
	assert.equal(started, 8);
	assert.equal(maxActive, 3);
	assert.deepEqual(applied.sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6, 7]);
});

test("dashboard status loader drops queued and late updates after close", async () => {
	const first = deferred<number>();
	let started = 0;
	let applied = 0;
	const loader = createDashboardStatusLoader<number>({ concurrency: 1 });
	loader.schedule([
		{ key: "first", load: async () => { started += 1; return first.promise; }, apply: () => { applied += 1; } },
		{ key: "second", load: async () => { started += 1; return 2; }, apply: () => { applied += 1; } },
	]);
	assert.equal(started, 1);
	loader.close();
	first.resolve(1);
	await flush();
	assert.equal(started, 1);
	assert.equal(applied, 0);
});
