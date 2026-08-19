# task1

Electron + React + TypeScript desktop app. Linux Mint 22 (XFCE), Node 20.19+.

## Demo

![demo](demo.mp4)

<video src="demo.mp4" controls width="900"></video>

`demo.mp4` (83s) shows, in order:

1. Creating conversations
2. Sending a message and live token streaming
3. Switching to another conversation mid-stream, then back — the answer kept
   generating while off screen and is still streaming on return
4. `Esc` cancelling a generation, with the partial answer kept and marked
   *partial — stopped before finishing*
5. The Prompt Inspector: budget, per-tier allocation and cascade, degradation
   ladder, exclusions
6. Documents: an indexed Markdown file (`ready`) and a scanned PDF rejected as
   `no text layer`
7. Notes, including a pinned note
8. `Ctrl+K` conversation search
9. The global task tray

## Run

```bash
npm install
npm run dev
```

The app opens on a mock provider — deterministic, offline, no API key.

To use the Ollama community node pool instead:

```bash
TASK1_PROVIDER=ollama npm run dev
```

## Other commands

```bash
npm test           # 243 tests
npm run typecheck
npm run lint
npm run build      # build to out/
npm start          # run the built app
npm run build:linux  # AppImage in release/
```

## Reset

```bash
rm -f ~/.config/task1/task1.db*
```

## Troubleshooting

If the app exits with `Error: Electron uninstall`, the Electron binary did not
download during install:

```bash
node node_modules/electron/install.js
```
