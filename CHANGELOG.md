# Changelog

All notable changes to this project will be documented in this file.

This project follows semantic versioning where practical.

## [0.3.0] - 2026-09-25

### Added

- `content-kit mcp`: a local, dependency-light MCP server (stdio) for AI agents to find, load, validate, preview, apply and verify catalog copy, plus a drift report for maintenance.
- Preview-then-apply write path with expected revisions, idempotency keys, single-use expiring previews, atomic file replacement and opt-in writable key prefixes.
- ICU-aware validation of placeholders, select choices, formatting tags, invisible characters and length budgets, exported as `@cris1670/content-kit/validation`.
- Project content rules (`rulesFile`): protected terms and forbidden patterns with severity and overridability.

## [0.2.0] - 2026-08-03

### Added

- Opt-in repeatable block duplication and removal using stable item IDs.
- Version 2 browser edit exports with cross-locale structural operations and localized duplicate text overrides.
- Animated pointer and keyboard reordering for complete repeatable collections, with reduced-motion support and strict final-ID validation.
- Popup settings with a persistent, opt-in experimental flag for block ordering.
- Idempotent CLI application and collection limits for block edits.

## [0.1.0] - 2026-05-14

### Added

- Initial Content Kit CLI for applying browser edit exports to message JSON.
- Chrome extension for inline text and image editing on tagged websites.
- JSON edit export/import workflow for offline client review.
- Image replacement import with file type, MIME, signature, and size validation.
- Project config initialization with message folder and locale detection.
- Security guards for untrusted edit files, including path validation and prototype-pollution protection.
- Documentation for setup, client workflow, extension usage, and npm packaging.
