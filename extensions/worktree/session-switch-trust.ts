import type { WorkspaceActivationContract } from "../utils/workspace-activation-contract.ts";
import { withCreatedWorktreeProjectTrust } from "./project-trust.ts";

type SessionSwitchResult = { cancelled?: boolean };

type SessionSwitchContext<TOptions> = {
	switchSession?: (sessionPath: string, options?: TOptions) => Promise<SessionSwitchResult>;
};

export async function switchSessionToTrustedWorktree<TOptions>(input: {
	context: SessionSwitchContext<TOptions>;
	sessionFile: string;
	cwd: string;
	switchOptions: TOptions;
	activationContract?: WorkspaceActivationContract;
	projectTrustRoot?: string;
}): Promise<void> {
	const switchSession = input.context.switchSession;
	if (typeof switchSession !== "function") throw new Error("switchSession API가 없습니다");
	const run = () => switchSession.call(input.context, input.sessionFile, input.switchOptions);
	if (!input.activationContract) {
		await run();
		return;
	}
	await withCreatedWorktreeProjectTrust({
		contract: input.activationContract,
		cwd: input.cwd,
		sessionFile: input.sessionFile,
		root: input.projectTrustRoot,
		run,
	});
}
