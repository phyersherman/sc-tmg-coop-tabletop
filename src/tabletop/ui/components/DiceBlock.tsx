import { useState } from 'react';
import type { DiceInstruction } from '@engine/units/weapons';
import { hitsFor } from '@engine/units/weapons';
import { Stepper } from './Basics';
import { DiceRoll } from './DiceRoll';
import type { Faction } from '@engine/types/units';

export function DiceBlock({ batch, showRolls, title, faction = 'Terran' }: { batch: DiceInstruction; showRolls: boolean; title?: string; faction?: Faction }) {
  const [models, setModels] = useState(batch.models);
  const { dice, hits } = hitsFor(batch, models);
  const roa = batch.models ? batch.dice / batch.models : batch.dice;
  const need = batch.hit - (batch.hitMod ?? 0);
  const surge = batch.surge ? Math.min(hits, batch.surgeRoll ?? 0) : 0;
  const rolls = (batch.rolls ?? []).slice(0, dice);
  const range = typeof batch.range === 'number' ? `${batch.range + (batch.rangeMod ?? 0)}"` : 'melee';
  return (
    <div className="panel" style={{ marginBottom: 10 }}>
      <div className="row between">
        <b style={{ fontFamily: 'var(--font-head)', fontSize: 17 }}>{title ?? batch.weapon}</b>
        <span className="tag">range {range}{batch.longRange ? ` / ${batch.longRange + (batch.rangeMod ?? 0)}" long` : ''} · {batch.target}</span>
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <span className="muted small">Models attacking</span>
        <Stepper value={models} onChange={setModels} min={0} max={batch.models} />
        <span className="mono">{dice} dice ({roa} × {models}), hit on {need}+{batch.hitMod ? ` (mod ${batch.hitMod > 0 ? '+' : ''}${batch.hitMod})` : ''}, DMG {batch.dmg}</span>
      </div>
      {showRolls ? (
        <>
          <DiceRoll faction={faction} rolls={rolls} need={need} surge={batch.surge ? { die: batch.surge.die, value: batch.surgeRoll ?? 1 } : undefined} />
          <p>
            <b>{hits} hit{hits === 1 ? '' : 's'}.</b>{' '}
            {batch.surge && hits > 0 && (
              <>If your unit is <b>{batch.surge.types.join(' or ')}</b>: {surge} hit{surge === 1 ? '' : 's'} skip Armour and go straight to damage; roll Armour saves for the other {hits - surge}. Otherwise roll Armour saves for all {hits}. </>
            )}
            {(!batch.surge || hits === 0) && hits > 0 && <>Roll Armour saves for {hits}. </>}
            Each failed save = {batch.dmg} damage.
          </p>
        </>
      ) : (
        <p>
          Roll {dice} dice, hits on {need}+. {batch.surge ? `Then roll the Surge die (${batch.surge.die}): if the target is ${batch.surge.types.join(' or ')}, that many hits skip Armour.` : ''} Each unsaved hit = {batch.dmg} damage.
        </p>
      )}
      {batch.keywordsText.length > 0 && (
        <ul className="small muted" style={{ margin: '6px 0 0 18px', padding: 0 }}>
          {batch.keywordsText.map((k, i) => (
            <li key={i}>{k}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
