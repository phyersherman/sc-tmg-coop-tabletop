# Co-op Command, tabletop edition (unofficial)

Co-op Command plays the enemy in the **StarCraft: Tabletop Miniatures Game**, so one or two players can fight together
against it on a real table.

Before the battle, you tell it which miniatures you own. Each player builds an army of any race, and the enemy is built
in secret from the models you are not fielding. It can be any race, and it takes upgrades that counter your armies.
You meet its Units as they arrive.

During the battle, every enemy Unit type plays from two decks of action cards, one for the Movement phase and one for
the Assault phase. The cards are built from the Unit's own abilities. When an enemy Unit activates, it plays the card
that suits its state: a Unit on its marker digs in, a hurt one takes cover, a fresh one attacks. The app rolls its
dice. You move its models the way the card says and enter what happened. The app keeps track of the Supply and the
Victory Points.

A map is used only to set up the table. Once the terrain and the Mission Markers are down, the map is put away and the
table decides everything.

There are seven co-op missions, from holding a Temple to stopping trains and surviving the night, plus the official
mission cards. In a co-op mission, most of the enemy goes after the main objective. Other markers are guarded by an
enemy Unit or a Structure. Clear one and hold it at Scoring, and you earn a reward for the next round.

It needs no account and no server, and sends nothing anywhere. It runs in the browser, offline once installed, or as a
desktop app. Open **Learn to play** in the app for a walk through a battle.

## Download

Each version on the [Releases](../../releases) page has a zipped Mac app and a zipped Windows app. They are not signed.
On a Mac, right-click the app and choose **Open** the first time. On Windows, choose **More info**, then **Run
anyway**, if SmartScreen asks.

## Run from source

The workflows build with Node.js 22.

```bash
npm install
npm run dev           # http://localhost:5173
npm test              # engine tests (vitest)
npm run typecheck
npm run build         # type-check, then a static site in dist/
npm run desktop:mac   # or desktop:win, or desktop for both: zipped apps in release/
```

## Publish

- **Website.** `.github/workflows/pages.yml` builds the site and publishes it to GitHub Pages on every push to `main`.
  You can also run it by hand from the Actions tab. In the repository's **Settings → Pages**, set **Source** to
  **GitHub Actions** once.
- **Desktop apps.** Push a version tag, for example `git tag v1.0.0 && git push --tags`. `.github/workflows/release.yml`
  runs the tests, builds the Mac and Windows apps, and attaches them to a GitHub Release.

## Data and legal

Unit stats, costs and mission facts are snapshotted from the official Command Center app into `src/data/*.json`. No
card art is reproduced. The official cards and rules are at https://starcraft-tmg.com/downloads. The terrain pictures
in `public/terrain-ref/` are the Lost Temple pieces as shown in the core rulebook's terrain key. The faction dice in
`public/dice/` are original artwork made for this project. This edition contains no art, audio, sprites or story from
the StarCraft video games.

StarCraft is a trademark of Blizzard Entertainment. StarCraft: Tabletop Miniatures Game is published by Archon
Studio. This is an unofficial fan project, not affiliated with or endorsed by either.

## Layout

- `src/engine`: the game engine in plain TypeScript, with no DOM. Unit math, the army builder, the AI and its action
  decks, the director, missions and terrain. Tested in `tests/`.
- `src/data`: snapshotted facts, deployment cards, order decks and the terrain catalog.
- `src/tabletop`: the app itself. Screens, components, stores, theme, and the text of the AI Rulebook.
- `electron/` and `scripts/build-desktop.mjs`: the desktop app.
