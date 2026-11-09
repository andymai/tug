import type { Api } from "./api.js";
import { start } from "./background.js";

const scope = globalThis as unknown as { browser?: Api; chrome?: Api };
const api = scope.browser ?? scope.chrome;
if (api !== undefined) start(api, navigator.userAgent);
