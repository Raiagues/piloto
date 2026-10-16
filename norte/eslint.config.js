import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ["dist", "coverage", "var"]
  },
  {
    files: ["src/**/*.{ts,tsx}", "tests/**/*.ts", "vite.config.ts"],
    languageOptions: {
      parserOptions: {
        ecmaFeatures: { jsx: true }
      }
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_" }]
    }
  },
  {
    files: ["server/**/*.mjs", "scripts/**/*.mjs", "shared/**/*.mjs", "benchmark/**/*.mjs"],
    languageOptions: {
      globals: {
        Buffer: "readonly",
        TextDecoder: "readonly",
        AbortSignal: "readonly",
        URL: "readonly",
        console: "readonly",
        fetch: "readonly",
        Response: "readonly",
        process: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        performance: "readonly",
        structuredClone: "readonly",
        btoa: "readonly",
        TextEncoder: "readonly"
      }
    }
  }
);
