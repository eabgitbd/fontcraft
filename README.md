# FontCraft

Turn your handwriting into a real font. This one repository builds:

- the **website** (landing page at `/`, the studio at `/app/`, installable, works offline), and
- the **Android app** (APK), from the same code.

You do not need Android Studio. GitHub builds everything for you.

## Steps for the owner

1. **Upload to GitHub.** Create a new repository (public or private). Upload every file, **including the `.github` folder** (it can look hidden). The website upload accepts at most 100 files at a time, so upload in several batches, or use GitHub Desktop, or `git push`. Commit to the `main` branch.
2. **Turn on the website.** In the repository open **Settings → Pages → Build and deployment → Source: GitHub Actions**. The site appears at `https://<username>.github.io/<repository>/`.
3. **Watch the builds.** Open the **Actions** tab. **Build & Deploy Website** and **Build APK app** start on every push to `main`. The first APK build takes about 8–15 minutes.
4. **Get the APK.** Either open the finished **Build APK app** run and download the artifact (a zip that contains `FontCraft.apk`), or open **Releases → latest** and download `FontCraft.apk`. The website's Download button points to that same file.
5. **Install on the phone.** Open the APK on the phone and allow "Install unknown apps" for the app you opened it with.
6. **Recommended: a stable signing key**, so new versions install over old ones.
   - Create a key once, on any computer with Java:
     `keytool -genkeypair -v -keystore fontcraft.keystore -alias fontcraft -keyalg RSA -keysize 2048 -validity 10000`
   - Turn it into text: `base64 -w0 fontcraft.keystore` (Linux, macOS) or `certutil -encode fontcraft.keystore keystore.txt` (Windows; delete the BEGIN and END lines).
   - In **Settings → Secrets and variables → Actions** add four secrets: `KEYSTORE_BASE64`, `SIGNING_STORE_PASSWORD`, `SIGNING_KEY_ALIAS`, `SIGNING_KEY_PASSWORD`.
   - Keep the keystore file and the passwords in at least two safe places. If you lose them the app can never be updated in place. Never upload the keystore to the repository.
7. **Without the key.** The APK still works, but Android will refuse to install a newer build over an older one (the debug signature changes on every build). Export your projects first (Export → Backup), uninstall the old app, then install the new one.
8. **Numbered versions.** Create and push a tag such as `v1.0.0`. The workflow also attaches the APK (and the AAB, if the signing secrets exist) to a versioned release.
9. **If a build fails.** Open the failed run, copy the red error lines, and give them to the AI agent together with `docs/BUILD_PLAN.md`.

## Known limits

- Bengali: automatic conjunct shaping (reph, matra reordering, automatic conjunct formation) is **not** generated. The app supports base letters and conjunct glyphs you draw yourself, exported as ligatures.
- Pressure and tilt need a stylus and a device that reports them. Finger drawing uses simulated pressure.
- APKs signed with the debug key cannot be updated in place (see step 7).
- The AAB for Google Play is produced only when the signing secrets exist.
- iOS is not supported.

## For developers

```
npm install
npm run dev            # http://localhost:5173/app/  (studio)
npm run typecheck
npm test
npm run build:web      # writes dist/      (set BASE_PATH=/repo-name/ for GitHub Pages)
npm run build:android  # writes dist-android/
node scripts/verify.mjs web
node scripts/verify.mjs android
npm run e2e            # optional: real-browser editor and scanner tests (see docs/HANDOFF.md)
```

Hand-off guide: `docs/HANDOFF.md`. Layout, decisions and progress: `docs/BUILD_PLAN.md`, `docs/DECISIONS.md`, `docs/PARITY.md`, `PROGRESS.md`. The original single-file app is kept in `legacy/fontcraft-v3.html`.
