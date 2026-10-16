import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("host test aliases use one current SDK, compat API, wildcard exports and TypeBox", () => {
	const register = fileURLToPath(new URL("./pi-host-test-register.mjs", import.meta.url));
	const code = `
import assert from 'node:assert/strict';
import {SessionManager as legacy} from '@mariozechner/pi-coding-agent';
import {SessionManager as current} from '@earendil-works/pi-coding-agent';
import {Type as first} from 'typebox';
import {Type as second} from '@sinclair/typebox';
import {completeSimple} from '@mariozechner/pi-ai';
import * as providers from '@earendil-works/pi-ai/providers/all';
assert.equal(legacy,current); assert.equal(first,second);
assert.equal(typeof completeSimple,'function');
assert.ok(providers); console.log('HOST_ALIAS_OK');
`;
	const result = spawnSync(process.execPath, ["--import", register, "--input-type=module", "-e", code], { encoding: "utf8", timeout: 15_000, env: { ...process.env, PI_OFFLINE: "1" } });
	assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
	assert.match(result.stdout, /HOST_ALIAS_OK/);
});
