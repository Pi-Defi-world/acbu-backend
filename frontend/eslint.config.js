import globals from "globals";
import pluginJs from "@eslint/js";
import tseslint from "typescript-eslint";

export default [
  { 
    ignores: [".next/**", ".kilo/**"] 
  },
  { 
    files: ["**/*.{js,mjs,cjs,ts,jsx,tsx,json}"], 
    languageOptions: { 
      parserOptions: { ecmaFeatures: { jsx: true } }, 
      globals: globals.browser 
    } 
  },
  {
    files: ["*.config.{js,mjs,cjs}", "*.config.*.{js,mjs,cjs}"],
    languageOptions: {
      globals: globals.node,
    },
  },
  pluginJs.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "no-console": ["warn", { "allow": ["warn", "error"] }],
      // Guard against reintroducing the legacy stellar-sdk@13 dependency.
      // All Stellar code must use @stellar/stellar-sdk (v15). See #995.
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "stellar-sdk",
              message:
                "Use @stellar/stellar-sdk (v15) instead of the legacy stellar-sdk package (#995).",
            },
          ],
          patterns: [
            {
              group: ["stellar-sdk/*"],
              message:
                "Use @stellar/stellar-sdk (v15) instead of the legacy stellar-sdk package (#995).",
            },
          ],
        },
      ],
    }
  },
  {
    files: ["lib/logger.ts"],
    rules: {
      "no-console": "off"
    }
  }
];