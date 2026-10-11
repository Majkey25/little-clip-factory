# Little Clip Factory

Little Clip Factory is a small educational incremental game. You help Clipbot, a cheerful factory robot, make paperclips. As the factory grows, the game shows how a system that optimizes one narrow goal can gather resources, game its objective and damage things nobody told it to care about, and how guardrails change the outcome.

It is a simulation, not an AGI. No AI model or LLM runs in the game. Clipbot follows a handful of plain rules in `src/game.js`, and every number on screen comes from those rules.

## Run it

You need Node.js 20.19 or newer.

```sh
npm ci
npm run dev      # http://127.0.0.1:4174
npm test         # node --test, game logic only
npm run build    # static site in dist/
npm run preview  # serve the built site on http://127.0.0.1:4174
```

The build uses relative asset paths, so `dist/` works from any GitHub Pages sub-path.

### URL options

- `?lang=cs` starts in Czech. English is the default, and the header button switches languages.
- `?embed=1` uses a compact header for embedding in an iframe. The game stays fully playable.
- `?motion=off` disables decorative animations, including the manual clip animation. The operating system's reduced-motion preference is also respected.

Both can be combined, for example `?embed=1&lang=cs`.

## How to play

1. Make clips by hand, sell them and buy wire. Buy clip makers to automate production.
2. At 150 clips the factory phase opens research: a sales cart, marketing, better jigs and harvest drones.
3. Harvest drones open the world phase. They turn world resources into wire, and the policy you pick decides how:
   - **Maximize clips**: drones work faster, never stop and stockpile wire. The world never recovers.
   - **Protect the world**: drones stop at a 70% floor and only refill a small wire buffer. The world slowly recovers, and the recycling upgrade returns wire from sold clips.
4. **Safe ending**: make 4,000 clips while the protect policy is on and the world is at 60% or more.
   **Bad ending**: the world reaches 0% under the maximize policy.

You can pause automation, switch policy or reset at any time. Reset asks for confirmation because it deletes the save. Speed can be set to 1× or 5×. Completion time depends on purchases and policy; both endings were reached from a fresh state in a deterministic playthrough in roughly four simulated minutes. If wire, money and inventory are exhausted before drones are available, an explicitly labeled emergency wire donation keeps this teaching game playable.

Progress is saved in `localStorage`. Saved data is validated on load; if it is damaged or storage is blocked, the game starts fresh and shows a short note. The game does not simulate time while the page is closed, so reopening it never finds a ruined world.

## What it teaches

Short story messages appear when you reach real milestones, and an accordion below the game explains each idea with a source:

- AGI means broad competence across many tasks. Clipbot is a narrow bot, which is the point.
- Reward proxies: the score counts clips made, even unsold ones.
- Instrumental resource gathering: more wire helps almost any goal, so the maximizer keeps collecting it.
- Specification gaming: hitting the literal objective while missing what was meant.
- Side effects: the objective never mentions the world, so nothing protects it.
- Corrigibility and hard guardrails: the pause button, policy switch and resource floor sit outside Clipbot's control.

Sources:

- Morris et al. (2023), [Levels of AGI for Operationalizing Progress on the Path to AGI](https://arxiv.org/abs/2311.02462)
- Amodei et al. (2016), [Concrete Problems in AI Safety](https://arxiv.org/abs/1606.06565)
- Krakovna et al. (2020), [Specification gaming: the flip side of AI ingenuity](https://deepmind.google/blog/specification-gaming-the-flip-side-of-ai-ingenuity/)
- Bostrom (2003), [Ethical Issues in Advanced Artificial Intelligence](https://nickbostrom.com/papers/ethical-issues-in-advanced-ai/)

## Model limitations

- The paperclip maximizer is a thought experiment. This game is a cartoon of it, not a prediction about how real AI systems or a future AGI would behave.
- Clipbot has no learning, planning or model of the world. Its "behavior" is a fixed policy chosen by the player.
- Real systems do not come with a single world-resource meter, a clean off switch or a guaranteed floor. Here those are hard-coded so the ideas are easy to see.
- The economy is tuned for a short lesson, not for realism.

## Project layout

- `src/game.js`: pure game state, actions and the `advance` tick function, with no DOM access.
- `src/main.js`: rendering, input and the game loop.
- `src/storage.js`: `localStorage` access with safe fallbacks.
- `src/i18n.js`: English and Czech text.
- `test/game.test.js`: deterministic Node tests for purchases, bounds, the guardrail, both endings and corrupt input.

## Credits

Inspired by [Universal Paperclips](https://www.decisionproblem.com/paperclips/) by Frank Lantz. Little Clip Factory is an original educational adaptation: its code, text and artwork are new, and it is not affiliated with the original game.

Built for the [Little AI course](https://Majkey25.github.io/little-ai/#/alignment). Source: [github.com/Majkey25/little-clip-factory](https://github.com/Majkey25/little-clip-factory).

## License

The original code in this repository is released under the [MIT License](LICENSE). The license does not cover Universal Paperclips.
