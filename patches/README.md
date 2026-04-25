Manual folder-delete cleanup for ThreadKeeper needs a small ST-side patch in addition to the extension files.

This bundle is here:
- [manual-delete-cleanup.patch](C:/Users/water/Desktop/DreamTavern.me/DreamyST/data/default-user/extensions/ST---ThreadKeeper/patches/manual-delete-cleanup.patch)

What it patches in another ST install:
- `public/scripts/extensions.js`
- `src/endpoints/extensions.js`
- `src/util/threadkeeper-cleanup.js` (new file)

What it does:
- Cleans ThreadKeeper data on normal extension uninstall.
- Cleans orphaned ThreadKeeper data on startup if `ST---ThreadKeeper` was manually deleted from the extensions folder.
- Removes `extension_settings.threadkeeper` from `settings.json`.
- Removes `chat_metadata.threadkeeper` from character and group chat `.jsonl` files.

How to apply it in another ST repo:
```bash
git apply path/to/manual-delete-cleanup.patch
```

If the target repo is not a clean Git checkout, apply the changes manually using the same three files above.

After applying:
1. Restart the ST server.
2. Reload the browser.
3. Manual deletion of `ST---ThreadKeeper` will be cleaned up on next startup.

Important:
- This patch is ST-install specific. It does not travel automatically with the extension folder by itself.
- The extension-local uninstall logic still helps for normal in-app uninstall, but manual folder deletion specifically requires this outside-folder patch.
