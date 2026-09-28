import type { WeaponKeyword } from '../types/units';

/** One-line, player-facing explanation of a weapon keyword. */
export function keywordText(kw: WeaponKeyword): string {
  const v = kw.v ?? 0;
  switch (kw.k) {
    case 'LONG RANGE':
      return `LONG RANGE: may fire at targets up to ${v}" away at -1 to hit.`;
    case 'PIERCE':
      return `PIERCE ${kw.tag} (${v}): if the target is ${kw.tag}, each damage die deals ${v} damage.`;
    case 'PRECISION':
      return `PRECISION (${v}): up to ${v} failed hit dice count as hits.`;
    case 'CRITICAL HIT':
      return `CRITICAL HIT (${v}): ${v} hits skip Armour and go straight to damage.`;
    case 'ANTI-EVADE':
      return `ANTI-EVADE (${v}): the target's Evade rolls are at -${v}.`;
    case 'SIDEARM':
      return 'SIDEARM: fires in addition to the main weapon, at the same or a different target.';
    case 'PINPOINT':
      return 'PINPOINT: may target an Engaged enemy Unit.';
    case 'INDIRECT FIRE':
      return 'INDIRECT FIRE: needs no Line of Sight. A target out of sight may Evade.';
    case 'INSTANT':
      return 'INSTANT: the target cannot use Reaction abilities against this attack.';
    case 'BULKY':
      return 'BULKY: cannot be used for a Defensive Attack.';
    case 'LOCKED IN':
      return `LOCKED IN (${v}): +${v} dice if the target has not moved this round.`;
    case 'BURST FIRE':
      return `BURST FIRE: +${v} dice per model if the target is within ${kw.range ?? 0}".`;
    case 'SPECIALIST':
      return 'SPECIALIST: carried by a single model.';
    case 'CONCENTRATED FIRE':
      return `CONCENTRATED FIRE (${v}): removes at most ${v} models.`;
    case 'BLAST TEMPLATE':
      return 'BLAST TEMPLATE: roll no Surge die. Set the template over the nearest model. The models it covers give both the extra dice and the Surge result.';
    default:
      return kw.v !== undefined ? `${kw.k} (${kw.v})` : kw.k;
  }
}

/** What a Status on a unit means, for the unit card and the tooltips. */
export function statusText(status: string): string {
  switch (status) {
    case 'Burrowed':
      return 'BURROWED: counts as Size 0 and may be shot at only by Units within 4". It heals when it activates.';
    case 'Hidden':
      return 'HIDDEN: it may not be targeted by Ranged Attacks from beyond 6". It may Evade.';
    case 'Siege Mode':
      return 'SIEGE MODE: it cannot Move, Run, Disengage, Charge or Close Ranks. It counts as Size 3 and may fire only the weapon that needs this Status.';
    default:
      return status;
  }
}

export function impactText(dice: number, hit: number, models: number): string {
  return `IMPACT: after a successful charge, roll ${dice} dice per model in the Fighting or Supporting rank (${models} models = ${dice * models} dice). Each ${hit}+ is a hit against your Armour roll, for 1 damage each, with no Surge.`;
}
