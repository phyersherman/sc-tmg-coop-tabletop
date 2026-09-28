# Co-op Command — tabletop edition (unofficial)

A companion app for the **StarCraft: Tabletop Miniatures Game** that lets one or two players play co-op against an
app-driven enemy on a real table. The app builds a hidden enemy army from the miniatures you are not fielding,
plays it from action cards, rolls its dice, keeps the score and referees the rules; you play the
miniatures. No LLM, no backend, no account: it runs in the browser (offline too, as a PWA) or as a desktop app.

## Download

The [Releases](../../releases) page has a Mac app and a Windows app for every version, zipped. They are not
signed: on a Mac, right-click the app and choose **Open** the first time; on Windows, choose **More info → Run
anyway** if SmartScreen asks.

## Run from source

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # engine tests (vitest)
npm run build      # static site in dist/
npm run desktop:mac   # or desktop:win: a desktop app in release/
```

## Publish

- **Website:** `.github/workflows/pages.yml` publishes to GitHub Pages on every push to `main`. In the repository's
  **Settings → Pages**, set **Source** to **GitHub Actions** once.
- **Desktop apps:** push a version tag (`git tag v1.0.0 && git push --tags`) and `.github/workflows/release.yml`
  builds the Mac and Windows apps and attaches them to a GitHub Release.

## How it plays

- **Setup:** mission, scale, one or two players, minerals, difficulty. Each player builds an army; the enemy is built
  in secret from the unused models of any race, with upgrades that counter your armies. The table setup lists the
  terrain (the rulebook's own pictures of each piece), the Mission Markers, and what stands on each side marker.
- **The enemy plays from action cards:** every unit type has a Movement deck and an Assault deck built from its own
  abilities (used for free), with its reactions printed as buffs and its Faction card boosts on the reshuffle cards.
  The app draws, rolls the dice and asks one question; you move the models and tap what happened.
- **Co-op missions:** seven missions with a main objective and side markers held by a guard or a Structure; destroy
  it and hold the marker to earn a one-time reward. The Tokens page prints a token for each reward.
- **Learn to play** in the app walks through a battle, the action cards, and the side markers.

## Data and legal

Unit stats, costs and mission facts are snapshotted from the official Command Center app into `src/data/*.json`. No
card art is reproduced. Official cards and rules: https://starcraft-tmg.com/downloads. The terrain pictures in
`public/terrain-ref/` are the Lost Temple pieces as shown in the core rulebook's terrain key. The faction dice in
`public/dice/` are original artwork made for this project. This edition contains no other art, audio or
sprites.

StarCraft is a trademark of Blizzard Entertainment. StarCraft: Tabletop Miniatures Game is published by Archon
Studio. This is an unofficial fan project, not affiliated with or endorsed by either.

## Layout

- `src/engine` — pure TypeScript game engine (no DOM): unit math, army builder, AI decisions and action decks,
  director, missions, terrain. Covered by `tests/`.
- `src/data` — snapshotted facts, deployment cards, order decks, terrain catalog.
- `src/tabletop` — the app: screens, components, stores, theme, and the AI Rulebook text.
- `electron/`, `scripts/build-desktop.mjs` — the desktop app.
