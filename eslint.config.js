import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist", "node_modules", "coverage", ".local-backups", "**/*_2604*", "**/*_2605*", "**/*.bak"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["public/lib/**/*.js"],
    languageOptions: {
      globals: {
        AudioWorkletNode: "readonly",
        window: "readonly",
      },
    },
  },
  {
    files: ["**/*.ts"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "no-undef": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          "argsIgnorePattern": "^_",
          "varsIgnorePattern": "^_"
        }
      ]
    },
  }
);
