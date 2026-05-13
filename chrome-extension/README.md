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
7. Click any outlined text and edit it, or click an outlined image to choose a replacement file.
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
