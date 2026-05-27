import assert from "node:assert/strict";
import test from "node:test";
import { buildCommitReadinessDiagnostic, formatCommitReadinessDiagnostic, pathsFromGitStatus } from "./commit-readiness.ts";

test("pathsFromGitStatus extracts modified, untracked, and renamed paths", () => {
	assert.deepEqual(pathsFromGitStatus([" M frontend/apps/web/a.tsx", "?? backend/apps/trip/migrations/new.js", "R  old.ts -> frontend/schema.graphql"]), [
		"backend/apps/trip/migrations/new.js",
		"frontend/apps/web/a.tsx",
		"frontend/schema.graphql",
		"old.ts",
	]);
});

test("commit readiness separates commit caveats from ship readiness blockers", () => {
	const diagnostic = buildCommitReadinessDiagnostic([
		"backend/apps/trip/migrations/20260527042440-add-display-author-type.js",
		"frontend/apps/admin/src/components/spotReviews/SpotReviewDetailModal.tsx",
		"frontend/apps/web/domain/travel/subdomain/spot/SpotReviewAdminReply.tsx",
		"frontend/schema.graphql",
	]);

	assert.equal(diagnostic.commitReadiness, "ready_with_caveats");
	assert.equal(diagnostic.shipReadiness, "blocked_by_caveats");
	assert.equal(diagnostic.splitRecommendation, "recommended");
	assert.match(diagnostic.notBlockers.join("\n"), /deferred migration execution/);
	assert.match(diagnostic.notBlockers.join("\n"), /pending UI capture\/verify-report/);
	assert.match(formatCommitReadinessDiagnostic(diagnostic), /Pending|pending|migration/);
});
