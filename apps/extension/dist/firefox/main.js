import { start } from "./background.js";
const scope = globalThis;
const api = scope.browser ?? scope.chrome;
if (api !== undefined)
    start(api, navigator.userAgent);
