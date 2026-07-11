<div align="center">

# MMusic

**A lightweight desktop music player with a powerful plugin system.**

[![License](https://img.shields.io/badge/license-MIT-blue.svg?style=for-the-badge)](license)

</div>

MMusic is a desktop music app for macOS, Windows, and Linux. It ships with a
flexible plugin system so you can tailor the experience to your taste.

## Features

- 🚫 Built-in ad-blocking
- ⬇️ Download tracks as audio files (mp3 / m4a)
- 🎵 Synced lyrics with romanization
- 🎨 Audio visualizer
- 🎚️ Precise volume, crossfade, audio compressor & equalizer
- 💬 Discord Rich Presence
- ⌨️ Global media shortcuts & system media controls
- 🌗 Themes and visual tweaks
- …and many more plugins

## Download

Grab the latest build from the
[Releases page](https://github.com/maclifevn/MMusic/releases/latest).

### macOS

The macOS build is signed and notarized, so it opens without extra steps.
Requires Apple Silicon (arm64).

## Development

```bash
pnpm install --frozen-lockfile
pnpm dev
```

## Build

```bash
pnpm dist:mac:arm64   # macOS (Apple Silicon)
pnpm dist:win         # Windows
pnpm dist:linux       # Linux
```

## Writing plugins

Create a folder in `src/plugins/YOUR-PLUGIN-NAME` with an `index.ts`:

```typescript
import { createPlugin } from '@/utils';

export default createPlugin({
  name: 'My Plugin',
  restartNeeded: true,
  config: { enabled: false },
  renderer() {
    console.log('hello from the renderer');
  },
});
```

## License

MIT — see the [license](license) file.
