import assert from "node:assert/strict";
import test from "node:test";
import {
	isDirectPrShipReviewWriteCommand,
	registerPrShipReviewWriteTool,
} from "./pr-ship-write-tool.ts";

function trustedProfiles() {
	return [{ externalWritePolicies: [{ allowedReviewerLogins: ["TrustedAutomation"] }] }];
}

test("pr-ship blocks direct GitHub review writes but permits read-only gh calls", () => {
	assert.equal(isDirectPrShipReviewWriteCommand("gh api repos/acme/product/pulls/7"), false);
	assert.equal(isDirectPrShipReviewWriteCommand("gh api graphql -f query='query { viewer { login } }'"), false);
	assert.equal(isDirectPrShipReviewWriteCommand("gh api repos/acme/product/pulls/7/comments/1/replies --method POST -f body=x"), true);
	assert.equal(isDirectPrShipReviewWriteCommand("gh pr edit 7 --add-reviewer HumanReviewer"), true);
	assert.equal(isDirectPrShipReviewWriteCommand("gh api graphql -f query='mutation { resolveReviewThread(input: {}) { thread { id } } }'"), true);
});

test("guarded pr-ship reply re-fetches and permits only an allowlisted target author", async () => {
	let registeredTool: any;
	const calls: Array<{ command: string; args: string[] }> = [];
	const pi = {
		registerTool(tool: any) {
			registeredTool = tool;
		},
		async exec(command: string, args: string[]) {
			calls.push({ command, args });
			if (calls.length === 1) {
				return {
					code: 0,
					stdout: JSON.stringify({
						user: { login: "TrustedAutomation" },
						pull_request_url: "https://api.github.com/repos/acme/product/pulls/7",
					}),
					stderr: "",
				};
			}
			return {
				code: 0,
				stdout: JSON.stringify({ body: "fixed", html_url: "https://github.com/acme/product/pull/7#discussion_r2" }),
				stderr: "",
			};
		},
	} as any;

	registerPrShipReviewWriteTool(pi, { loadProfiles: trustedProfiles });
	const result = await registeredTool.execute("call", {
		action: "reply",
		repository: "acme/product",
		pullNumber: 7,
		commentId: 1,
		body: "fixed",
	}, undefined, undefined, { cwd: "/tmp" });

	assert.equal(calls.length, 2);
	assert.match(calls[1].args.join(" "), /comments\/1\/replies --method POST/u);
	assert.equal(result.details.author, "TrustedAutomation");
});

test("guarded pr-ship reply rejects a human target before posting", async () => {
	let registeredTool: any;
	const calls: Array<{ command: string; args: string[] }> = [];
	const pi = {
		registerTool(tool: any) {
			registeredTool = tool;
		},
		async exec(command: string, args: string[]) {
			calls.push({ command, args });
			return {
				code: 0,
				stdout: JSON.stringify({
					user: { login: "HumanReviewer" },
					pull_request_url: "https://api.github.com/repos/acme/product/pulls/7",
				}),
				stderr: "",
			};
		},
	} as any;

	registerPrShipReviewWriteTool(pi, { loadProfiles: trustedProfiles });
	await assert.rejects(
		registeredTool.execute("call", {
			action: "reply",
			repository: "acme/product",
			pullNumber: 7,
			commentId: 1,
			body: "do not post",
		}, undefined, undefined, { cwd: "/tmp" }),
		/local-analysis-only/u,
	);
	assert.equal(calls.length, 1);
});

test("guarded pr-ship re-request rejects every non-allowlisted reviewer", async () => {
	let registeredTool: any;
	let execCalled = false;
	const pi = {
		registerTool(tool: any) {
			registeredTool = tool;
		},
		async exec() {
			execCalled = true;
			return { code: 0, stdout: "{}", stderr: "" };
		},
	} as any;

	registerPrShipReviewWriteTool(pi, { loadProfiles: trustedProfiles });
	await assert.rejects(
		registeredTool.execute("call", {
			action: "rerequest",
			repository: "acme/product",
			pullNumber: 7,
			reviewer: "HumanReviewer",
		}, undefined, undefined, { cwd: "/tmp" }),
		/local-analysis-only/u,
	);
	assert.equal(execCalled, false);
});
