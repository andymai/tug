import { describe, expect, it } from "vitest";

import { type AddOptions, BackendError, type Settings } from "./backend";
import headerCases from "./contract/headers.json";
import linkCases from "./contract/links.json";
import nameCases from "./contract/names.json";
import ownCases from "./contract/own.json";
import settingsCases from "./contract/settings.json";
import { createMockBackend } from "./mock";

// Each case's outcome comes from Tug's own checks (bridge/contract.rs), so the mock
// must refuse, clean up and word its errors as Tug does.

type Outcome = { ok: unknown } | { error: string };

async function settle(run: () => Promise<unknown>): Promise<Outcome> {
  try {
    return { ok: await run() };
  } catch (error) {
    const failure = BackendError.from(error);
    expect(failure.kind).toBe("invalid");
    return { error: failure.message };
  }
}

const URL = "https://example.org/a.iso";
const NONE: AddOptions = { paused: true, first: false, connections: null, speedLimit: null, name: null, referrer: null, cookies: null, userAgent: null };

describe("the mock keeps Tug's contract", () => {
  it.each(headerCases)("headers $referrer, $cookies, $userAgent", async ({ referrer, cookies, userAgent, outcome }) => {
    const backend = createMockBackend({ seed: [{ url: URL, state: "paused" }] });
    const change = cookies === null ? { kind: "clear" as const } : { kind: "set" as const, value: cookies };
    expect(await settle(() => backend.setHeaders(1, referrer, change, userAgent)), "set").toEqual(outcome);
    const added = await settle(async () => backend.headers((await backend.add(URL, undefined, { ...NONE, referrer, cookies, userAgent })).id));
    expect(added, "add").toEqual(outcome);
  });

  it.each(nameCases)("name $name", async ({ name, outcome }) => {
    const backend = createMockBackend({ seed: [{ url: URL, state: "paused" }] });
    expect(await settle(async () => (await backend.rename(1, name)).name), "rename").toEqual(outcome);
    expect(await settle(async () => (await backend.add(URL, undefined, { ...NONE, name })).name), "add").toEqual(outcome);
  });

  it.each(ownCases)("options $connections, $speedLimit", async ({ connections, speedLimit, outcome }) => {
    const backend = createMockBackend({ seed: [{ url: URL, state: "paused" }] });
    const set = await settle(async () => {
      await backend.setOptions(1, connections, speedLimit);
      return null;
    });
    expect(set, "set").toEqual(outcome);
    const added = await settle(async () => {
      await backend.add(URL, undefined, { ...NONE, connections, speedLimit });
      return null;
    });
    expect(added, "add").toEqual(outcome);
  });

  it("adds each link as Tug does, in order on one list", async () => {
    const backend = createMockBackend();
    for (const { link, outcome } of linkCases) {
      expect(await settle(async () => (await backend.add(link, "/tmp", NONE)).name), link).toEqual(outcome);
    }
  });

  it("starts from the defaults the cases build on", async () => {
    expect({ ok: await createMockBackend().settings() }).toEqual(settingsCases[0]?.outcome);
  });

  it.each(settingsCases.map((entry) => [JSON.stringify(entry.patch).slice(0, 80), entry] as const))("settings %s", async (_, { patch, outcome }) => {
    const backend = createMockBackend();
    const before = await backend.settings();
    const next = { ...before, ...(patch as Partial<Settings>) };
    expect(
      await settle(async () => {
        await backend.updateSettings(next);
        return backend.settings();
      }),
    ).toEqual(outcome);
    if ("error" in outcome) expect(await backend.settings(), "a refused update changes nothing").toEqual(before);
  });
});
