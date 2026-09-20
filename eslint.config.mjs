import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

const eslintConfig = [
  { ignores: [".agents/**", ".claude/**", ".codex/**", "experiments/**", "docs/**", "test-results/**"] },
  ...coreWebVitals,
  ...typescript,
  {
    files: ["src/features/**/*.{ts,tsx}", "src/shared/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [{
        group: ["@/server/**", "**/server/**"],
        allowTypeImports: true,
        message: "Frontend code may use server types; runtime work belongs behind an HTTP route.",
      }] }],
    },
  },
  {
    rules: {
      "react-hooks/immutability": "off",
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
];

export default eslintConfig;
