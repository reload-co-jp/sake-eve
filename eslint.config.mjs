import pluginJs from "@eslint/js"
import tseslint from "typescript-eslint"
import pluginReact from "eslint-plugin-react"
import pluginReactHooks from "eslint-plugin-react-hooks"
import jsxA11y from "eslint-plugin-jsx-a11y"
import { fixupConfigRules } from "@eslint/compat"

export default [
  { files: ["**/*.{js,mjs,cjs,ts,jsx,tsx}"] },
  { ignores: [".next", "out", "next-env.d.ts", "next.config.js"] },
  pluginJs.configs.recommended,
  ...tseslint.configs.recommended,
  ...fixupConfigRules(pluginReact.configs.flat.recommended),
  ...fixupConfigRules(jsxA11y.flatConfigs.recommended),
  {
    plugins: {
      "react-hooks": pluginReactHooks,
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
        },
      ],
      "react/react-in-jsx-scope": "off",
      ...pluginReactHooks.configs.recommended.rules,
    },
    settings: {
      react: {
        version: "detect",
      },
    },
  },
]
