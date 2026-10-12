# Adding plugins, and getting yours listed

## Add a plugin to your ScapeLite

**From a GitHub link** (easiest): open the marketplace → **Add plugin** → **From GitHub**, paste the plugin's repository link (for example `https://github.com/someone/their-plugin`, or a link to a folder inside a repo), and press **Check**. ScapeLite shows you the plugin's name, author and files, and **what its code can do** (for example "makes network requests"). If you are happy, press **Install**. ScapeLite restarts its background service once; the plugin then appears in the marketplace, switched **off**. Press **Add** to turn it on.

**From a folder on your PC**: marketplace → **Add plugin** → **From a folder** → **Open plugins folder**, and drop the plugin's folder in (it must contain a `plugin.json`). Restart ScapeLite once from the tray menu or the dashboard, and it appears in the marketplace.

**Be careful what you install.** Plugins run inside your game page. ScapeLite plugins are meant to be display-only, but only install plugins from people you trust, and read what the check screen tells you. A plugin can be switched off with **Remove** at any time, and deleted with **Uninstall**.

## Get your plugin listed in the marketplace

Anyone can write a plugin (see the [plugin author guide](PLUGIN-AUTHOR-GUIDE.md)) and share the GitHub link; players can install it with the steps above. To be **listed** in the marketplace's *Community plugins* section, so players can find it without a link:

1. **Host your plugin on GitHub** with `plugin.json` and your script(s) at the root of the repository (or in a folder), and a short README that says what it does and what it reads.
2. **Test it** with the steps in the author guide (install from your own link, Add, Remove).
3. **Open a submission**: in the ScapeLite repository, use the *Plugin submission* issue form (or a pull request that adds an entry to `overlay/community.json`, see below).
4. A maintainer **reviews** it. We check that it is display-only, does what it says, does not hide or obfuscate its code, does not send data anywhere without the player's explicit setup, and cleans up after itself.
5. Once approved it is added to the list. Updates to your plugin are picked up from your repository; a significant change (new permissions, new network use) may be re-reviewed.

### `community.json` entry

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "author": "your name",
  "description": "One or two sentences.",
  "repo": "https://github.com/you/my-plugin",
  "tags": ["xp", "tooltips"]
}
```

### What gets a plugin rejected or removed
- Anything that clicks, selects or otherwise **acts in the game** for the player.
- Hidden or minified-to-hide code, remote code loading, data collection or tracking.
- Impersonating the Scapewatch developers or ScapeLite, or misleading names/descriptions.
- Breaking other plugins or the game, or ignoring the performance advice in the author guide.

Plugins are listed on trust and good faith; we can delist anything that turns out to break these rules.
