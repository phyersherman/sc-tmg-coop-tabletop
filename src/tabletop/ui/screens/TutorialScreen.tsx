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
    title: 'The app is your opponent',
    body: (
      <>
        <p>Co-op Command plays the enemy army in the StarCraft Tabletop Miniatures Game, so one or two of you can play together against it. Your table is the battlefield: the models, the terrain and the dice there are the truth.</p>
        <p>The app decides what each enemy unit does, rolls its dice, keeps the Supply and the score, and asks you what happened. You move its models for it, the way its cards say.</p>
      </>
    ),
  },
  {
    title: 'Before the battle',
    body: (
      <>
        <ol>
          <li><b>Collection.</b> Tell the app which miniatures you own. The enemy is built only from models you own.</li>
          <li><b>Your army.</b> Each player builds a force with its cards. Any race, for either player.</li>
          <li><b>The enemy.</b> The app builds a hidden army from the models you are not fielding, of any race. You meet its units as they arrive.</li>
          <li><b>The table.</b> The setup map shows the deployment card, every terrain piece numbered, the Mission Markers, and what stands on the side markers. Set it all up, then start. After that the map is put away: your table is the map.</li>
        </ol>
      </>
    ),
  },
  {
    title: 'Reading the enemy',
    body: (
      <>
        <p>During the battle the screen shows each enemy unit on the table as a card: its Speed, Armour, Evade and HP, the models it has left, and whether it is damaged, Engaged, buffed or DEBUFFed.</p>
        <p>Every enemy unit type has two decks of action cards, one for the Movement phase and one for the Assault phase. When a unit activates, its type draws a card, and every unit of that type follows the same card for the rest of the phase. Read a card from the top down:</p>
        <ul>
          <li><b>➜ » ■ ✹ ⚡</b> move, run, hold, fire, charge: what the unit does, and what it does if it cannot.</li>
          <li><b>◆</b> an ability, used for free (the AI never pays Biomass, Command Points or Psionic Energy).</li>
          <li><b>✚</b> a buff until the End of the Round: the AI never reacts, so its reactions come as buffs.</li>
          <li><b>★</b> a Faction card boost, and who the AI uses it on.</li>
          <li><b>↻</b> the deck is shuffled back together next round.</li>
        </ul>
      </>
    ),
    aside: <SampleCard />,
  },
  {
    title: 'A turn at the table',
    body: (
      <>
        <p>Sides alternate one unit at a time, as in any game. On your turn, activate a unit on the table, then press <b>Done</b> (or <b>Pass</b> when you have nothing left this phase).</p>
        <p>On the enemy's turn the app shows the card and the unit it is for. Move the models as it says, using the reminders under the card: the focus is the nearest enemy by the shortest path, moves go round walls and never end within 1" of your models. If the card attacks, the app asks one question (is anything in range?), rolls the dice and tells you the hits; then tap what happened.</p>
        <p>When your attack lands, pick the enemy unit's card and enter the hits: the app rolls its Armour and Evade and removes the models.</p>
      </>
    ),
  },
  {
    title: 'Combat and scoring',
    body: (
      <>
        <p>There are no cards in the Combat phase. Tick which enemy units are Engaged, and every engaged unit fights as normal: the app rolls the enemy's dice and yours are rolled on the table.</p>
        <p>At Scoring, tell the app who holds each marker and what you lost. It keeps the VP, the Supply Pool and the round-by-round score, and brings back destroyed enemy units depending on the difficulty.</p>
      </>
    ),
  },
  {
    title: 'Co-op missions',
    body: (
      <>
        <p>Each co-op mission has a main objective: hold the Temple, stop the trains, survive the nights, guard your base from the Thrashers, close the rifts, lock the markers, or gather terrazine. The strip under the score always says where you stand, and when the next Scoring can lose the battle.</p>
        <p>Most of the enemy goes after that objective. The other markers, the <b>side markers</b>, are a choice: leaving the objective to take one costs you units and time, and pays you back with a reward.</p>
      </>
    ),
  },
  {
    title: 'Side markers: guards and Structures',
    body: (
      <>
        <p>At the start of a co-op mission something of the enemy's stands on each side marker. Table setup lists which, and which token goes beside it.</p>
        <ul>
          <li><b>A guard</b> is a real enemy unit, a copy of its cheapest Core unit, set on the marker before round 1 (spare models or stand-ins). It holds the marker and never leaves it: it shoots what it can see and fights what comes to it, and it does not come back once destroyed. Put a <b>Guard</b> token beside it.</li>
          <li><b>A Structure</b> (a Refinery, an Extractor or an Assimilator) stands on the marker and never fights back, but takes a lot to bring down. Use any building you have, or its printed token; its HP and Armour are on the token.</li>
        </ul>
        <p>The rest of the enemy leaves side markers alone: it is up to you whether to go for them.</p>
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
          <li>The player whose unit holds it earns the marker's reward, for the <b>next round only</b>. Used then or lost. With two players level on it, you choose who takes it.</li>
        </ol>
        <p>Gold rewards go to one unit (Reinforce brings a destroyed unit back, Firepower gives one unit +1 RoA). Blue ones go to one player (Requisition: +2 Supply). Violet ones change the mission itself and apply on their own. Print the tokens and set each beside its marker, so everyone can see what it is worth.</p>
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

/** Learn to play: how a battle runs with the app, one short chapter at a time. */
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
