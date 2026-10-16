import { register } from "node:module";
register(new URL("./pi-host-test-loader.mjs", import.meta.url), import.meta.url);
