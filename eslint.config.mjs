import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),

  {
    rules: {
      /*
       * A leading underscore means "deliberately unused".
       *
       * The assistant's tool definitions share one signature — run(args, ctx)
       * — and most tools need only one of the two. Those were already written
       * as `_ctx` and `_args`, which is the convention this rule understands
       * everywhere EXCEPT that it was never configured to, so sixteen
       * correctly-marked parameters were reported as mistakes. Real unused
       * variables were then buried in that noise.
       *
       * caughtErrors likewise: `catch { }` is not always available where the
       * binding is required by older syntax, and `catch (_e)` says the same
       * thing deliberately.
       */
      /*
       * An error, not a warning.
       *
       * Every one of these was cleared, and each had been hiding something:
       * a knowledge-base toggle no control called, two screens that looked up
       * an icon and never drew it, a lead-distribution spread fetched and
       * never shown, an unbounded payments query nobody read, and a delete
       * that was handed the file URL and ignored it. A warning is what let
       * them accumulate to fifty-one.
       */
      "@typescript-eslint/no-unused-vars": ["error", {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
        destructuredArrayIgnorePattern: "^_",
        ignoreRestSiblings: true,
      }],
    },
  },
]);

export default eslintConfig;
