# AGENTS.md

Instructions for agents working inside `content-kit/`.

**Purpose**

1. This folder is a reusable offline browser-edit import kit for client-provided website copy.
2. Keep the kit portable across projects. Project-specific paths belong in the consuming app's `content-kit.config.json`.
3. Do not add hosted CMS, database, or online service dependencies here.
4. TSV generation/import is legacy and must not be presented as the client workflow.

**Files**

1. `package.json` and `package-lock.json` make this a standalone local npm package.
2. `bin/content-kit.mjs` is the executable entrypoint.
3. `content-tool.mjs` is a compatibility wrapper around the new modular entrypoint.
4. `src/cli`, `src/config`, `src/edits`, `src/messages`, and `src/utils` own focused implementation areas.
5. Customer edit exports and `CUSTOMER_README.md` belong in the consuming project or customer handoff, not this package.
6. `README.md` is developer-facing package documentation.
7. Consuming apps should use this kit as a local npm package with the correct relative `file:` path and call the `content-kit` binary.
8. Do not add project-specific config or content artifacts back into this package folder.
9. `chrome-extension/` contains the unpacked Chrome extension.
10. Popup code is modular: controller in `chrome-extension/popup.js`, services in `chrome-extension/popup/services`, domain logic in `chrome-extension/popup/domain`, shared validation/constants in `chrome-extension/popup/shared`, and rendering in `chrome-extension/popup/ui`.

**Data Rules**

1. Browser-extension exports are patch files. Apply them with `content-kit apply-edits`.
2. Locale columns and accepted locales must match the consuming app's `content-kit.config.json`.
3. `localePathPattern` must be a JavaScript regex string with a named `locale` capture group for browser-extension language switching.
4. Message JSON output must be UTF-8 and preserve real localized characters such as ä, ö, ü, é, è, ñ, and î.
5. Patch imports must update only provided keys and preserve unrelated messages.

**Customer README Generation**

1. When preparing a customer handoff, create or update the consuming project's `CUSTOMER_README.md`.
2. Base it on the browser-extension workflow and the active project locales.
3. Keep it client-facing only: no npm commands, JSON internals, git instructions, source paths, or AI-agent notes.
4. Include exactly what the customer must return: the final `content-kit-edits-...json` file.
5. Explain how customers share work: load another person's edit JSON in the extension, continue editing, then save/download the combined edit JSON.
6. Keep the tone neutral and practical. Do not mention internal client-management problems.

**Implementation Rules**

1. Prefer standard Node.js APIs. Avoid new dependencies unless the benefit is clear.
2. Keep file operations scoped to paths declared in the consuming app `content-kit.config.json`.
3. Keep errors actionable and tied to edit keys, locales, or file paths.
