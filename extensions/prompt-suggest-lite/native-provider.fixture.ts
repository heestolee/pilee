import { ModelRegistry, ModelRuntime } from "@mariozechner/pi-coding-agent";
import { fauxAssistantMessage, fauxProvider, InMemoryCredentialStore, type SimpleStreamOptions, type TranscriptContext, type Model, type Api } from "@mariozechner/pi-ai";

/** Local native provider only: no credentials on disk, refresh, HTTP, or global API registration. */
export async function nativeProviderFixture(text: string, authAvailable = true) {
	const faux = fauxProvider({ provider: "pi13-fixture", api: "pi13-native-only", tokensPerSecond: Infinity, models: [{ id: "summary", reasoning: true }] });
	const runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null, refreshOnCreate: false });
	const calls: Array<{ context: TranscriptContext; options: SimpleStreamOptions | undefined; model: Model<Api> }> = [];
	let authCalls = 0;
	runtime.registerNativeProvider({
		...faux.provider,
		auth: { apiKey: { name: "Fixture", resolve: async () => {
			authCalls++;
			if (!authAvailable) return undefined;
			return { auth: { headers: { "x-fixture-auth": "local-only" }, baseUrl: "https://fixture.invalid/native" }, env: { FIXTURE_REGION: "local" } };
		} } },
	});
	const registry = new ModelRegistry(runtime);
	const model = runtime.getModel("pi13-fixture", "summary")!;
	// Keep model selection hermetic; the real facade owns streaming and auth.
	registry.getAll = () => [model];
	faux.setResponses([(context, options, _state, requestModel) => {
		calls.push({ context, options, model: requestModel });
		return fauxAssistantMessage(text);
	}]);
	return { registry, model, calls, get authCalls() { return authCalls; } };
}
