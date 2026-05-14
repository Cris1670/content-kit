# Security Policy

Content Kit is pre-alpha software. Please treat browser edit exports, image
uploads, and customer-provided files as untrusted input.

## Supported Versions

Only the latest code on `main` is currently supported. Formal version support
will come later, once the project is less "freshly escaped from the workshop".

## Reporting a Vulnerability

Please do not disclose security issues publicly before they are reviewed.

Use GitHub's private vulnerability reporting or security advisory flow for this
repository if it is available. If that is not available yet, open a minimal issue
that says a security report is available, but do not include exploit details in
the public issue.

## Current CI Security Checks

- `npm audit --audit-level=high` runs in CI.
- ESLint runs static security rules through `eslint-plugin-security`.
- GitHub Dependency Review runs on pull requests and blocks high-severity
  vulnerable dependency changes.
- Package validation checks keep the Chrome extension out of the npm package.
- Extension manifest validation checks the restrictive CSP and local-only
  network model.
