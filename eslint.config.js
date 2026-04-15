import tseslint from "typescript-eslint";
import globals from "globals";
import { defineConfig } from "eslint/config";
import noUnsanitized from "eslint-plugin-no-unsanitized";

export default defineConfig(
  {
    ignores: ["dist/**", "node_modules/**"],
  },
  ...tseslint.configs.recommended,
  noUnsanitized.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.es2024,
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/consistent-type-imports": "error",
      "no-console": "warn",
    },
  },
);
