import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { manifest, type Target } from "../src/manifest.ts";

const root = join(import.meta.dirname, "..");
const dist = join(root, "dist");
const compiled = join(dist, "js");
const brand = join(root, "..", "..", "brand", "png");
const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version: string };

for (const target of ["chromium", "chrome-web-store", "firefox"] satisfies Target[]) {
  const out = join(dist, target);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(join(out, "icons"), { recursive: true });
  for (const file of readdirSync(compiled)) copyFileSync(join(compiled, file), join(out, file));
  for (const size of [16, 32, 48, 128]) {
    copyFileSync(join(brand, `tug-${String(size)}.png`), join(out, "icons", `${String(size)}.png`));
  }
  writeFileSync(join(out, "manifest.json"), `${JSON.stringify(manifest(target, version), null, 2)}\n`);
}
rmSync(compiled, { recursive: true, force: true });
