import js from "@eslint/js";
import globals from "globals";

export default [
  {
    ignores: ["caderno/vendor/**"],
  },
  js.configs.recommended,
  {
    files: ["caderno/js/**/*.js", "caderno/*.mjs", "netlify/**/*.{js,mjs}", "scripts/*.mjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
    },
    rules: {
      "no-unused-vars": ["error", { "argsIgnorePattern": "^_", "varsIgnorePattern": "^_" }],
    },
  },
  {
    files: ["caderno/js/**/*.js"],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ["caderno/serve.mjs", "netlify/functions/**/*.mjs", "scripts/*.mjs"],
    languageOptions: { globals: { ...globals.node, ...globals.worker } },
  },
  {
    files: ["netlify/edge-functions/**/*.js"],
    languageOptions: { globals: globals.worker },
  },
];
