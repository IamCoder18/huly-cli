// Type shims for @hcengineering packages that don't ship .d.ts files.
// These packages are CommonJS; Node's ESM-from-CJS bridge exposes each
// module's `module.exports` as a single default export. Use the default
// import pattern (`import pkg from '@hcengineering/text'`) and destructure
// the needed functions rather than named imports — named imports would
// fail at runtime with "SyntaxError: Named export '...' not found".

// NOTE: This file must stay a "script" `.d.ts` (no top-level imports or
// exports). Once a top-level import/export is added, TypeScript treats the
// file as a module and the `declare module 'foo' { ... }` blocks below
// stop registering new modules for `@hcengineering/*` packages that ship
// no .d.ts. Named types meant to be imported by code live in
// `markup-operations.ts` instead.

declare module '@hcengineering/core' {
  const core: {
    generateId: <T extends { _id: string } = { _id: string }>(join?: string) => string
    [key: string]: unknown
  }
  export default core
}

declare module '@hcengineering/text' {
  const text: {
    htmlToJSON: (html: string) => unknown
    htmlToMarkup: (html: string) => string
    jsonToMarkup: (json: unknown) => string
    markupToJSON: (markup: string) => unknown
    markupToText: (markup: string) => string
    jsonToText: (json: unknown) => string
    [key: string]: unknown
  }
  export default text
}

declare module '@hcengineering/text-core' {
  const textCore: {
    jsonToMarkup: (json: unknown) => string
    markupToJSON: (markup: string) => unknown
    [key: string]: unknown
  }
  export default textCore
}

declare module '@hcengineering/text-markdown' {
  const textMarkdown: {
    markdownToMarkup: (md: string) => string
    markupToMarkdown: (json: unknown, opts?: unknown) => string
    normalizeMarkdown: (md: string) => string
    isMarkdownsEquals: (a: string, b: string) => boolean
    [key: string]: unknown
  }
  export default textMarkdown
}
