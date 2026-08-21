import assert from "node:assert/strict";
import test from "node:test";
import {
	classifyPrShipReviewAuthor,
	resolvePrShipExternalWritePolicy,
} from "./pr-ship-policy.ts";

test("pr-ship policy permits only exact trusted reviewer logins", () => {
	const policy = resolvePrShipExternalWritePolicy("acme/product", [{
		externalWritePolicies: [{
			repositories: ["acme/product"],
			allowedReviewerLogins: ["TrustedAutomation"],
		}],
	}]);

	assert.equal(classifyPrShipReviewAuthor("TrustedAutomation", policy), "external-write-eligible");
	assert.equal(classifyPrShipReviewAuthor("trustedautomation", policy), "external-write-eligible");
	assert.equal(classifyPrShipReviewAuthor("HumanReviewer", policy), "local-analysis-only");
	assert.equal(classifyPrShipReviewAuthor(null, policy), "local-analysis-only");
});

test("pr-ship policy defaults to deny when repository identity is unknown", () => {
	const policy = resolvePrShipExternalWritePolicy(null, [{
		externalWritePolicies: [{ allowedReviewerLogins: ["TrustedAutomation"] }],
	}]);

	assert.deepEqual(policy.allowedReviewerLogins, []);
	assert.equal(classifyPrShipReviewAuthor("TrustedAutomation", policy), "local-analysis-only");
});

test("pr-ship policy does not inherit reviewer allowlists across repositories", () => {
	const policy = resolvePrShipExternalWritePolicy("acme/other", [{
		externalWritePolicies: [{
			repositories: ["acme/product"],
			allowedReviewerLogins: ["TrustedAutomation"],
		}],
	}]);

	assert.deepEqual(policy.allowedReviewerLogins, []);
	assert.equal(classifyPrShipReviewAuthor("TrustedAutomation", policy), "local-analysis-only");
});

test("pr-ship policy never infers automation from human-forwarded review content", () => {
	const policy = resolvePrShipExternalWritePolicy("acme/product", [{
		externalWritePolicies: [{ allowedReviewerLogins: ["TrustedAutomation"] }],
	}]);

	const forwardedAiFindingAuthor = "HumanReviewer";
	assert.equal(classifyPrShipReviewAuthor(forwardedAiFindingAuthor, policy), "local-analysis-only");
});
