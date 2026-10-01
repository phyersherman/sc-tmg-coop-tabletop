import type { WeaponKeyword } from '../types/units';

/** One-line, player-facing explanation of a weapon keyword. */
export function keywordText(kw: WeaponKeyword): string {
  const v = kw.v ?? 0;
  switch (kw.k) {
    case 'LONG RANGE':
      return `LONG RANGE (${v}): this weapon's maximum Range is ${v}". Each attacking model beyond the weapon's Range but Within ${v}" suffers -1 to Hit.`;
    case 'PIERCE':
      return `PIERCE ${kw.tag} (${v}): against a Unit with the ${kw.tag} Combat Tag, this weapon's Damage is ${v}.`;
    case 'PRECISION':
      return `PRECISION (${v}): after rolling to Hit, move up to ${v} failed Attack Dice into the Armour Pool as Hits.`;
    case 'CRITICAL HIT':
      return `CRITICAL HIT (${v}): move ${v} dice from the Armour Pool straight to the Damage Pool, never more than the pool holds.`;
    case 'ANTI-EVADE':
      return `ANTI-EVADE (${v}): the target Unit suffers -${v} to its Evade Roll against this attack.`;
    case 'SIDEARM':
      return 'SIDEARM: a model may use this weapon as well as its one weapon. Resolve it as a separate Batch, at the same or a different target.';
    case 'PINPOINT':
      return 'PINPOINT: may target an Engaged Enemy Unit.';
    case 'INDIRECT FIRE':
      return 'INDIRECT FIRE: may ignore Line of Sight. The target must be Within Range. A target not in Line of Sight may make an Evade Roll.';
    case 'INSTANT':
      return 'INSTANT: Enemy Units cannot declare or resolve Reactions in response to attacks with this weapon.';
    case 'BULKY':
      return 'BULKY: cannot be used to make a Ranged Attack while the Unit is Engaged.';
    case 'LOCKED IN':
      return `LOCKED IN (${v}): add ${v} to this weapon's RoA when the target Unit has the STATIONARY Status (it has not moved, been moved or been PLACED this Round).`;
    case 'BURST FIRE':
      return `BURST FIRE ${kw.range ?? 0}" (${v}): add ${v} to this weapon's RoA when the target is Within ${kw.range ?? 0}" of the attacking model.`;
    case 'SPECIALIST':
      return 'SPECIALIST: a Unit may include only one model equipped with this weapon.';
    case 'CONCENTRATED FIRE':
      return `CONCENTRATED FIRE (${v}): this attack removes no more than ${v} models. Discard any Total Damage left after that.`;
    case 'BLAST TEMPLATE':
      return 'BLAST TEMPLATE: roll no Surge Die. Centre the template on the target model. Generate one Attack Die for each model of the target Unit it covers, plus the number after BT on the profile. The Surge Result is the number of models covered.';
    case 'DODGE':
      return `DODGE (${v}): Surge and CRITICAL HIT move ${v} fewer dice from this Unit's Armour Pool to the Damage Pool.`;
    case 'TOUGH':
      return `TOUGH (${v}): when this Unit resolves an Armour Roll, change up to ${v} failed results into successes.`;
    default:
      return kw.v !== undefined ? `${kw.k} (${kw.v})` : kw.k;
  }
}

/** What a Status on a unit means, for the unit card and the tooltips. */
export function statusText(status: string): string {
  switch (status) {
    case 'Burrowed':
      return 'BURROWED: it is HIDDEN, its Size is 0, and its Supply is 0 for Disengage checks. It cannot Control or Contest Mission Markers. It may only Deploy, Move, Disengage, Run, Hold and Close Ranks, and all but Hold end the Status. It may make an Evade Roll against every attack.';
    case 'Hidden':
      return 'HIDDEN: it cannot be selected as the target of a Ranged Attack, or of a Special Ability that needs Line of Sight, unless the acting model is Within 4". It is immune to IMPACT. It may make an Evade Roll against every attack.';
    case 'Siege Mode':
      return 'SIEGE MODE: it cannot Move, Disengage, Run, Charge or Close Ranks. It may use only the weapons that name this Status. It counts as Size 3.';
    default:
      return status;
  }
}

export function impactText(dice: number, hit: number, models: number): string {
  return `IMPACT: after a successful charge, roll ${dice} dice per model in the Fighting or Supporting rank (${models} models = ${dice * models} dice). Each ${hit}+ is a hit against your Armour roll, for 1 damage each, with no Surge.`;
}
