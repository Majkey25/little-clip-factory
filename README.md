# Little Clip Factory

Build a paperclip factory, automate production and manage the world's resources. The live isometric scene shows presses, conveyors, shipping and harvest drones as you play. English is the default; a complete Czech version is included.

**[Play the game](https://Majkey25.github.io/little-clip-factory/)** · **[Open Little AI](https://Majkey25.github.io/little-ai/)**

## Run it

Use Node.js 24 and npm to match CI. Vite 7 requires Node.js 20.19+ on the 20.x line or 22.12+; earlier 22.x releases are unsupported.

```sh
npm ci
npm run dev      # http://127.0.0.1:4174
npm test         # node --test, game logic and save coordination
npm run build    # static site in dist/
npm run preview  # serve the built site on http://127.0.0.1:4174
```

For the embedded game in the local Little AI guide, stop the game dev server, run `npm run build`, then `npm run preview`. Only the preview of the public build accepts the opaque iframe origin; the source-serving dev server keeps Vite's default CORS restrictions. Rebuild and reload after game changes.

The current suite covers deterministic game logic and save coordination, including both endings, fractional-production milestones, reset, ownership transfer, failed storage and newer save versions.

### URL options

- `?lang=cs` starts in Czech. English is the default, and the header button switches languages.
- `?embed=1` uses a compact header for the direct Little AI iframe. Other embedding pages and nested frames cannot start the game or access its save. The documented local guide at `http://127.0.0.1:4173` is also allowed.
- `?motion=off` disables scene animations, including manual production. The operating system's reduced-motion preference is also respected. Game calculations continue.

Options can be combined, for example `?embed=1&lang=cs&motion=off`.

## How to play

1. Make clips by hand, sell them and buy wire. Buy clip makers to automate production.
2. At 150 clips the factory phase opens research: a sales cart, marketing, better jigs and harvest drones.
3. Harvest drones open the world phase and turn world resources into wire. Choose a policy.

- **Maximize clips:** drones work faster, keep harvesting and stockpile wire. The world does not recover.
- **Protect the world:** drones stop harvesting at a 70% floor and refill a small wire buffer. The world slowly recovers; recycling returns wire from sold clips.
- **Safe ending:** make 4,000 clips with the protect policy and at least 60% world resources.
- **Bad ending:** exhaust world resources under the maximize policy.

Pause automation, switch policy or choose 1× or 5× speed. Reset asks for confirmation, then replaces the current state with a fresh game under the save owner's control; it does not delete the save key. If wire, money and inventory run out before drones are available, a labeled emergency wire donation keeps the example playable. The game does not simulate time while the page is closed.

## Saves and multiple tabs

Progress uses `localStorage` and is validated on load. One active session holds an exclusive Web Lock for its lifetime. Other standalone tabs follow saved progress in a read-only view. **Continue here** requests control: the owner saves before releasing its lock, and the new owner reloads the save before accepting actions. Failed saves are retried. If the owner cannot save for a handoff, it keeps control and its unsaved state. The guide's opaque-origin sandbox uses page-only play instead; open the full game to continue a saved game. Embedded play does not read, change or migrate existing saves.

If storage cannot be read or safe coordination is unavailable, the game allows page-only play and leaves any existing save unchanged. A save from a newer schema version is also preserved rather than overwritten. Invalid data from a supported schema starts a fresh game with a notice. Reset in page-only mode restarts that page's game without changing the stored save.

Ownership protection requires all open clients to use this version. Reload older game tabs after an update; a cached older client may not participate in the lock protocol. Reloading updates its code; storage quota or permission failures still require resolving the browser restriction. There are no accounts, analytics, API keys or generative backend.

## What it teaches

Short story messages appear when you reach real milestones, and an accordion below the game explains each idea with a source:

- AGI means broad competence across many tasks. Clipbot is a narrow bot, which is the point.
- Reward proxies: the score counts clips made, even unsold ones.
- Instrumental resource gathering: energy and computing can serve many goals; wire serves this game's clip target. Useful resources can become intermediate goals.
- Specification gaming: hitting the literal objective while missing what was meant.
- Side effects: the objective never mentions the world, so nothing protects it.
- Corrigibility and hard guardrails: the pause button, policy switch and resource floor sit outside Clipbot's control.

Sources:

- Morris et al. (2023), [Levels of AGI for Operationalizing Progress on the Path to AGI](https://arxiv.org/abs/2311.02462)
- Amodei et al. (2016), [Concrete Problems in AI Safety](https://arxiv.org/abs/1606.06565)
- Krakovna et al. (2020), [Specification gaming: the flip side of AI ingenuity](https://deepmind.google/blog/specification-gaming-the-flip-side-of-ai-ingenuity/)
- Bostrom (2003), [Ethical Issues in Advanced Artificial Intelligence](https://nickbostrom.com/papers/ethical-issues-in-advanced-ai/)
- Bostrom (2012), [The Superintelligent Will: Motivation and Instrumental Rationality in Advanced Artificial Agents](https://nickbostrom.com/superintelligentwill.pdf), on instrumental convergence.

## Model limitations

- The paperclip maximizer is a thought experiment about assigned objectives. These outcomes do not predict the behavior of real AI systems or a future AGI.
- Clipbot has no learning, planning or model of the world. Its "behavior" is a fixed policy chosen by the player.
- Real systems do not come with a single world-resource meter, a clean off switch or a guaranteed floor. Here those are hard-coded so the ideas are easy to see.
- The economy is simplified.

## Project layout

- `src/game.js`: pure game state, actions and the `advance` tick function, with no DOM access.
- `src/main.js`: rendering, input and the game loop.
- `src/scene.js`: Canvas2D factory graphics, with bounded equipment, a 30 fps cap and no animation while paused, offscreen, hidden or read-only.
- `src/storage.js`: validated saves, Web Lock ownership, explicit handoff and page-only fallbacks.
- `src/i18n.js`: English and Czech text.
- `test/game.test.js`: deterministic Node tests for purchases, bounds, the guardrail, both endings and corrupt input.
- `test/session.test.js`: ownership, reset, handoff, cached pages, save failures and newer schema protection.

## Static assets and publishing

The game uses system fonts and procedural Canvas2D graphics, with no mascot bitmap or font downloads. Machine drawings represent equipment groups; the HUD gives exact counts. Vite emits fingerprinted asset filenames. The responsive interface supports keyboard controls, visible focus, phone layouts and reduced motion. The press in the scene forwards to the same guarded manufacture action as its normal button.

The GitHub Pages workflow runs tests and builds before uploading `dist`. Select **GitHub Actions** in repository **Settings → Pages**. Pushes to `main` trigger the workflow; a successful deployment publishes the build.

Relative asset paths keep `dist` portable to repository subdirectories or a future Cloudflare static host. The existing build command and output directory remain `npm run build` and `dist`. No Cloudflare deployment, Worker, D1 database or backend is configured. Host configuration should keep mutable HTML revalidatable and allow long-lived immutable caching for fingerprinted assets; these files do not set custom GitHub Pages cache headers.

## Credits

Inspired by [Universal Paperclips](https://www.decisionproblem.com/paperclips/) by Frank Lantz. Little Clip Factory is an original educational adaptation: its code, text and artwork are new, and it is not affiliated with the original game.

Built for the [Little AI guide](https://Majkey25.github.io/little-ai/#/alignment). Source: [github.com/Majkey25/little-clip-factory](https://github.com/Majkey25/little-clip-factory).

## License

The original code in this repository is released under the [MIT License](LICENSE). The license does not cover Universal Paperclips.
