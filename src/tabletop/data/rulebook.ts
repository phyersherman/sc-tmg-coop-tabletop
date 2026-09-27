export interface RuleSection {
  id: string;
  title: string;
  paragraphs: string[];
  bullets?: string[];
}

export const RULEBOOK: RuleSection[] = [
  {
    id: 'about',
    title: 'What this app does',
    paragraphs: [
      'This is an unofficial fan companion for the StarCraft: Tabletop Miniatures Game. It plays an AI army against one or two players by the normal rules of the game.',
      'The app is the opponent across your real table. It knows the table layout and its own roster, but never where the models stand. Every AI activation is a short conditional order that you resolve on the table with the rules on this page, and you tell the app what happened: the damage AI units take, whether an AI unit is engaged or reached its marker, and who controls each marker at the end of the round.',
      'Unit stats and costs are snapshotted from the official Command Center app. Card text is not reproduced; see the official downloads for the real cards and full rules.',
    ],
  },
  {
    id: 'flow',
    title: 'A round with the app',
    paragraphs: ['Each round follows the official sequence: Movement, Assault, Combat, then Scoring & Cleanup. The phase bar at the top shows where the round stands, and the two sides alternate one unit at a time.'],
    bullets: [
      'Round start: the AI draws an order card (its stance for the round), the Supply Pool grows, and reinforcements return. The announcement waits for you; you can skip these announcements from then on, and the phase bar then notes each change (who goes first, the AI\'s order, what it can deploy). Settings turns them back on.',
      'Terran Tenacity: when a phase opens with the AI holding the First Player Marker and your Faction card still has Terran Tenacity, the announcement offers it: claim the marker and go first in that phase (once per game), or not now.',
      'Movement phase: AI orders are Deploy, Move, Disengage or Hold. Tap the button that matches what happened after each order.',
      'Assault phase: AI orders are Ranged Attack, Charge or Run, written as "if … otherwise …". Resolve the first branch that applies.',
      'Combat phase: first tick which AI units are engaged (the checklist). Engaged units then fight in turn.',
      'Scoring & Cleanup: report marker control and your losses. The end-of-round report says what each side scored and why, where every marker stands, and who holds the First Player Marker next.',
      'Your turn: activate one of your units as in a normal game, then end its activation, or Pass. The first side to pass in the Movement or Assault phase takes the First Player Marker for the next phase.',
    ],
  },
  {
    id: 'map',
    title: 'The map',
    paragraphs: ['The map is for setting up: the deployment card, the rulebook terrain map (or a remix in the same style) with every piece numbered, and the Mission Markers. Once the battle starts your table is the map; open Table layout from the menu to see the setup again.'],
  },
  {
    id: 'decks',
    title: 'Running the AI: action cards',
    paragraphs: [
      'The AI plays from action cards, like the monsters in Frosthaven. Every enemy unit type has a Movement deck and an Assault deck built from its own abilities. When the AI activates a unit, the app draws that type\'s card; every other unit of the same type follows the same card for the rest of the phase. The Combat phase has no deck: engaged units fight as normal and the app rolls their dice.',
      'The app picks which enemy unit activates, draws its card and rolls its dice. You move its models on the table as the card says, using the rules below, and tap what happened.',
    ],
    bullets: [
      'Focus: the nearest enemy unit by the shortest path. Ties: fewest models, then lowest HP, then the players choose. A card can name another focus (the weakest in range, the biggest in range, an enemy on its marker).',
      'Move: the leading model goes by the shortest path (round Size 2+ terrain, through grass and scatter) toward where the card says, and the rest follow in coherency. Never end within 1" of an enemy or in the players\' Zone of Influence. Ranged units stop once their weapon reaches the focus.',
      'Run: a move at full Speed in the Assault phase instead of attacking.',
      'Attack: only models in range and in line of sight of the focus fire. The app rolls the dice. If nothing is in range, the card says whether the unit runs or holds.',
      'Charge: needs a Ground enemy within Speed + 6" of the leading model by path. The app rolls the distance; on a success set the models base-to-base.',
      'Hold: the unit stays where it is; it still counts as activated.',
      'Abilities on a card cost the AI nothing: ignore Biomass, Command Points and Psionic Energy. Everything else an ability says still happens (a Stimpack still deals its NON-LETHAL DAMAGE). When an ability asks for a choice, the card says what the AI picks.',
      'The AI never reacts. Its reaction abilities are printed on its cards as buffs (✚) that last until the End of the Round.',
      'Faction boosts (★) ride on the reshuffle cards: when one comes up, the AI uses that boost of its Faction card. A Once per Game boost is struck through after its first use.',
      'Reshuffle (↻): when a deck draws this card, it is shuffled back together at the start of the next round.',
      'Objective: the Mission Marker the app gives the unit. Once there, it holds it.',
    ],
  },
  {
    id: 'focus',
    title: 'Choosing the AI target (focus)',
    paragraphs: ['Every attack order names a target rule. Apply it literally, measuring on the table.'],
    bullets: [
      'Nearest: the enemy unit reachable by the shortest legal path (around Size 2+ terrain, through grass and scatter). Distance is measured from the AI Leading Model.',
      'Ties: fewest remaining models, then lowest remaining hit points, then lowest Supply, then the players decide.',
      'Weakest: the enemy unit in range with the fewest models. On marker N: an enemy unit within 3" of that marker if one is in range, else nearest. Highest Supply: the unit in range with the most Supply.',
      'Only enemy units that are valid targets count (visible, in range, right combat tag). If no enemy qualifies, the order falls through to its "otherwise" branch.',
      'When a rule is genuinely ambiguous, the players decide, and the decision does not have to favour the AI.',
    ],
  },
  {
    id: 'moving',
    title: 'Moving AI units',
    paragraphs: ['Move orders name a heading and a distance. Move the Leading Model along the shortest legal path toward the heading, up to the distance, then set the other models in coherency (Wholly Within 3" of the Leading Model). A Run in the Assault phase is the same move, up to the unit\'s Speed, instead of an attack.'],
    bullets: [
      'Stop conditions in the order override the distance: a ranged unit stops as soon as models have range and line of sight to an enemy; a support unit stops within 4" of the unit it follows.',
      'Prefer positions that give cover (within 1" of terrain), then positions on the marker, then straight-line progress. Never end within 1" of an enemy model unless the order is a charge.',
      'High ground: the Lost Temple\'s plateau is reached only up its ramp. AI units climb it only if the ramp is on their path and the marker or target is up there. Raptor Strain units climb anything.',
      'Grass is passed through (and flattened). Scatter (Size 0 and 1) is walked through but never ended on. Walls (Size 2 and up) are walked around, and a gap between pieces takes a unit of Size 2 or lower at 1" wide, Size 3 or larger at 3" (Gap Clearance, Part 4.6). Do not deliberately route AI units through hazards.',
      'Deploying: the unit enters from the named edge segment, moves up to its Speed, and may never end inside the players\' Zone of Influence (the 6" strip inside your entry edge).',
      'If a marker order says "reached", tap it when at least one model ends within 3" of that marker; the app then keeps that unit holding there.',
    ],
  },
  {
    id: 'shooting',
    title: 'Ranged attacks',
    paragraphs: ['An attack is resolved in the Combat Tray step by step, as on the table: the attack dice, the Surge die if it applies, then Armour, then Evade, then damage. Nothing on the table changes ahead of its step. On the tabletop you adjust the number of AI models that can actually fire (in range and with line of sight) and roll your own saves; in the simulation the app counts the firing models and rolls everything but your saves.'],
    bullets: [
      'Range is measured base to base, from each firing model to the target; models out of range do not fire. LONG RANGE (X): if no target is within normal range but one is within X", fire at it with every die needing one more to hit.',
      'Line of sight is the official 2D top-down rule: trace base to base; Full Cover and Direct Cover (within 1" of blocking terrain) block it. Effective Size counts the terrain a model stands on: a model on the plateau adds its Size, so a Marine up there sees down over its edge and a Size 2 wall gives no cover from it. The piece a model stands on never blocks its own sight. A target hugging the cliff is still in Direct Cover from the open ground beyond.',
      'Surge: the Surge die is only rolled when the target has one of the weapon\'s Surge types; then that many hits skip Armour. Otherwise every hit gets an Armour save.',
      'Sidearms: after its main weapon a unit may fire each of its SIDEARM weapons too, in the same activation, each as its own batch. The AI fires its sidearms at the same target as its main weapon, each only if the target is within that sidearm\'s own range; a sidearm out of range stays quiet and the log says so. Anti-air weapons are skipped unless you told the setup you have Flying units.',
      'An engaged AI ranged unit fires at the unit it is engaged with; that unit gets Evade rolls. Otherwise engaged units cannot be targeted, except by PINPOINT weapons.',
      'Casualties leave the table: when a unit loses models, the ones farthest from the attacker go first (the models not in reach), and range and sight are never measured to a model that is gone.',
    ],
  },
  {
    id: 'charging',
    title: 'Charges and IMPACT',
    paragraphs: ['A charge order lists the range at which the AI will attempt it. Measure the path from the Leading Model; if a valid enemy Ground unit is within that distance, declare the charge, roll the charge dice shown and add the Speed.'],
    bullets: [
      'Success: the Leading Model ends within 1" of the target (base-to-base if possible), others in coherency with as many as possible in contact. On the tabletop, tap "Charge succeeded" and enter the combined Supply of the enemy units it is now engaged with.',
      'Failure: the unit does not move. Tap "Charge failed". It cannot act again this phase.',
      'IMPACT: after a successful charge, the pre-rolled IMPACT dice apply. Count one set of dice per AI model in the Fighting or Supporting rank; the hits shown go straight to your Armour roll at damage 1.',
      'Hard and above: the AI rolls two dice for charge distance and keeps the higher.',
    ],
  },
  {
    id: 'combat',
    title: 'The Combat phase',
    paragraphs: ['Each engaged AI unit gets a Close Combat order: Close Ranks (a 3" shuffle toward the enemy, maximising base contact), then the attack with its best close-combat weapon.'],
    bullets: [
      'Reduce the attacking models to those in the Fighting Rank (within 1") or Supporting Rank (touching a Fighting model).',
      'If engaged with several enemy units, all dice go to the unit named by the focus rule.',
      'On the tabletop, remove AI casualties with the official engaged-unit priority (models not in reach first) and enter the damage in the roster; the app removes models and adjusts Supply. When one side of an engagement is wiped out, untick Engaged for the survivor.',
    ],
  },
  {
    id: 'disengage',
    title: 'When the AI breaks off',
    paragraphs: ['Ranged and support AI units disengage in the Movement phase only when their Supply is higher than the enemy they are engaged with (the official tactical-mass rule), so they can still shoot afterward. Melee units never disengage; they fight it out.'],
  },
  {
    id: 'markers',
    title: 'Markers and scoring',
    paragraphs: ['At the end of each round, for each active marker the side with the higher total Supply within 3" (with line of sight, on the same elevation, in coherency) takes control. Control is sticky: a marker keeps its owner until the other side wins a contest there. Contested (tied) and empty markers do not change. On the tabletop you report this on the scoring form; in the simulation it is read from the map.'],
    bullets: [
      'AI Commander heroes count +1 Supply for control. A unit at Supply 0 still holds an uncontested marker. Flying and burrowed units never contest.',
      'Both sides score VP equal to enemy Supply destroyed each round; enter the Supply brackets your units dropped by (9 Marines to 6 Marines is 1).',
      'The First Player Marker goes to the side with fewer VP. On the final round every unit still in Reserves counts as destroyed.',
    ],
  },
  {
    id: 'damage',
    title: 'Reporting damage to AI units',
    paragraphs: ['Pick the AI unit in the AI units list (or open the roster), set the total damage from one attack and apply it. The app applies the damage marker, removes models, updates Supply and counts the loss toward your VP. Use "−1 model" for effects that remove models outright, and Heal for Medic or Queen effects.'],
    bullets: [
      'Shields (Protoss) are added to the first model and are gone once it dies.',
      'Barrier, Diffusion and Hardened Will mutators are applied automatically.',
      'Undo (in the Menu) reverts the last action if you mis-tap.',
    ],
  },
  {
    id: 'reinforcements',
    title: 'AI reinforcements',
    paragraphs: ['Destroyed AI units can return to Reserves depending on difficulty: never on Casual, once (plus one per extra player) on Normal, from a mineral pool on Hard, endlessly at 75% strength on Brutal. If the AI falls below 40% of its Supply Pool for two rounds, one unit returns regardless, so the game stays a fight for larger groups.'],
  },
  {
    id: 'cards',
    title: 'Your cards and paying for abilities',
    paragraphs: ['Your Faction card and Tactical Cards sit above the console. Each one is worth a number of resource: Command Points for Terran, Biomass for Zerg, Psionic Energy for Protoss. Every card is Ready or Exhausted, and every card refreshes to Ready at Cleanup, at the end of each round.'],
    bullets: [
      'An ability that costs 2 is paid by Exhausting Ready cards worth 2 between them. Cost is counted in resource, not in cards: one card worth 2 pays it by itself, and two cards worth 1 pay it together.',
      'You never Exhaust more than the cost asks for. When there is only one way to pay, the app pays it for you; when there is a choice, the pay bar opens and picking a card that covers the cost hands back the cards that are no longer needed.',
      'A card worth 2 spent on a cost of 1 loses the extra: there is no change. Pay with your smallest cards first when you can.',
      'Using a card\'s own boost Exhausts that card, whatever it is worth, and costs nothing else.',
      'An Exhausted card cannot pay and cannot give its boost until it refreshes. The card bar dims it, and the ability button says what you are short of.',
    ],
  },
  {
    id: 'abilities',
    title: 'Simplified AI abilities',
    paragraphs: ['The AI does not use Tactical Cards or the CP / Biomass / Psionic Energy economies. Instead it uses a small fixed kit noted on orders and at the briefing: Devastating Charge (IMPACT), Burrow Ambush on Zerg surge rounds, Commander +1 Supply on markers, Medic healing at round start, Queen Transfusion (−2 on one damage instance if a Queen is within 4"), and the faction doctrine for the difficulty. Everything else on the AI cards is ignored; feel free to house-rule more.'],
    bullets: ['Stance is the one Active ability the AI does use, because a weapon depends on it. An AI Siege Tank that owns Mode Transformation digs in where it stands when one of your units is inside the Shock Cannon\'s reach, and packs up again when nothing is left in range or something gets into its face. While it is dug in it shells you and does not move; the order tells you to change the model\'s pose.'],
  },
  {
    id: 'newunits',
    title: 'The newest units: Immortal, Siege Tank, Ravager',
    paragraphs: ['Three units joined the game, and the app plays all of their rules for you. Their cards are the official ones, taken from the Command Center app.'],
    bullets: [
      'Immortal: 6 Shields, two Photon Disruptors (the right one is a SIDEARM, so both fire in one activation). While it is Shielded, Shield Overcharge answers an Armour roll with TOUGH (2) and Improved Barrier caps the attacking weapon at 1 damage a hit; both are offered while you roll its saves. For the Ancients sharpens a shot beyond 8", and Fury Unyielding adds CRITICAL HIT (1) when it and its target are both within 3" of the same Mission Marker.',
      'Siege Tank: Mode Transformation (bought as an upgrade) digs it in. In SIEGE MODE it cannot Move, Run, Disengage, Charge or Close Ranks, it counts as Size 3, it loses Heavy Plating\'s TOUGH (1), and the only gun it may fire is the Shock Cannon. Point Blank keeps that gun off anything it is engaged with, and Aftershock Rounds makes its Damage equal to the target\'s Size.',
      'The Shock Cannon is a Blast Template: no Surge die is rolled. The app sets the template over the model nearest the tank, and the models it covers are both extra dice and the Surge result. On a table, count the models under your own template and enter that number.',
      'Ravager: Corrosive Bile throws a glob for each model up to 14" away. The globs sit on the map until the end of the Assault phase, when every unit within 1" of one takes 5 hits from each glob and the globs burn out. Bloated Bile Ducts widens them to 2", Potent Bile takes a point of Armour off whoever is caught, and Deep Tunnel works like an Adept\'s Shade: set the token, and at the end of the round the unit may step to it.',
    ],
  },
  {
    id: 'camera',
    title: 'Using an overhead camera (tabletop)',
    paragraphs: ['Optional, chosen at setup: mount a phone, tablet or USB webcam above the table so the whole table is in view, print the tag sheet (Tags page), and the app reads real positions. Nothing on the models needs power: each unit gets a small printed square tag on its Leading Model\'s base, and four larger tags mark the table corners.'],
    bullets: [
      'Tags follow your Collection: four corner tags, then one tag per unit your collection can field at once (18 Marines make three units, so three Marine tags). A tag belongs to its slot for good; whichever unit of that miniature is fielded in the slot carries it, whatever its size or upgrades. Owning more miniatures adds tags, and a tag never changes number. The Camera setup screen shows which tag goes on which unit for the game and checks the camera sees the table before play starts.',
      'Calibration: the app finds the four corner tags and maps the image onto the table in inches. Once calibrated, positions keep working even if a corner is briefly hidden.',
      'What changes: AI orders gain a "Camera:" line with the exact target, model counts that can fire, charge distances and move destinations. Engagements are detected within 1", "reached the marker" happens automatically, and the scoring form is pre-filled with marker control. You still confirm each order with a tap and still enter damage.',
      'Line of sight is computed with the official 2D rule from the terrain on the map, and a unit standing on the plateau is on high ground by where it stands.',
      'Tips: even lighting, a camera roughly centred over the table, and 20 mm tags at 1080p cover a 36"×54" table. Lower the model tag size only if your camera is close. If a tag is not recognised, it shows as "?" in the camera view; check it is on the printed sheet.',
    ],
  },
  {
    id: 'links',
    title: 'Official resources',
    paragraphs: ['Rulebook, quick-start rules, print-and-play card sheets and the FAQ: https://starcraft-tmg.com/downloads. Official Command Center app (army builder, cards, missions): https://sc.starcraft-tmg.com. StarCraft and all related content © Blizzard Entertainment; the tabletop game © Archon Studio. This app is an unofficial fan project and is not affiliated with either.'],
  },
];
