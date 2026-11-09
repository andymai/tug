import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import jsxA11y from "eslint-plugin-jsx-a11y";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig([
  globalIgnores(["dist", "src-tauri", "src/backend/bindings"]),
  {
    files: ["**/*.{ts,tsx}"],
    extends: [
      js.configs.recommended,
      tseslint.configs.strictTypeChecked,
      reactHooks.configs.flat.recommended,
      jsxA11y.flatConfigs.recommended,
    ],
    rules: {
      "@typescript-eslint/switch-exhaustiveness-check": ["error", { considerDefaultExhaustiveForUnions: false }],
    },
    languageOptions: {
      globals: globals.browser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // Outside `loadSlot` and `saveSlot`, a panel answer could land for a download no longer shown.
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/backend/**", "**/*.test.*", "**/*.visual.*"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression[callee.object.name='backend'][callee.property.name=/^(events|inspect|headers|torrentView)$/]:not(CallExpression[callee.name='loadSlot'] > ArrowFunctionExpression > CallExpression)",
          message: "Load a panel slot through loadSlot() in the store, which drops a late answer.",
        },
        {
          selector: "CallExpression[callee.name='set'] > ObjectExpression > Property[key.name=/^(history|inspection|torrent|headers)$/]",
          message: "Write a panel slot through loadSlot() or saveSlot(), which check the download on screen.",
        },
      ],
    },
  },
]);
