import { dirname } from "node:path";

import { ESLint, Linter } from "eslint";
import tseslint from "typescript-eslint";
import { describe, expect, it } from "vitest";

const root = dirname(import.meta.dirname);

async function problems(code: string): Promise<string[]> {
  const config = (await new ESLint({ cwd: root }).calculateConfigForFile("src/state/example.ts")) as Linter.Config;
  const rule = config.rules?.["no-restricted-syntax"];
  expect(rule, "the store's files keep the rule").toBeDefined();
  const linter = new Linter({ configType: "flat" });
  return linter
    .verify(code, [{ files: ["**/*.ts"], languageOptions: { parser: tseslint.parser }, rules: { "no-restricted-syntax": rule } }], "example.ts")
    .map((problem) => problem.message);
}

describe("the panel slot rule", () => {
  it("refuses a slot write in each form outside the helpers", async () => {
    const writes = [
      "set({ headers: { id, data } });",
      "set({ history });",
      "set((state) => ({ inspection: { id, data: state.x } }));",
      "set((state) => { return { ...state, torrent: { id, data } }; });",
      "useDownloads.setState({ headers: { id, data } });",
      "store.setState((state) => ({ history: { id, data: state.x } }));",
    ];
    for (const write of writes) {
      expect(await problems(write), write).toEqual(["Write a panel slot through loadSlot() or saveSlot(), which check the download on screen."]);
    }
  });

  it("refuses a panel load outside loadSlot, and allows both through the helpers", async () => {
    expect(await problems("void backend.headers(id);")).toHaveLength(1);
    expect(await problems("loadSlot('headers', id, () => backend.headers(id));")).toEqual([]);
    expect(await problems("set({ settings, overlay: null }); set((state) => ({ marked: state.marked }));")).toEqual([]);
  });
});
