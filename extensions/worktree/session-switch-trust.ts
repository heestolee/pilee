import type { WorkspaceActivationContract } from "../utils/workspace-activation-contract.ts";
import { withCreatedWorktreeProjectTrust } from "./project-trust.ts";

export async function runWorktreeSessionReplacement<T>(input: {
	activationContract?: WorkspaceActivationContract;
	cwd: string;
	sessionFile: string;
	projectTrustRoot?: string;
	run: () => Promise<T>;
}): Promise<T> {
	if (!input.activationContract) return input.run();
	return withCreatedWorktreeProjectTrust({
		contract: input.activationContract,
		cwd: input.cwd,
		sessionFile: input.sessionFile,
		root: input.projectTrustRoot,
		run: input.run,
	});
}
