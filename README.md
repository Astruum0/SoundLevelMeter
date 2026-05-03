# Sound Level Meter

An Electron sound level meter for live microphone monitoring.

## Downloads

### Mac

Download the macOS `.dmg` from the latest release:

[Download for macOS](https://github.com/Astruum0/SoundLevelMeter/releases/latest)

### Windows

Download the Windows build from the latest release:

[Download for Windows](https://github.com/Astruum0/SoundLevelMeter/releases/latest)

For Windows, the usual format is an installer `.exe`. A `.zip` containing `Sound Level Meter.exe` is also perfectly valid and works as a portable build with no installer.

## Local development

```bash
npm ci
npm run dev
```

## Build commands

```bash
npm run build
npm run dist:mac
npm run dist:win
```

`dist:mac` creates macOS release artifacts.

`dist:win` creates a Windows installer `.exe` and a Windows `.zip` portable build.

## GitHub release flow

This repository includes a GitHub Actions workflow at `.github/workflows/release.yml`.

When you push a tag that starts with `v`, GitHub Actions will:

1. Build macOS release artifacts.
2. Build Windows release artifacts.
3. Create a GitHub Release for that tag.
4. Upload the generated macOS and Windows files to the release assets.
