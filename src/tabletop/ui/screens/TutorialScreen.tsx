import { useState, type ReactNode } from 'react';
import type { GameState } from '@engine/types/game';
import { unitById } from '@data/index';
import { buildDeck } from '@engine/ai/actionDecks';
import { MISSION_STRUCTURES } from '@data/missionObjects';
import { useUi } from '@tt/store/uiStore';
import { Btn } from '../components/Basics';
import { RewardToken, Token } from '../components/Tokens';
import { ActionCardView } from '../tabletop/ActionCardView';

/** A card to show, outside any battle: the Marines' Stimpack card from their Movement deck. */
function SampleCard() {
  const deck = buildDeck(unitById('marine'), [], 'movement');
  const card = deck.find((c) => c.steps.some((s) => s.k === 'ability')) ?? deck[0]!;
  return <ActionCardView g={{ aiDecks: {} } as unknown as GameState} card={card} full />;
}

interface Chapter { title: string; body: ReactNode; aside?: ReactNode }

const CHAPTERS: Chapter[] = [
  {
    title: 'An opponent that never tires',
    body: (
      <>
        <p>Co-op Command plays the enemy army in the StarCraft Tabletop Miniatures Game, so one or two players can fight side by side against it. The battlefield is the table in front of you. Where the app and the table disagree, the table is right.</p>
        <p>The app decides what each enemy Unit does, rolls its dice, and keeps the Supply and the score. The players move the enemy models the way its cards say, and tell the app what happened.</p>
      </>
    ),
  },
  {
    title: 'Before the battle',
    body: (
      <>
        <ol>
          <li><b>Collection.</b> Enter the miniatures you own. The enemy is built only from these.</li>
          <li><b>Your army.</b> Each player builds a force from their cards, of any race.</li>
          <li><b>The enemy.</b> A hidden army is built from the models you are not fielding, of any race. You meet its Units as they arrive.</li>
          <li><b>The table.</b> The setup map shows the deployment card, every terrain piece by number, the Mission Markers, and what stands on each side marker. Set it all up and put the map away. From then on, the table is the map.</li>
        </ol>
      </>
    ),
  },
  {
    title: 'Reading the enemy',
    body: (
      <>
        <p>Each enemy Unit on the table has a card with its Speed, Armour, Evade and HP, the models it has left, and whether it is damaged, Engaged, buffed or DEBUFFed.</p>
        <p>Every enemy Unit type has two decks of action cards, one for the Movement phase and one for the Assault phase. When a Unit activates, it plays the card from its deck that best suits its state. A Unit holding its marker digs in. A badly hurt Unit takes cover or falls back. A fresh Unit presses the attack. Read a card from the top down.</p>
        <ul>
          <li><b>➜ » ■ ✹ ⚡</b> Move, run, hold, fire or charge. The card also says what to do if the Unit cannot.</li>
          <li><b>◆</b> An ability, used for free. The AI never pays Biomass, Command Points or Psionic Energy.</li>
          <li><b>✚</b> A buff until the End of the Round. The AI never reacts, so its reactions come as buffs instead.</li>
          <li><b>★</b> A Faction card boost, and the Unit it goes to.</li>
        </ul>
      </>
    ),
    aside: <SampleCard />,
  },
  {
    title: 'A turn at the table',
    body: (
      <>
        <p>The sides take turns, one Unit at a time. On your turn, activate a Unit on the table, then press <b>Done</b>. Press <b>Pass</b> when you have nothing left to activate this phase.</p>
        <p>On the enemy's turn, the app shows the card and the Unit it is for. Move the models as the card says. The focus is the nearest enemy by the shortest path. Moves go around walls and never end within 1" of your models. If the card attacks, answer whether anything is in range. The app rolls the dice and gives the hits. Tap what happened.</p>
        <p>When your attack lands, pick the enemy Unit's card and enter the hits. The app rolls its Armour and Evade and removes the models.</p>
      </>
    ),
  },
  {
    title: 'Combat and scoring',
    body: (
      <>
        <p>There are no action cards in the Combat phase. Tick which enemy Units are Engaged. Every Engaged Unit fights as normal. The app rolls the enemy's dice, and the players roll their own at the table.</p>
        <p>At Scoring, enter who holds each marker and what you lost. The app keeps the VP, the Supply Pool and the score for each round. Depending on the difficulty, it brings destroyed enemy Units back.</p>
      </>
    ),
  },
  {
    title: 'Co-op missions',
    body: (
      <>
        <p>Every co-op mission has a main objective. Hold the Temple, stop the trains, survive the nights, guard your base from the Thrashers, close the rifts, lock the markers, or gather terrazine. The strip under the score tracks it, and warns you when the next Scoring can lose the battle.</p>
        <p>Most of the enemy goes after the objective. The other markers, the <b>side markers</b>, are a choice. Leaving the objective to take one costs Units and time. It pays back with a reward.</p>
      </>
    ),
  },
  {
    title: 'Side markers: guards and Structures',
    body: (
      <>
        <p>At the start of a co-op mission, something of the enemy's stands on each side marker. The table setup says which, and which token goes beside it.</p>
        <ul>
          <li><b>A guard</b> is a real enemy Unit, a copy of the enemy's cheapest Core Unit. Set it on the marker before round 1, using spare models or stand-ins. It never leaves the marker. It shoots what it can see and fights what comes to it. Once destroyed, it does not come back. Put a <b>Guard</b> token beside it.</li>
          <li><b>A Structure</b> is a Refinery, an Extractor or an Assimilator. It stands on the marker and never fights back, but it takes a lot to bring down. Use any building you have, or its printed token. Its HP and Armour are on the token.</li>
        </ul>
        <p>The rest of the enemy leaves side markers alone. Whether to go for them is up to you.</p>
      </>
    ),
    aside: (
      <div className="tut-tokens">
        <Token icon="guard" name="Guard" line="Holds this marker" tone="red" size="1.3in" />
        {MISSION_STRUCTURES.slice(0, 2).map((d) => <Token key={d.id} icon="structure" name={d.name} line={`HP ${d.stats.hp} · Armour ${d.stats.armour}+`} tone="grey" size="1.3in" />)}
      </div>
    ),
  },
  {
    title: 'Rewards',
    body: (
      <>
        <ol>
          <li>Destroy the guard or the Structure on a side marker.</li>
          <li>Hold that marker at a Scoring phase.</li>
          <li>The player with the most Supply on the marker earns its reward for the <b>next round only</b>. If it is not used then, it is lost. If two players are level, you choose who takes it.</li>
        </ol>
        <p>Gold rewards go to one Unit. Reinforce brings a destroyed Unit back, and Firepower gives one Unit +1 RoA on its ranged weapons. Blue rewards go to one player, such as Requisition, which adds +2 Supply. Violet rewards change the mission itself and apply on their own. Set each reward token beside its marker, so everyone can see what it is worth.</p>
      </>
    ),
    aside: (
      <div className="tut-tokens">
        <RewardToken kind="reinforce" size="1.3in" />
        <RewardToken kind="requisition" size="1.3in" />
        <RewardToken kind="firepower" size="1.3in" />
        <RewardToken kind="shield" size="1.3in" />
      </div>
    ),
  },
];

