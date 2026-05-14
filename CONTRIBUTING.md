# Contributing

Thanks for considering a contribution to Content Kit.

## Project Scope

Content Kit is an offline browser-editing workflow for static and i18n websites.
It should stay portable, local-first, and independent from any hosted CMS,
database, or paid SaaS service.

## Development

Use Node.js 20 or newer.

```sh
npm install
node bin/content-kit.mjs help
```

Run syntax checks before opening a pull request:

```sh
for file in bin/*.mjs src/**/*.mjs chrome-extension/*.js chrome-extension/popup/**/*.js; do node --check "$file" || exit 1; done
```

Check the npm package contents before publishing-related changes:

```sh
npm run pack:check
```

The Chrome extension is intentionally kept in this repository but excluded from
the npm package by the `files` allowlist in `package.json`.

## Code Guidelines

- Keep the CLI dependency-free unless a dependency clearly earns its weight.
- Keep project-specific paths and customer artifacts out of this repository.
- Treat browser edit exports as untrusted input.
- Preserve real UTF-8 content in generated message JSON.
- Keep Chrome extension popup code separated by responsibility:
  - `popup.js` for orchestration
  - `popup/services/` for browser APIs and file access
  - `popup/domain/` for edit data and export logic
  - `popup/shared/` for validation and constants
  - `popup/ui/` for DOM rendering

## Pull Requests

Before submitting:

1. Describe the problem and the behavior change.
2. Include manual test steps or command output.
3. Update `README.md` or `CHANGELOG.md` when behavior changes.
4. Do not include customer edit exports, screenshots with private content,
   `.env` files, `.DS_Store`, or generated archives.
