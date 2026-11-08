import tailwindcss from "@tailwindcss/vite";
import { playwright } from "@vitest/browser-playwright";
import react from "@vitejs/plugin-react";
import { searchForWorkspaceRoot } from "vite";
import { defineConfig } from "vitest/config";

const scheme = (name: "light" | "dark") => ({
  browser: "chromium" as const,
  name,
  provider: playwright({ contextOptions: { colorScheme: name, locale: "en-US", timezoneId: "UTC" } }),
});

export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    fs: { allow: [searchForWorkspaceRoot(process.cwd())] },
    watch: { ignored: ["**/src-tauri/**"] },
  },
  build: { target: "es2023", outDir: "dist" },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "jsdom",
          setupFiles: ["./src/jsdom-setup.ts", "./src/test-setup.ts"],
          include: ["src/**/*.test.{ts,tsx}"],
        },
      },
      {
        extends: true,
        test: {
          name: "visual",
          include: ["src/**/*.visual.tsx"],
          setupFiles: ["./src/test-setup.ts"],
          browser: {
            enabled: true,
            headless: true,
            viewport: { width: 1100, height: 720 },
            instances: [scheme("light"), scheme("dark")],
            expect: {
              toMatchScreenshot: {
                comparatorName: "pixelmatch",
                comparatorOptions: { threshold: 0.03, allowedMismatchedPixels: 0 },
              },
            },
          },
        },
      },
    ],
  },
});
