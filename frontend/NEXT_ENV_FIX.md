# next-env.d.ts Fix

## Why `next-env.d.ts` Must Not Be Edited Manually

`next-env.d.ts` is **auto-generated** by the Next.js toolchain. It is unconditionally
overwritten on every `next build` and `next dev` invocation. Any changes you make to this
file — custom type declarations, module augmentations, ambient constants — will be
**silently destroyed** the next time a build or dev server starts.

There is no warning, no error, and no diff. The file is simply replaced.

This is by design: Next.js uses `next-env.d.ts` to inject its own internal type references
(such as `Image`, `Link`, and other built-in component types) in a way that is guaranteed
to be correct for the version of Next.js currently installed. It cannot be treated as a
stable file.

## What Happens If You Add Declarations to `next-env.d.ts`

Example scenario:

```typescript
// next-env.d.ts  ← DO NOT EDIT
declare const __COMMIT__: string;  // ← added by a developer
```text

After the next `pnpm dev` or `pnpm build`, the file is regenerated. The declaration is
gone. TypeScript then fails with:

```text
TS2304: Cannot find name '__COMMIT__'
```text

The failure can appear minutes or hours after the edit, and the developer may not connect
the build step to the disappearing declaration. This is a silent footgun.

## Where Manual Ambient Declarations Should Go

All manual ambient type declarations belong in:

```text
types/custom.d.ts
```text

This file lives in the `types/` directory at the project root. Next.js never touches this
directory, so declarations here are permanent and version-controlled correctly. The file is
explicitly included in `tsconfig.json`'s `include` array so TypeScript always picks it up.

**Rule of thumb**: If you are writing `declare module`, `declare const`, or any other
ambient declaration by hand, it goes in `types/custom.d.ts`. Never in `next-env.d.ts`.

## Current Typed Declarations in `types/custom.d.ts`

### CSS Modules

```typescript
declare module "*.css" {
  const styles: { [className: string]: string };
  export default styles;
}
```text

CSS module class names resolve to `string`, not `any`. This means TypeScript will catch
typos in class names when you use `styles.nonExistentClass` — it will be typed as `string`
rather than silently falling through as `any` in strict mode.

### SVG Imports

```typescript
declare module "*.svg" {
  import type React from "react";
  const ReactComponent: React.FunctionComponent<React.SVGAttributes<SVGElement>>;
  export default ReactComponent;
}
```text

SVG files imported via `@svgr/webpack` or `next-svgr` resolve as a typed React functional
component. This gives you full prop-type checking for SVG attributes (`width`, `height`,
`className`, `aria-label`, etc.).

## What To Do When You Need a New Custom Type Declaration

1. Open `types/custom.d.ts`.
2. Add your declaration. Follow the existing patterns for module declarations.
3. Commit the file. TypeScript will pick it up immediately on the next build.

Do **not** create a new `*.d.ts` file in the project root. Do **not** edit `next-env.d.ts`.
Do **not** add new ambient declaration files in `app/` or `src/`. `types/custom.d.ts` is
the single source of truth for manual ambient declarations.

## Fix Summary

Three targeted changes were made to resolve the configuration defects:

### 1. `.gitignore` — Merge Conflict Resolved

The file had an unresolved merge conflict between `HEAD` and `origin/dev` that left literal
`<<<<<<<`, `=======`, and `>>>>>>>` conflict markers in the file. Git was treating the file
as syntactically invalid, which could cause `next-env.d.ts` to be tracked despite the entry
being present in one branch.

The conflict was resolved by merging all unique lines from both branches and discarding the
markers. The `next-env.d.ts` entry in the `# typescript` section above the conflict block
was preserved as-is.

### 2. `types/custom.d.ts` — Created

A new file was created at `types/custom.d.ts` as the canonical, stable home for manual
ambient type declarations. It contains:

- A typed CSS module declaration (`{ [className: string]: string }`)
- A typed SVG module declaration (`React.FunctionComponent<React.SVGAttributes<SVGElement>>`)

The existing `global.d.ts` in the project root has a bare `declare module "*.css"` that
predates this fix. It can coexist without conflict since the declaration in `types/custom.d.ts`
is a superset.

### 3. `tsconfig.json` — `include` Array Updated

Two changes to the `include` array:

- **Removed** `"next-env.d.ts"` — Next.js injects this reference automatically via its
  compiler plugin. An explicit entry is redundant and harmful: in a fresh CI clone where
  `next build` has not yet run, `next-env.d.ts` does not exist, and the explicit entry
  causes `tsc --noEmit` to fail with `TS2307`.
- **Added** `"types/custom.d.ts"` — ensures the new declarations are always in scope
  regardless of build state.

The resulting `include` array is:

```json
[
  "types/custom.d.ts",
  "**/*.ts",
  "**/*.tsx",
  ".next/types/**/*.ts",
  ".next/dev/types/**/*.ts"
]
```text

No `compilerOptions` were changed.

## How To Verify the Fix Works

Run the bug condition test suite:

```bash
pnpm test
```text

Or run just the bug condition file directly:

```bash
pnpm vitest run __tests__/next-env-fix.bug-condition.test.ts
```text

All five assertions should pass:

1. `.gitignore` contains no conflict markers and lists `next-env.d.ts`
2. `types/custom.d.ts` exists
3. `tsconfig.json` `include` does NOT contain `"next-env.d.ts"`
4. A typed SVG declaration (`declare module "*.svg"`) exists
5. A typed CSS declaration with `{ [className: string]: string }` exists

To confirm no TypeScript regressions were introduced:

```bash
pnpm tsc --noEmit
```text

This should exit with code 0.
