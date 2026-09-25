# Content Kit 📝✨

[![CI](https://github.com/Cris1670/content-kit/actions/workflows/ci.yml/badge.svg)](https://github.com/Cris1670/content-kit/actions/workflows/ci.yml)

Content Kit is an offline browser-editing workflow for static and i18n websites.
Clients edit text and images on a tagged testing website with the Chrome
extension, share a JSON edit file, and the developer applies that file locally
with the Node CLI.

The first implementation is compatible with
[`next-intl`](https://next-intl.dev/) style JSON message catalogs, because
`next-intl` is excellent and already does the hard internationalization work
that this tool very much does not want to reinvent. Content Kit is not an
official `next-intl` project and is not affiliated with, endorsed by, or
maintained by the `next-intl` maintainers. More adapters are planned for future
versions.

No CMS, login, online editor, or paid service is required. Just a browser,
a JSON file, and the quiet hope that nobody asks for a "quick copy round" at
5:58 PM.

## Status: Pre-Alpha With A Tiny Helmet 🚧

Content Kit is currently a pre-alpha project. It works, it has guardrails, and
it has already survived the first wave of "please just change this one sentence"
energy. Still, treat it like a useful power tool from a garage workshop: keep
backups, review diffs, and do not point it at your production content while
blindfolded.

## Disclaimer 🧃

This is a heavily vibe-coded tool born from the very specific frustration of
clients who did not want a CMS, did not want another online tool, but still
wanted every content change to happen immediately and somehow not in code.

Use it pragmatically, review its output, and keep backups of your content files.
No warranty is provided, and the author takes no liability for broken builds,
lost edits, confused reviewers, cursed JSON, or the ancient ritual of "just one
small text change".

## Contributing 🛠️

Pull requests are welcome. Reviews may take a bit, because this is currently a
solo-maintainer operation and the maintainer is also probably building the thing
that the content was supposed to go into. Small, focused PRs with clear test
steps have the best chance of escaping the queue before the next content meeting.

## Credits 🌍

Content Kit currently targets JSON message catalogs shaped for
[`next-intl`](https://next-intl.dev/). Credit where it is due:
[`next-intl`](https://github.com/amannn/next-intl) handles the serious i18n
machinery for Next.js; Content Kit is just the small offline editing sidecar
that tries to keep content meetings from becoming a lifestyle.

`next-intl` is MIT licensed. Content Kit does not copy or bundle `next-intl`
code; it only works with the message catalog shape used by `next-intl` projects.

## Client Workflow 🧑‍💻

Send the client:

- the Content Kit Chrome extension
- the testing website URL with edit markers enabled
- the project `CUSTOMER_README.md`

Client rules:

1. Open the testing website.
2. Turn on the extension with the power button.
3. Use the language switcher in the extension when reviewing each locale.
4. Turn on Edit page text only while editing inline copy.
5. Edit outlined text directly, replace outlined images, or use Duplicate and Remove on enabled repeatable blocks.
6. Save/load the shared edit JSON file from the extension popup.
7. Return the final `content-kit-edits-...json` file.

## Developer Commands ⚙️

Run commands from the consuming app.

```sh
npm run content:init
npm run content:apply-edits -- --input ~/Downloads/content-kit-edits-example-all.json
```

Those aliases can use the published package:

```sh
npm install -D @cris1670/content-kit
```

During local development before publishing a change, use a local package
dependency with the correct relative path:

```json
"@cris1670/content-kit": "file:../../content-kit"
```

### Browser Marker Helper

The package owns the browser marker contract. A consuming app can import the
generic marker factory from `@cris1670/content-kit` and keep its own
visual components free of Content Kit-specific types and rendering behavior:

```js
import { createContentKitMarkers } from '@cris1670/content-kit';

const { edit, image, block, collection } = createContentKitMarkers({
  enabled: true
});
```

The helper only returns `data-ck-*` attributes. Icon components, design-system
components, and other presentation details remain the responsibility of the
consuming app.

`apply-edits` applies a browser-extension JSON edit export as a patch. It
updates only the edited message keys and preserves unrelated messages.

Run package checks from this repo:

```sh
npm test
npm run format
npm run audit:ci
npm run pack:check
```

`npm test` runs Prettier in check mode, ESLint with static security rules, unit
tests, syntax checks, package metadata checks, and Chrome extension manifest
safety checks. CI also runs dependency auditing, Dependency Review on pull
requests, and the npm package dry-run.

## AI Agents (MCP) 🤖

`content-kit mcp` serves the configured message catalogs to an AI agent over the
[Model Context Protocol](https://modelcontextprotocol.io/) (stdio). It runs
locally next to the working tree, needs no network access, and has no
dependencies beyond the ICU message parser.

Register it with an MCP client from the consuming app directory:

```json
{
  "mcpServers": {
    "content-kit": {
      "command": "npx",
      "args": ["content-kit", "mcp", "--config", "content-kit.config.json"]
    }
  }
}
```

Writes are off until the config lists the keys editors may change:

```json
{
  "rulesFile": "content-rules.json",
  "mcp": {
    "writableKeys": ["Profile", "Marketing.hero"],
    "readOnlyKeys": ["Profile.legal"]
  }
}
```

A key is writable when it starts with an entry in `writableKeys` and with none
in `readOnlyKeys`. Only existing text messages of the base locale can be
changed or translated; new keys stay a developer task.

| Tool                      | Writes | Purpose                                                      |
| ------------------------- | ------ | ------------------------------------------------------------ |
| `discoverContentSurfaces` | no     | Locales, writable keys and available capabilities            |
| `resolveContentAuthority` | no     | Which file owns a key and whether it is writable             |
| `findContentItems`        | no     | Search keys and texts                                        |
| `loadContentItem`         | no     | A key in every locale, with its revision                     |
| `getApplicableRules`      | no     | Built-in checks and the project's content rules              |
| `getContentLifecycle`     | no     | Working tree → commit → merge → deploy, and who does each    |
| `validateContent`         | no     | Check a proposed value                                       |
| `previewContentChange`    | no     | Dry run: exact before/after, blockers, exceptions, previewId |
| `applyApprovedChange`     | yes    | Write exactly an approved preview                            |
| `verifyAppliedChange`     | no     | Re-read and confirm the approved values                      |
| `findContentDrift`        | no     | Missing, identical-to-source and invalid translations        |

The write path is guarded end to end:

- `applyApprovedChange` takes only a `previewId`, never text, so what is
  written is exactly what the editor saw. Previews expire after 30 minutes and
  can be applied once.
- Every change carries the `expectedRevision` returned by `loadContentItem`.
  If any targeted message changed in the meantime, nothing is written.
- An `idempotencyKey` makes retries safe; reusing it for another preview fails.
- Placeholders, ICU syntax, select choices and formatting tags must match the
  base locale. Invisible control and bidi-override characters are refused.
- Files are replaced atomically and symbolic links are refused.
- The server never commits, pushes or deploys. Review the diff as usual.

### Content Rules

`rulesFile` points to project rules that `validateContent`, previews and
`findContentDrift` enforce:

```json
{
  "version": 1,
  "rules": [
    {
      "id": "protected-product-names",
      "type": "protectedTerms",
      "terms": ["Acme Cloud"],
      "severity": "error",
      "overridable": false,
      "message": "Product names are never translated."
    },
    {
      "id": "en-ellipsis-character",
      "type": "forbiddenPattern",
      "pattern": "\\.\\.\\.",
      "locales": ["en"],
      "severity": "error",
      "overridable": false,
      "message": "Use the ellipsis character."
    }
  ]
}
```

`protectedTerms` must survive translation when the source contains them.
`forbiddenPattern` is a regular expression (flags `i`, `m`, `s`; always
Unicode). An error with `overridable: false` blocks a change; an overridable
one needs an exception reference in `applyApprovedChange`, which the agent
obtains through the project's exception process.

The same validation is available to other Node code:

```js
import {
  loadContentRules,
  validateContentValue
} from '@cris1670/content-kit/validation';
```

## Package Structure 📦

```text
bin/content-kit.mjs        # executable entrypoint
chrome-extension/          # unpacked Chrome extension
content-tool.mjs           # compatibility wrapper
src/browser/               # framework-agnostic browser marker helpers
src/cli/                   # command parsing and dispatch
src/config/                # config loading and project detection
src/edits/                 # browser edit export normalization and applying
src/mcp/                   # MCP stdio server and catalog tools
src/messages/              # message key path parsing and catalog patching
src/utils/                 # JSON, filesystem, and error helpers
src/validation/            # ICU, placeholder and content-rule validation
```

## Configuration 🧭

Project-specific paths live in the consuming app's `content-kit.config.json`.
The file is generated by the consuming app's `postinstall` script:

```json
"postinstall": "content-kit init --install"
```

If the file is missing, generate it manually from the consuming app root:

```sh
npm run content:init
```

The initializer detects paths it can read and logs setup hints at the end. If
detection fails, it writes defaults and tells you which fields need review.

```json
{
  "locales": ["en", "de", "fr", "it"],
  "baseLocale": "en",
  "collections": {},
  "imagePublicPath": "/content-kit-images",
  "imagesDir": "public/content-kit-images",
  "localePathPattern": "^/(?<locale>[A-Za-z]{2})(?<rest>/.*)?$",
  "messagesDir": "messages"
}
```

`imagesDir` is where imported image files are written. `imagePublicPath` is the
public URL prefix stored back into message JSON for those image replacements.

`localePathPattern` is a JavaScript regex string used by the browser extension
to find the language segment in the current URL. It must include a named
`locale` capture group. For example, `^/(?<locale>[A-Za-z]{2})(?<rest>/.*)?$`
matches routes like `/en/about` and lets the extension switch to `/de/about`.

### Repeatable Blocks

Content Kit can duplicate, remove, and reorder opt-in array items that have stable IDs.
Structural changes apply to every configured locale, while text overrides on a
duplicated block remain locale-specific.

Configure each allowed collection explicitly:

```json
{
  "collections": {
    "Team.members": {
      "idField": "id",
      "minItems": 1,
      "maxItems": 50,
      "operations": ["duplicate", "remove", "reorder"]
    }
  }
}
```

Every locale must contain the collection as an array, and corresponding items
must use the same unique string IDs in the same order. The browser-facing Content Kit config must
include the same `collections` object. Mark each rendered item with its
collection, stable ID, and original array-item path:

```html
<article
  data-ck-block="Team.members"
  data-ck-block-id="member-1"
  data-ck-block-prefix="Team.members[0]"
>
  <h2 data-ck-edit="Team.members[0].name">Ada Example</h2>
</article>
```

Wrap the rendered blocks in a collection boundary. The total is the unfiltered
number of original items, so Content Kit can disable reordering when the page is
showing only a filtered subset:

```html
<div data-ck-collection="Team.members" data-ck-collection-total="12">
  <!-- Direct child blocks -->
</div>
```

For controlled string fields such as an icon name, define the allow-listed
options once in `content-kit.config.json`. The consuming app only references
that selection by ID; Content Kit shows the configured options in a compact
picker and saves the selected value as a normal message edit:

```json
{
  "selections": {
    "technology-icons": {
      "scope": "all",
      "options": [
        {
          "label": "Settings",
          "value": "settings",
          "icon": "/content-kit-icons/settings.svg"
        },
        { "label": "Workflow", "value": "workflow" }
      ]
    }
  }
}
```

The selection marker only needs the config ID:

```html
<div
  data-ck-select="Services.items[0].icon"
  data-ck-select-value="settings"
  data-ck-select-config="technology-icons"
  data-ck-select-scope="all"
></div>
```

Option values must be stable alphanumeric, underscore, or hyphen identifiers.
The current value must match one of the configured options. Set `scope` to
`"all"` for shared design fields that must be updated in every configured
locale. `icon` is optional; when supplied, it must be a same-origin absolute
path to an SVG file. It is used in the picker and to replace the visible icon
after selection. Selection fields inside duplicated blocks can be changed before import
just like text fields. The picker displays six options at a time and adds
previous/next page controls with a page count when more options are available.

In edit mode, the extension adds Move, Up, Down, Duplicate, and Remove controls
for the operations enabled by the collection config. Dragging uses a direct
pointer-following preview and a short FLIP transition for surrounding blocks.
Up and Down provide instant keyboard reordering, Escape cancels an active drag,
and reduced-motion preferences disable the lift and settling animations. Duplicate
creates an in-browser preview and supports editing its marked content fields.
Images inside a duplicated preview retain the source image; import the block
before replacing that new image. Remove stays visible as a reversible preview
until the edit export is applied.

Ordering is an experimental browser feature and is off by default. Enable it
from the cog button in the popup footer. Disabling it restores the original
rendered order and hides Move, Up, and Down without deleting saved reorder edits.

Block action controls render outside the edited block by default. Content Kit
automatically chooses among top, bottom, left, and right placements, avoids other
marked content, stays within the viewport, and repositions on scroll or resize.
For an unusual layout, set `data-ck-controls-position` on the block to `auto`,
`top-start`, `top-end`, `bottom-start`, `bottom-end`, `left`, or `right`:

```html
<article
  data-ck-block="Projects.items"
  data-ck-block-id="project-1"
  data-ck-block-prefix="Projects.items[0]"
  data-ck-controls-position="bottom-end"
></article>
```

On devices without hover, the first tap selects a block and reveals its toolbar
without triggering the block's underlying link or card action. Only one block
toolbar is shown at a time.

Block edits are idempotent. This allows separate language edit files to carry
the same structural operation without duplicating or removing the block twice.

To reuse this kit for another project before npm publishing, add this repo as a
local package dependency with the correct relative `file:` path, run
`npm install`, and review the generated `content-kit.config.json`.

## Security Model 🔒

Treat browser edit exports as untrusted input.

- CI runs on pull requests, pushes to `main`, and release tags matching `v*`.
- High-severity dependency audits, static security linting, and Dependency
  Review are part of the release gate.
- The Chrome extension uses a restrictive Manifest V3 CSP, local scripts only,
  and no remote network calls.
- Extension UI is built with DOM APIs and `textContent`, not `innerHTML`,
  `document.write`, `eval`, or remote code.
- Edit-tree navigation only opens same-origin HTTP(S) URLs for the active
  project.
- Image edits allow only PNG, JPEG, GIF, and WebP files up to 5 MB. The
  extension validates extension, MIME type, and file signature before previewing.
- The importer validates image data URLs again, verifies file signatures,
  generates UUID-based filenames, and writes only below the configured
  `imagesDir`.
- Message paths reject prototype-pollution keys such as `__proto__`,
  `constructor`, and `prototype`, and cap array indexes to avoid sparse-array
  denial-of-service cases.
- Block operations are limited to explicitly configured collections, preserve
  stable IDs, and enforce per-collection minimum and maximum item counts.
- Reorder imports must contain the exact final ID set after duplicates and
  removals, preventing stale or filtered orders from dropping items.
- The MCP server reads and writes only the configured locale files, is
  read-only unless `mcp.writableKeys` is set, validates every tool argument
  against its advertised schema, and writes only previously previewed changes
  under a revision guard (see [AI Agents](#ai-agents-mcp-)).
