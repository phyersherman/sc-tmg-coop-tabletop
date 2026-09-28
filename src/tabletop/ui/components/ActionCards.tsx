import { combatRanks } from '@engine/sense/placement';
import { useState } from 'react';
import type { GameState } from '@engine/types/game';
import type { Command } from '@engine/director/reducer';
import { unitById } from '@data/index';
import { chargeOptions, checkCharge, playerWeapons, validTargets, targetReport } from '@engine/player/rules';
import { autoPay, cardDef, effectiveSpeed, playerResource, UNIT_ABILITIES, chargeMods } from '@engine/abilities/index';
import { useUi } from '@tt/store/uiStore';
import { Btn, Stepper } from './Basics';


/** An ability with options (Raynor's Orders): pick one, then its target. */
export function AbilityDraftCard({ g, dispatch }: { g: GameState; dispatch: (c: Command) => void }) {
  const ui = useUi();
  const d = ui.abilityDraft;
  if (!d) return null;
  const pu = g.playerUnits.find((p) => p.id === d.unitId);
  const spec = UNIT_ABILITIES[d.name];
  if (!pu || !spec) return null;
  const res = playerResource(g);
  return (
    <div className="panel accent action-card">
      <div className="row between"><h3 style={{ margin: 0 }}>{pu.name}: {d.name}</h3><Btn size="sm" variant="ghost" onClick={() => ui.setAbilityDraft(null)}>Cancel</Btn></div>
      <div className="stack">
        {(spec.options ?? []).map((o, i) => {
          const pay = autoPay(g, o.cost);
          return (
            <Btn key={i} variant="primary" disabled={!pay} title={pay ? `Pays with ${pay.map((c) => cardDef(c.defId)?.name).join(', ')}` : `Needs ${o.cost} ${res}`} onClick={() => {
              ui.setAbilityDraft(null);
              if (spec.target === 'friendly' || spec.target === 'enemy' || spec.target === 'point') ui.setPendingAbility({ kind: 'unit', unitId: pu.id, name: d.name, target: spec.target, range: spec.range, hint: spec.targetHint, option: i });
              else dispatch({ t: 'useAbility', unitId: pu.id, name: d.name, option: i });
            }}>{o.label} · {o.cost} {res}</Btn>
          );
        })}
      </div>
    </div>
  );
}

/** An ability or card boost is waiting for its target on the map. */
export function PendingAbilityCard({ g }: { g: GameState }) {
  const ui = useUi();
  const pa = ui.pendingAbility;
  if (!pa) return null;
  const pu = pa.unitId ? g.playerUnits.find((p) => p.id === pa.unitId) : undefined;
  return (
    <div className="panel accent action-card">
      <div className="row between"><h3 style={{ margin: 0 }}>{pu ? `${pu.name}: ` : ''}{pa.name}</h3><Btn size="sm" variant="ghost" onClick={() => ui.setPendingAbility(null)}>Cancel</Btn></div>
      <p className="ask">Click {pa.target === 'point' ? (pa.hint ?? 'a spot on the map') : pa.target === 'enemy' ? 'a highlighted enemy Unit' : `a highlighted friendly Unit${pa.hint ? ` (${pa.hint})` : ''}`}{pa.range ? `, within ${pa.range}"` : ''}.</p>
    </div>
  );
}
