import js from "@eslint/js";
import globals from "globals";

export default [
  {
    ignores: ["caderno/vendor/**", "tests/screenshots/**"],
  },
  js.configs.recommended,
  {
    files: [
      "caderno/js/**/*.js",
      "caderno/*.mjs",
      "netlify/**/*.{js,mjs}",
      "scripts/*.mjs",
      "tests/**/*.js",
      "playwright.config.js",
    ],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
    },
    rules: {
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["caderno/js/**/*.js"],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ["caderno/serve.mjs", "netlify/functions/**/*.mjs", "scripts/*.mjs", "playwright.config.js"],
    languageOptions: { globals: { ...globals.node, ...globals.worker } },
  },
  {
    files: ["tests/**/*.js"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    files: ["netlify/edge-functions/**/*.js"],
    languageOptions: { globals: globals.worker },
  },
];
