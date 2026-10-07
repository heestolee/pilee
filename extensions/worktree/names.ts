import { randomInt, randomUUID } from "node:crypto";

// Legacy pokemon settings intentionally migrate to words; existing workspace names do not change.
export type WorktreeNamingScheme = "words" | "pokemon" | "city" | "none";

const MODIFIERS = [
	"calm", "quiet", "bright", "swift", "warm", "misty", "sunny", "amber",
	"silver", "coral", "gentle", "crisp", "golden", "soft", "clear", "snowy",
	"blue", "green", "rustic", "merry", "bold", "light", "fresh", "velvet",
];
const NOUNS = [
	"river", "lake", "forest", "hill", "cloud", "moon", "fox", "owl",
	"otter", "falcon", "cedar", "maple", "pine", "brook", "dawn", "fern",
	"meadow", "breeze", "robin", "heron", "finch", "badger", "comet", "reef",
];
export const WORD_NAMES: readonly string[] = MODIFIERS.flatMap((modifier) => NOUNS.map((noun) => `${modifier}-${noun}`));
const CITIES = [
	"manila", "vancouver", "tokyo", "seoul", "paris", "london", "denpasar",
	"chennai", "bandung", "houston", "abuja", "damascus", "zagreb", "douala", "budapest",
	"abu-dhabi", "san-juan", "albuquerque", "kigali", "monrovia", "munich", "madrid",
	"managua", "rabat", "lima", "atlanta", "amarillo", "algiers", "barcelona",
];

// Visit each unsuffixed name once before expanding; a fixed RNG cannot trap us on one name.
export function* worktreeNameCandidates(scheme: WorktreeNamingScheme = "words", start?: number): Generator<string> {
	if (scheme === "none") {
		while (true) yield `wt-${randomUUID()}`;
	}
	const pool = scheme === "city" ? CITIES : WORD_NAMES;
	const offset = start ?? randomInt(pool.length);
	for (let round = 1; ; round++) {
		for (let index = 0; index < pool.length; index++) {
			const name = pool[(offset + index) % pool.length];
			yield round === 1 ? name : `${name}-${round}`;
		}
	}
}

export function conflictingBranch(branch: string, branches: ReadonlySet<string>): string | undefined {
	for (const existing of branches) {
		if (branch === existing || branch.startsWith(`${existing}/`) || existing.startsWith(`${branch}/`)) return existing;
	}
	return undefined;
}
