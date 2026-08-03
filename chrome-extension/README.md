# Content Kit Chrome Extension

Client-side browser editor for website text tagged with `data-ck-edit`.

The extension does not call the website API. It stores edits in Chrome extension
storage and can load/save JSON edit files for sharing between reviewers.

## Enable Website Markers

The website must render edit markers before the extension can detect text.
For a Next.js testing environment, this project currently uses:

```env
NEXT_PUBLIC_CONTENT_KIT_BROWSER_EDIT=true
```

Keep the flag disabled on the public production site unless exposing message keys
in `data-ck-edit` attributes is acceptable.

## Enable Repeatable Blocks

Repeatable blocks require an allowlisted `collections` entry in both the
developer config and the browser config embedded by the testing website:

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

Mark each rendered array item with the configured collection, its stable ID,
and its original message path prefix:

```html
<article
  data-ck-block="Team.members"
  data-ck-block-id="member-1"
  data-ck-block-prefix="Team.members[0]"
>
  <h2 data-ck-edit="Team.members[0].name">Ada Example</h2>
</article>
```

Reordering also requires a direct parent collection boundary with the original,
unfiltered item total:

```html
<div data-ck-collection="Team.members" data-ck-collection-total="12">
  <!-- Direct child blocks -->
</div>
```

Controlled string fields such as icon names use an allow-listed picker defined
in the website's Content Kit config. The website references the selection ID:

```html
<div
  data-ck-select="Services.items[0].icon"
  data-ck-select-value="settings"
  data-ck-select-config="technology-icons"
  data-ck-select-scope="all"
></div>
```

Each configured option needs a stable alphanumeric, underscore, or hyphen value
and a short label. The selected value must match an option. Use `scope: "all"`
in the Content Kit config for shared design fields that should change in every
configured locale. Six options are shown per page; larger option sets get
previous/next controls and a current/total page indicator.

In edit mode, drag the Move control to reorder. Surrounding blocks use a short
FLIP transition; Up and Down are keyboard-accessible alternatives. Escape
cancels a drag, and `prefers-reduced-motion` disables drag settling animation.
Reordering is unavailable when fewer original blocks are rendered than the
declared total, such as while a filter is active.

Ordering is experimental and disabled by default. Open the popup settings with
the cog button in the bottom-right corner, then enable **Block ordering** under
Experimental features. Turning it off hides ordering controls and restores the
original rendered order without deleting saved reorder edits.

The block toolbar renders in the browser top layer and automatically chooses an
outside position that stays in the viewport and avoids other marked content. A
block can override auto placement with `data-ck-controls-position="top-start"`,
`top-end`, `bottom-start`, `bottom-end`, `left`, or `right`.

On touch devices, tap once to select a block and reveal its toolbar; the first
tap does not trigger the block's underlying page action.

All locale catalogs must contain matching unique IDs in the same order. Duplicate copies the
matching localized source object in every locale and lets the reviewer edit
marked text in the preview. Remove marks the matching ID for removal from every
locale and remains reversible until import. Images in a duplicated preview can
be replaced after the new block has been imported.

## Load In Chrome

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Choose Load unpacked.
4. Select this repo's `chrome-extension` folder.

## Use

1. Open the testing website.
2. Open the Content Kit extension popup.
3. Turn on the extension with the power button.
4. If you received an edit file, choose Load edits file.
5. Use Page Language to switch between locales.
6. Turn on Edit page text only when you want to edit inline content.
7. Click any outlined text and edit it, click an outlined image to choose a replacement file, click an outlined selection to choose an option, or use Duplicate and Remove on an enabled block.
8. Blur a text field or press Cmd/Ctrl + Enter to save text in the extension.
9. Use Save edits file to update the shared edit file.
10. Use Download all edits or a language button to create a separate copy.

Escape reverts the active field before it is saved.

Edits are kept in Chrome extension storage across refreshes and page changes.
Loading a shared edit file merges it into the local edits and immediately
reapplies those edits to the page.

The power button controls whether saved edits are applied on the page. The Edit
page text toggle only controls inline editing and highlighting.

The Page Language buttons are provided by the website's Content Kit config.
With the default locale path pattern, switching language rewrites the first URL
segment, for example `/en/about` to `/de/about`.

The Edited Content panel is collapsed by default and remembers opened branches.
It shows saved edits for the current page language, grouped by message path.
Enable Show unedited to also include editable text fields from the current page
that have not been changed yet. Yellow dots mark branches that contain changed
text. Click a text entry to open the page where it was edited and scroll to the
matching text.

## Developer Import

After receiving a downloaded edit export, apply it from the consuming app root:

```sh
npm run content:apply-edits -- --input ~/Downloads/content-kit-edits-example-all.json
```

The command patches the configured message JSON files.

## Popup Code Structure

The popup is split into small ES modules:

- `popup.js` wires state, events, and high-level workflows.
- `popup/services/` wraps Chrome APIs, IndexedDB handles, tab messaging, and file operations.
- `popup/domain/` owns edit payload normalization, export building, counts, and tree data.
- `popup/shared/` owns constants, validation, URL safety, image safety, and message-path parsing.
- `popup/ui/` owns DOM lookups and rendering.

Keep new logic in the narrowest module. The popup controller should stay thin
and should not directly own storage, parsing, validation, or rendering details.
