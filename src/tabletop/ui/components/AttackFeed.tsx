import type { GameState } from '@engine/types/game';

/** Compact list of this round's attacks and the last charge, newest first. */
export function AttackFeed({ g, limit = 6 }: { g: GameState; limit?: number }) {
  const items = g.attackLog.slice(-limit).reverse();
  if (!items.length && !g.lastCharge) return null;
  return (
    <div className="feed">
      <h3>This round</h3>
      {g.lastCharge && (
        <div className={`feed-item ${g.lastCharge.side}`}>
          <b>{g.lastCharge.side === 'ai' ? g.army.units.find((u) => u.id === g.lastCharge!.unitId)?.label : g.playerUnits.find((p) => p.id === g.lastCharge!.unitId)?.name}</b> charges {g.lastCharge.side === 'ai' ? g.playerUnits.find((p) => p.id === g.lastCharge!.targetId)?.name : g.army.units.find((u) => u.id === g.lastCharge!.targetId)?.label}: rolled {g.lastCharge.rolls.join('/')}, reach {g.lastCharge.reach}" vs {g.lastCharge.needed.toFixed(1)}" → <b>{g.lastCharge.success ? 'in!' : 'short'}</b>
        </div>
      )}
      {items.map((a) => (
        <div key={a.id} className={`feed-item ${a.attacker.side}`}>
          <b>{a.attacker.label}</b> {a.phase === 'Impact' ? 'IMPACT on' : a.phase === 'Combat' ? 'strikes' : 'fires at'} <b>{a.defender.label}</b>: {a.hits}/{a.dice} hit{a.surge?.applied ? ` (+${a.surge.applied} Surge)` : ''}, {a.pendingSaves ? 'saves pending' : `${a.saved} saved, ${a.damage} dmg${a.removed ? `, −${a.removed} model${a.removed === 1 ? '' : 's'}` : ''}${a.destroyed ? ', destroyed' : ''}`}
        </div>
      ))}
    </div>
  );
}
