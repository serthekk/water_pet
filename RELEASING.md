# Releasing WaterCat

A release is built and published by GitHub Actions (`.github/workflows/release.yml`)
when a version tag like `v0.1.2` is pushed. Installed apps find it within 6 hours (or
right away with right-click → **Check for updates**), download it quietly, and install it
when she quits the app or clicks **Restart to update**.

## Never change these

- `build.appId` in package.json (`com.serthekk.waterpet`): a different appId is a
  different app to Windows, and existing installs stop updating.
- `build.publish` owner / repo (`serthekk` / `water_pet`), and the repo staying **public**:
  the installed apps look for updates exactly there.
- Versions only go **up**. Never re-use or lower a version number (see "Rolling back").

## One-time setup on your PC

```powershell
winget install --id Git.Git -e
winget install --id OpenJS.NodeJS.LTS -e
winget install --id GitHub.cli -e
# new terminal, then:
gh auth login
cd path\to\water_pet
npm ci
pwsh .github/scripts/ensure-electron.ps1   # puts the Electron binary in place
```

## Ship a new version (2 commands)

```powershell
npm run version:patch        # 0.1.0 -> 0.1.1: updates package.json, commits "Release v0.1.1", tags v0.1.1
git push --follow-tags       # pushes the commit + the tag -> the release workflow starts
```

Use `npm run version:minor` for bigger changes (0.1.x -> 0.2.0). Commit your code changes
first: `npm version` refuses to run with uncommitted changes.

Then:

1. Watch it: GitHub → **Actions** → **Release** (about 10 minutes), or `gh run watch`.
   It checks that the tag matches package.json, runs the syntax check and the full
   self-test, builds, and publishes. If any step fails, nothing is released.
2. Check the release page (`gh release view v0.1.1 --web`). It must have 4 files:
   `WaterCat-Setup-0.1.1.exe`, `WaterCat-Setup-0.1.1.exe.blockmap`, `latest.yml`,
   `WaterCat-Portable-0.1.1.exe` (the workflow fails if one is missing or it's a draft).
3. On an installed copy: right-click the cat → **Check for updates** → "Downloading…" →
   "Update ready" → **Restart to update** (or just quit later).

### Beta releases

```powershell
npm version prerelease --preid beta -m "Release v%s"   # e.g. 0.1.2-beta.0
git push --follow-tags
```

The workflow marks it as a GitHub **pre-release** and publishes `beta.yml` instead of
`latest.yml`. Only apps with **Include beta releases** ticked (Customize footer) get it.

## Rolling back a bad release

Users must never be moved to a lower version (the updater refuses downgrades anyway).

1. Stop it spreading: delete the release and its tag.
   ```powershell
   gh release delete v0.1.1 --cleanup-tag --yes
   ```
   Apps that haven't downloaded it yet won't see it any more.
2. Fix the problem (or `git revert` the bad commit), then publish a **higher** version:
   `npm run version:patch` → v0.1.2, `git push --follow-tags`. Apps that already got
   v0.1.1 move to v0.1.2.
3. Never re-publish v0.1.1 or anything lower.

## Testing updates without GitHub

A local fake feed shows every state of the updater without a real release:

```powershell
node tools/update-test-server.js ok        # or: slow | current | fail | badsha
# second terminal:
$env:FORCE_UPDATER = '1'; npm start
```

Right-click the cat → **Check for updates**:

| Mode | You should see |
|---|---|
| `ok` | "Downloading v0.1.1…" then "Update ready (v0.1.1)" + the cat's bubble |
| `slow` | the same, with the download taking ~40 s (menu shows the %) |
| `current` | "You're up to date" |
| `fail` | "Couldn't check right now" (the log says HTTP 500) |
| `badsha` | the download is rejected (checksum mismatch), nothing installs |
| server not running | "Couldn't check right now" (offline) |

The test "installer" is dummy bytes, so in this mode the app never installs it (not on
quit, not on "Restart to update"). The self-test runs these same cases automatically.
`dev-app-update.yml` points the app at the feed; it is never packaged.

## Code signing (later)

Releases are unsigned, so Windows SmartScreen warns on first install ("More info" →
"Run anyway"). Updates still install fine. If a code-signing certificate is added later:

- add the certificate as repository secrets `CSC_LINK` (base64 .pfx) and
  `CSC_KEY_PASSWORD`, and pass them as env to the "Build and publish" step;
- set `build.win.publisherName` in package.json to the certificate's exact subject name.
  electron-updater then refuses any update that isn't signed by that publisher;
- never commit the .pfx or its password.

## Logs

- Installed app: `%APPDATA%\water-cat-tracker\logs\debug.log` (lines starting `updater:`).
- Dev: `logs\debug.log` in the project folder.
