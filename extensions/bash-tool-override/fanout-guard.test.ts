import assert from "node:assert/strict";
import { describe, test } from "node:test";
import registerBashToolOverride from "./index.ts";
import { analyzeValidationFanout, formatValidationFanoutGuardBlock } from "./fanout-guard.ts";

describe("validation fan-out guard", () => {
	test("blocks package script path passed after double dash", () => {
		const block = analyzeValidationFanout(
			"pnpm --dir frontend -F admin test -- src/components/reservation/partner/PartnerReservationListView.utils.test.ts",
		);

		assert.equal(block?.kind, "wrapper-path-after-double-dash");
		assert.equal(block?.script, "test");
		assert.match(block?.suggestion ?? "", /pnpm exec vitest run/);
		assert.match(block?.suggestion ?? "", /PartnerReservationListView\.utils\.test\.ts/);
	});

	test("blocks broad package validation scripts", () => {
		const block = analyzeValidationFanout("pnpm --dir frontend -F admin test");

		assert.equal(block?.kind, "broad-validation-script");
		assert.equal(block?.script, "test");
		assert.match(formatValidationFanoutGuardBlock(block!), /ALLOW_BROAD_VALIDATION=1/);
	});

	test("allows direct executable targeted validation", () => {
		const block = analyzeValidationFanout(
			"cd frontend/apps/admin && pnpm exec vitest run src/components/reservation/partner/PartnerReservationListView.utils.test.ts",
		);

		assert.equal(block, null);
	});

	test("allows changed-file and target-named validation scripts by name", () => {
		assert.equal(analyzeValidationFanout("pnpm lint:changes"), null);
		assert.equal(analyzeValidationFanout("pnpm test:changed"), null);
		assert.equal(analyzeValidationFanout("pnpm test:bash-tool-override"), null);
	});

	test("blocks broad validation script suffixes", () => {
		assert.equal(analyzeValidationFanout("pnpm test:unit")?.kind, "broad-validation-script");
		assert.equal(analyzeValidationFanout("pnpm build:admin")?.kind, "broad-validation-script");
	});

	test("blocks broad turbo validation and wildcard filters", () => {
		assert.equal(analyzeValidationFanout("turbo run test")?.kind, "broad-turbo-validation");
		assert.equal(
			analyzeValidationFanout("turbo run build --filter='@creatrip*'")?.kind,
			"broad-turbo-validation",
		);
	});

	test("allows explicitly filtered turbo validation", () => {
		assert.equal(analyzeValidationFanout("turbo run test --filter=admin"), null);
	});

	test("allows explicit broad validation bypass marker", () => {
		assert.equal(analyzeValidationFanout("ALLOW_BROAD_VALIDATION=1 pnpm --dir frontend -F admin test"), null);
		assert.equal(analyzeValidationFanout("pnpm --dir frontend -F admin test # allow-broad-validation"), null);
	});

	test("registered bash tool blocks risky validation before delegating to builtin bash", async () => {
		let registeredTool: any;
		registerBashToolOverride({
			registerTool(tool: any) {
				registeredTool = tool;
			},
		} as any);

		await assert.rejects(
			() =>
				registeredTool.execute(
					"tool-call-id",
					{
						command: "pnpm --dir frontend -F admin test -- src/foo.test.ts",
						title: "위험한 테스트 명령 실행",
					},
					new AbortController().signal,
					() => undefined,
					{ cwd: "/tmp" },
				),
			/error.*fan-out guard|validation fan-out guard/i,
		);
	});
});