/** Learn to play: how a battle runs, one short chapter at a time. */
export function TutorialScreen() {
  const go = useUi((s) => s.go);
  const [i, setI] = useState(0);
  const c = CHAPTERS[i]!;
  const last = i === CHAPTERS.length - 1;
  return (
    <div className="tut">
      <div className="tut-rail" role="tablist" aria-label="Chapters">
        {CHAPTERS.map((ch, k) => (
          <button key={ch.title} type="button" role="tab" aria-selected={k === i} className={k === i ? 'on' : k < i ? 'past' : ''} onClick={() => setI(k)}>
            <span>{k + 1}</span>{ch.title}
          </button>
        ))}
      </div>
      <article className="tut-page">
        <span className="tut-kicker">Learn to play · {i + 1} of {CHAPTERS.length}</span>
        <h1>{c.title}</h1>
        <div className={`tut-body ${c.aside ? 'with-aside' : ''}`}>
          <div className="tut-text">{c.body}</div>
          {c.aside && <div className="tut-aside">{c.aside}</div>}
        </div>
        <div className="row tut-nav">
          <Btn variant="ghost" onClick={() => (i === 0 ? go('home') : setI(i - 1))}>{i === 0 ? 'Home' : 'Back'}</Btn>
          {last
            ? <><Btn onClick={() => go('tokens')}>Print the tokens</Btn><Btn variant="primary" onClick={() => go('setup')}>Set up a battle</Btn></>
            : <Btn variant="primary" onClick={() => setI(i + 1)}>Next</Btn>}
        </div>
      </article>
    </div>
  );
}
