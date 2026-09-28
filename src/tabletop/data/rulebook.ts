/** Text may mark game terms **in bold**, as the rulebook does. */
export interface RuleSection {
  id: string;
  title: string;
  /** The italic one-liner under the heading, as the rulebook opens each phase ("Score, cleanup, set initiative."). */
  summary?: string;
  paragraphs: string[];
  bullets?: string[];
  /** A boxed aside after the rules: a tip or a designer's note. */
  note?: { label: string; text: string };
}

export const RULEBOOK: RuleSection[] = [
  {
    id: 'about',
    title: 'What this app does',
    paragraphs: [
      'This is an unofficial fan companion for the StarCraft: Tabletop Miniatures Game. It plays an AI army against one or two players, by the normal rules of the game, across a real table.',
      'The AI knows the table layout and its own army. It never knows where the models stand. Each AI activation is an action card that the players resolve on the table with the rules on this page. The players then tell the app what happened.',
      'The enemy army is hidden. It is built from the models in your Collection that the players are not fielding, of any race. Its Units are revealed as they deploy.',
      'Unit stats and costs are taken from the official Command Center app. The official downloads hold the real cards and the full rules.',
    ],
  },
  {
    id: 'flow',
    title: 'A round with the app',
    summary: 'Movement, Assault, Combat, Scoring & Cleanup.',
    paragraphs: ['Each round follows the official sequence, and the two sides alternate one Unit at a time.'],
    bullets: [
      '**Round start:** the AI draws an order card, its stance for the round. Its **Supply Pool** grows and its reinforcements return to **Reserves**.',
      '**Terran Tenacity:** when a phase opens with the AI holding the **First Player Marker** and a player\'s Faction card still has Terran Tenacity, the players may claim the marker and go first in that phase. Once per game.',
      '**Movement and Assault phases:** each AI Unit acts from its action card. Resolve it on the table, then report what happened.',
      '**Combat phase:** first mark which AI Units are **Engaged**. Engaged Units then fight in turn.',
      '**Scoring & Cleanup:** report who controls each marker and the Supply the players lost. The round\'s report gives each side\'s score and who holds the **First Player Marker** next.',
      '**The players\' turn:** activate one of your Units as in a normal game, then end its activation, or Pass. The first side to pass in the Movement or Assault phase takes the **First Player Marker** for the next phase.',
    ],
  },
  {
    id: 'map',
    title: 'The map',
    paragraphs: ['The map is for setting up. It shows the deployment card, the rulebook terrain map (or a remix in the same style) with every piece numbered, and the **Mission Markers**. Once the battle starts the table is the map. Open Table layout from the Menu to see the setup again.'],
  },
  {
    id: 'decks',
    title: 'Running the AI: action cards',
    summary: 'Each Unit plays the card that suits it.',
    paragraphs: [
      'Every enemy Unit type has a Movement deck and an Assault deck, built from its own abilities. A deck is not shuffled and drawn blind. Each time a Unit activates, it plays the card that best suits its state, with some chance in the choice. The Combat phase has no deck.',
      'A Unit weighs what it knows of itself: whether it holds its marker, the damage it has taken and the models it has lost, whether it is **Burrowed**, and how the battle stands. A Unit on its marker digs in or fires from where it stands. A badly hurt Unit takes cover, falls back or Burrows. A fresh Unit rushes in and charges. Late in the game, or behind on Victory Points, it pushes for the markers. A **Burrowed** Unit never plays an attack or a charge. Any Unit may charge by the rules, but the AI never charges with a Unit whose ranged weapon hits harder than its close combat: that Unit shoots. The AI charges only with Units stronger up close, or with no ranged weapon.',
      'The app chooses which enemy Unit activates, chooses its card and rolls its dice. Move its models on the table as the card says, using the rules below.',
    ],
    bullets: [
      '**Move:** the **Leading Model** goes by the shortest path toward where the card says, and the rest follow in **Coherency**.',
      '**Run:** a move at full Speed in the Assault phase, instead of attacking.',
      '**Attack:** only models in range and in line of sight of the focus fire. If nothing is in range, the card says whether the Unit runs or holds.',
      '**Charge:** needs a Ground enemy within charge range of the **Leading Model** by path, usually Speed + **6"**.',
      '**Hold:** the Unit stays where it is. It still counts as activated.',
      '**Abilities:** an ability on a card costs the AI nothing. Ignore Biomass, Command Points and Psionic Energy. Everything else the ability says still happens, so a Stimpack still deals its NON-LETHAL DAMAGE. When an ability asks for a choice, the card says what the AI picks. A Once per Game ability is struck through after its first use.',
      '**Buffs (✚):** the AI never reacts. Its Reactions, and the abilities it would use in the Combat phase, are printed on its cards as buffs that last until the **End of the Round**.',
      '**Faction boosts (★):** some AI cards carry a boost from the AI\'s Faction card. When the card comes up, the AI uses that boost. Each race in the enemy army uses its own Faction card.',
      '**Objective:** each AI Unit is given a **Mission Marker** to head for. Once there, it holds it.',
    ],
  },
  {
    id: 'focus',
    title: 'Choosing the AI target (focus)',
    paragraphs: ['Every attack and charge has a target rule, its focus. Apply it literally, measuring on the table.'],
    bullets: [
      '**Nearest:** the enemy Unit reached by the shortest legal path, around Size 2+ terrain and through grass and scatter. Measure from the AI **Leading Model**. Ties go to the fewest remaining models, then the lowest remaining hit points, then the lowest Supply. If still tied, the players decide.',
      '**Weakest in range:** the enemy Unit in range with the fewest remaining models. Ties go to the nearest.',
      '**Biggest in range:** the enemy Unit in range with the highest Supply. Ties go to the nearest.',
      '**On its marker:** an enemy Unit within **3"** of the AI Unit\'s **Mission Marker**, if one is in range. Otherwise the nearest.',
      'Only valid targets count: visible, in range, and of a type the weapon can hit. If no enemy qualifies, the card falls through to its "otherwise" instruction.',
      'When a rule is genuinely ambiguous, the players decide. The decision does not have to favour the AI.',
    ],
  },
  {
    id: 'moving',
    title: 'Moving AI units',
    paragraphs: ['Move the **Leading Model** along the shortest legal path toward the card\'s heading, up to the distance shown. Then set the other models in **Coherency**, **Wholly Within 3"** of the **Leading Model**. A Run in the Assault phase is the same move, up to the Unit\'s Speed, instead of an attack.'],
    bullets: [
      '**Stopping early:** a ranged Unit stops as soon as its models have range and line of sight to an enemy. A support Unit stops within **4"** of the Unit it follows.',
      '**Where to end:** prefer cover (within **1"** of terrain), then the marker, then straight-line progress. Never end within **1"** of an enemy model unless the move is a charge.',
      '**High ground:** the Lost Temple\'s plateau is reached only up its ramp. AI Units climb it only if the ramp is on their path and the marker or target is up there. Raptor Strain Units climb anything.',
      '**Terrain:** grass is passed through and flattened. Scatter (Size 0 and 1) is walked through but never ended on. Walls (Size 2 and up) are walked around. A gap takes a Unit of Size 2 or lower at **1"** wide, Size 3 or larger at **3"** (Gap Clearance, Part 4.6). Do not route AI Units through hazards on purpose.',
      '**Deploying:** the Unit enters from the named edge segment and moves up to its Speed. It may never end inside the players\' Zone of Influence, the **6"** strip inside their entry edge.',
      '**Burrow Ambush:** on a Swarm Surge round, a Unit with Burrow Ambush is set anywhere within **18"** of the AI entry edge, more than **10"** from every player model and outside the players\' Zone of Influence. It does nothing else that phase.',
      '**Short of models:** if the Collection could not field the whole enemy army, the players may let the AI enter anywhere. Set the Unit down more than **6"** from every player model and outside the players\' Zone of Influence.',
      '**Reaching a marker:** a Unit has reached its marker when at least one model ends within **3"** of it. Report it, and the Unit holds the marker from then on.',
    ],
  },
  {
    id: 'shooting',
    title: 'Ranged attacks',
    paragraphs: ['An attack is resolved step by step, as on the table: the attack dice, the Surge die if it applies, then Armour, then Evade, then damage. Adjust the number of AI models that can fire to those in range and with line of sight, then roll your own saves.'],
    bullets: [
      '**Range** is measured base to base, from each firing model to the target. Models out of range do not fire. LONG RANGE (X): if no target is within normal range but one is within **X"**, fire at it with every die needing one more to hit.',
      '**Line of sight** is the official 2D top-down rule. Trace base to base. Full Cover and Direct Cover (within **1"** of blocking terrain) block it. Effective Size counts the terrain a model stands on: a model on the plateau adds its Size, so a Marine up there sees down over its edge and a Size 2 wall gives no cover from it. The piece a model stands on never blocks its own sight. A target hugging the cliff is still in Direct Cover from the open ground beyond.',
      '**Surge:** the Surge die is rolled only when the target has one of the weapon\'s Surge types. That many hits then skip Armour. Otherwise every hit gets an Armour save.',
      '**Sidearms:** after its main weapon, a Unit fires each of its SIDEARM weapons in the same activation, each as its own batch. The AI fires them at the same target, each only if the target is within that sidearm\'s own range.',
      '**Anti-air:** the AI fires its anti-air weapons only when the players field Flying Units.',
      '**Engaged:** an **Engaged** AI ranged Unit fires at the Unit it is engaged with, and that Unit gets Evade rolls. Otherwise **Engaged** Units cannot be targeted, except by PINPOINT weapons.',
      '**Casualties:** when a Unit loses models, the ones farthest from the attacker go first. Range and sight are never measured to a model that is gone.',
    ],
  },
  {
    id: 'charging',
    title: 'Charges and IMPACT',
    paragraphs: ['Measure the path from the **Leading Model**. If a valid enemy Ground Unit is within the charge range, declare the charge, roll the charge dice and add the Unit\'s Speed.'],
    bullets: [
      '**Success:** the **Leading Model** ends within **1"** of the target, base to base if possible. Set the others in **Coherency**, with as many as possible in contact. Report the charge, and enter the combined Supply of the enemy Units it is now **Engaged** with when asked.',
      '**Failure:** the Unit does not move. It cannot act again this phase.',
      '**IMPACT:** after a successful charge, the IMPACT dice are rolled once for each AI model in the Fighting Rank or Supporting Rank. The hits go straight to your Armour roll at damage 1.',
      '**Hard and above:** the AI rolls two dice for charge distance and keeps the higher. Some cards give this at any difficulty.',
    ],
  },
  {
    id: 'combat',
    title: 'The Combat phase',
    summary: 'Close ranks, then strike.',
    paragraphs: ['At the start of the phase, mark each **Engaged** AI Unit and the Supply of the enemy it is engaged with. Each **Engaged** AI Unit then Closes Ranks: its **Leading Model** moves up to **3"** toward the enemy, and the rest close in with as many models as possible in base contact. Then it attacks with its best close-combat weapon.'],
    bullets: [
      'Only models in the Fighting Rank (within **1"** of an enemy model) or the Supporting Rank (touching a Fighting Rank model of their own Unit) strike. Enter how many models that is.',
      'If engaged with several enemy Units, all dice go to the Unit named by the focus rule.',
      'Remove AI casualties by the official engaged-Unit priority, models not in reach first, and enter the damage on the Unit\'s card. When one side of an engagement is wiped out, the survivor is no longer **Engaged**.',
    ],
  },
  {
    id: 'disengage',
    title: 'When the AI breaks off',
    paragraphs: ['A ranged or support AI Unit disengages in the Movement phase only when its Supply is higher than that of the enemy it is engaged with, the official tactical-mass rule, so it can still shoot afterward. Melee Units never disengage. They fight it out.'],
  },
  {
    id: 'markers',
    title: 'Markers and scoring',
    paragraphs: ['At the End of the Round, each active **Mission Marker** goes to the side with the higher total Supply within **3"**, with line of sight, on the same elevation and in **Coherency**. Control is sticky: a marker keeps its owner until the other side wins a contest there. Tied and empty markers do not change hands.'],
    bullets: [
      'An AI Commander hero counts +1 Supply for control. A Unit at Supply 0 still holds an uncontested marker. Flying and Burrowed Units never contest.',
      'Each round both sides score VP equal to the enemy Supply they destroyed. Enter the Supply brackets your Units dropped by: 9 Marines down to 6 Marines is 1.',
      'The **First Player Marker** goes to the side with fewer VP. On the final round, every Unit still in **Reserves** counts as destroyed.',
    ],
  },
  {
    id: 'damage',
    title: 'Damage to AI units',
    paragraphs: ['When an attack lands on an AI Unit, pick its card and enter what happened. Enter the hits, and the AI rolls its own Armour saves. Or enter the damage straight, when it is already worked out. The app removes models, updates Supply and counts the loss toward your VP.'],
    bullets: [
      '**Evade:** the AI rolls Evade on what gets past its Armour when it is **Engaged** and shot at, Burrowed, or on high ground over the attacker. Enter ANTI-EVADE from your weapon if it has it.',
      '**Models removed outright:** take them off one at a time.',
      '**DEBUFF:** set Speed, Hit, Armour or Evade DEBUFFs on the Unit. They last until the **End of the Round**.',
      '**Shields:** Protoss Shields are added to the first model and are gone once it dies.',
      '**Mutators:** Barrier, Diffusion and Hardened Will apply by themselves.',
      '**Undo** in the Menu takes back the last action.',
    ],
  },
  {
    id: 'reinforcements',
    title: 'AI reinforcements',
    paragraphs: ['Destroyed AI Units can return to **Reserves**, depending on difficulty. On Casual they never return. On Normal, one returns, plus one more for each extra player. On Hard they return from a mineral pool worth half the AI army. On Brutal they return endlessly at 75% strength. If the AI falls below 40% of its **Supply Pool** for two rounds, one Unit returns regardless.'],
  },
  {
    id: 'cards',
    title: 'Your cards',
    paragraphs: ['The players keep their Faction and Tactical cards on the table and play them by the normal rules. The app does not track them, except Terran Tenacity, which it offers when a phase opens with the AI holding the **First Player Marker**.'],
  },
  {
    id: 'abilities',
    title: 'What the AI plays for itself',
    paragraphs: ['A few orders do not come from the cards.'],
    bullets: [
      '**Stance:** an AI Siege Tank with Mode Transformation digs in where it stands when one of your Units is inside the Shock Cannon\'s reach. It packs up again when nothing is left in range, or when an enemy it is engaged with sits under Point Blank. While dug in it shells you and does not move. Change the model\'s pose when told.',
      '**Breaking off:** an **Engaged** Unit disengages by the rule in When the AI breaks off, not by a card.',
      '**Engaged Units** do not draw a card. A ranged Unit fires at the Unit it is engaged with, and the rest wait for the Combat phase.',
      '**Holding ground:** a Unit ordered to hold its ground never runs. A fighter charges an enemy that comes within reach, and a shooter fires at anything in range.',
    ],
  },
  {
    id: 'newunits',
    title: 'The newest units: Immortal, Siege Tank, Ravager',
    paragraphs: ['Three Units joined the game. Their cards are the official ones, from the Command Center app.'],
    bullets: [
      '**Immortal:** 6 Shields and two Photon Disruptors. The right one is a SIDEARM, so both fire in one activation. While it is Shielded, Shield Overcharge answers an Armour roll with TOUGH (2), and Improved Barrier caps the attacking weapon at 1 damage a hit. For the Ancients sharpens a shot beyond **8"**. Fury Unyielding adds CRITICAL HIT (1) when it and its target are both within **3"** of the same **Mission Marker**.',
      '**Siege Tank:** Mode Transformation, bought as an upgrade, digs it in. In SIEGE MODE it cannot Move, Run, Disengage, Charge or Close Ranks. It counts as Size 3, it loses Heavy Plating\'s TOUGH (1), and the only gun it may fire is the Shock Cannon. Point Blank keeps that gun off anything it is engaged with, and Aftershock Rounds makes its Damage equal to the target\'s Size.',
      '**Shock Cannon:** a Blast Template, so no Surge die is rolled. The models under the template are both extra dice and the Surge result. Count the models under your template and enter that number.',
      '**Ravager:** Corrosive Bile throws a glob for each model, up to **14"** away. The globs stay on the table until the end of the Assault phase. Then every Unit within **1"** of one takes 5 hits from each glob, and the globs burn out. Bloated Bile Ducts widens them to **2"**. Potent Bile takes a point of Armour off whoever is caught. Deep Tunnel works like an Adept\'s Shade: set the token, and at the End of the Round the Unit may step to it.',
    ],
  },
  {
    id: 'links',
    title: 'Official resources',
    paragraphs: ['Rulebook, quick-start rules, print-and-play card sheets and the FAQ: https://starcraft-tmg.com/downloads. Official Command Center app (army builder, cards, missions): https://sc.starcraft-tmg.com. StarCraft and all related content © Blizzard Entertainment; the tabletop game © Archon Studio. This app is an unofficial fan project and is not affiliated with either.'],
  },
];
