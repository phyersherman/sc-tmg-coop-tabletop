/**
 * Reactions offered at the moment they trigger.
 *
 * The game stops on a `pendingReaction` whenever one of your Reactions could answer what just happened: an enemy
 * declaring a Ranged Attack or a Charge, the end of an enemy attack, your own successful Charge, a PLACE effect, or
 * Damage suffered outside an attack. Each Reaction is offered only while its condition holds, it has not been used
 * this round (once per game where the text says so), and its cost can be paid with Ready cards. You use one, or
 * decline, and the game goes on. The Reactions that answer an attack on the unit itself (Shield Overcharge,
 * Improved Barrier, Prophetic Vision, Zealous Round) and the ones that reduce its Damage (Life Support,
 * Transfusion) are offered in the saves step, where their numbers apply (see ui/hud/combatPools saveOptions).
 */
import type { GameState, PendingReaction } from '../types/game';
import type { PlayerUnit } from '../sense/types';
import { UNIT_ABILITIES, abilityCost, activeEffects, autoPay, cardDef, evadeFor, hasAbility, isHidden, ownerOf } from '../abilities/index';
import { playerUnitDef } from '../sense/playerUnits';
import { abilityGap, chargeOptions, damageHelpers } from './rules';

export interface ReactionOffer {
  /** `unitId:ability` for a unit's Reaction, `card:cardId:boost` for a card. */
  key: string;
  unitId: string;
  /** The unit that uses it (for a card: the unit it is used on). */
  unit: string;
  name: string;
  /** The rule, from the unit's or card's own text. */
  text: string;
  /** "1 PE", or '' when it is free. */
  cost: string;
  costAmount: number;
  /** A Tactical or Faction card's boost, not a unit's ability. */
  cardId?: string;
  /** Damage it takes off ('damage'). */
  reduce?: number;
}

const live = (pu: PlayerUnit) => pu.location === 'table' && !pu.destroyed;
const costOf = (pu: PlayerUnit, name: string): number => {
  const ab = playerUnitDef(pu).abilities.find((a) => a.name === name);
  return ab?.cost ? (ab.cost.amount === 'X' ? 1 : ab.cost.amount) : 0;
};
const affordable = (state: GameState, pu: PlayerUnit, cost: number) => cost <= 0 || !!autoPay(state, cost, [], ownerOf(pu));
/**
 * Whether a unit may still use this Reaction: it has it, has not used it this round (or game), its player has not
 * already resolved a Reaction in this Activation (Part 10.4), and it can pay.
 */
function ready(state: GameState, pu: PlayerUnit, name: string): boolean {
  if (!live(pu) || pu.summoned || !hasAbility(pu, name)) return false;
  if ((state.reacted ?? []).includes(ownerOf(pu))) return false;
  const spec = UNIT_ABILITIES[name];
  if (!spec?.repeatable && (pu.used ?? []).includes(name)) return false;
  if (spec?.once === 'game' && (pu.usedGame ?? []).includes(name)) return false;
  const ab = playerUnitDef(pu).abilities.find((a) => a.name === name);
  return affordable(state, pu, ab ? abilityCost(state, pu, ab).cost : costOf(pu, name));
}
function offer(pu: PlayerUnit, name: string): ReactionOffer {
  const ab = playerUnitDef(pu).abilities.find((a) => a.name === name)!;
  const cost = costOf(pu, name);
  return { key: `${pu.id}:${name}`, unitId: pu.id, unit: pu.name, name, text: ab.text, cost: cost > 0 && ab.cost ? `${cost} ${ab.cost.resource}` : '', costAmount: cost };
}
/** Base edge to base edge, between the closest models of the two units. */
const gapTo = (state: GameState, ru: PlayerUnit, side: 'ai' | 'players', id: string): number => (side === 'players' && ru.id === id ? 0 : abilityGap(state, ru, side, id) ?? Infinity);

/** The Reactions that can answer this moment right now. An empty list means the game goes on. */
export function reactionOffers(state: GameState, pr: PendingReaction): ReactionOffer[] {
  const kind = pr.kind ?? 'damage';
  const pu = state.playerUnits.find((p) => p.id === pr.unitId);
  if (!pu) return [];
  const mine = state.playerUnits.filter(live);
  if (kind === 'damage') {
    if (pu.destroyed || pr.amount <= 0) return [];
    return damageHelpers(state, pu).flatMap((h) => {
      const ru = state.playerUnits.find((x) => x.id === h.unitId);
      if (!ru || !ready(state, ru, h.name)) return [];
      return [{ ...offer(ru, h.name), reduce: Math.min(h.reduce, pr.amount) }];
    });
  }
  const ai = pr.aiUnitId ? state.army.units.find((u) => u.id === pr.aiUnitId) : undefined;
  // INSTANT: your Units cannot declare or resolve Reactions in response to the attack.
  if (pr.instant && (kind === 'aiRanged' || kind === 'afterAiRanged')) return [];
  if (kind === 'aiRanged') {
    if (!ai || ai.location !== 'table' || !live(pu)) return [];
    const out: ReactionOffer[] = [];
    // Hierarch's Stand: another friendly unit within 8" is the target, and this unit is one the attack could take.
    for (const ru of mine) {
      if (ru.id === pu.id || !ready(state, ru, 'Hierarch’s Stand')) continue;
      if (!(pr.validTargets ?? []).includes(ru.id) || gapTo(state, ru, 'players', pu.id) > 8.05) continue;
      out.push(offer(ru, 'Hierarch’s Stand'));
    }
    // Hallucination: the target, within 4" of the Sentry, may Evade. Offered only where it changes something.
    const canEvade = !!playerUnitDef(pu).stats.evade && !evadeFor(state, pu, { phase: 'Assault', weapon: '', attacker: { unitId: ai.id } });
    if (canEvade) {
      for (const ru of mine) {
        if (!ready(state, ru, 'Hallucination') || gapTo(state, ru, 'players', pu.id) > 4.05) continue;
        out.push(offer(ru, 'Hallucination'));
      }
    }
    // Debilitating Saliva: the attacker is within 8" of this unit. Once is enough: the DEBUFF does not stack.
    if (!(ai.debuffs ?? []).some((d) => d.source === 'Debilitating Saliva')) {
      for (const ru of mine) {
        if (!ready(state, ru, 'Debilitating Saliva') || gapTo(state, ru, 'ai', ai.id) > 8.05) continue;
        out.push(offer(ru, 'Debilitating Saliva'));
      }
    }
    return out;
  }
  if (kind === 'afterAiRanged') {
    if (!ai || ai.location !== 'table') return [];
    // Lunge: another friendly unit within 10" was the target; this unit is Unengaged.
    return mine.filter((ru) => ru.id !== pu.id && !ru.engaged && !isHidden(ru) && ready(state, ru, 'Lunge') && gapTo(state, ru, 'players', pu.id) <= 10.05).map((ru) => offer(ru, 'Lunge'));
  }
  if (kind === 'aiCharge') {
    if (!ai || ai.location !== 'table' || !live(pu)) return [];
    // Concussive Shells: the charge is against a friendly unit within 8" of this unit.
    if ((ai.statDebuffs ?? []).some((d) => d.stat === 'speed')) return [];
    return mine.filter((ru) => ready(state, ru, 'Concussive Shells') && gapTo(state, ru, 'players', pu.id) <= 8.05).map((ru) => offer(ru, 'Concussive Shells'));
  }
  if (kind === 'afterCharge') {
    // Lightning Dash: a second Charge needs a different Enemy Unit within reach.
    if (!live(pu) || pu.dashFrom || !ready(state, pu, 'Lightning Dash')) return [];
    const others = chargeOptions(state, pu).filter((c) => c.unit.id !== pr.targetId && !pu.engagedWith.includes(c.unit.id));
    return others.length ? [offer(pu, 'Lightning Dash')] : [];
  }
  if (kind === 'afterPlace') {
    // Veil of Shadows: the unit that was PLACEd resolves HEAL (2). Offered while it has Damage to heal.
    if (!live(pu) || pu.damageMarker <= 0) return [];
    return (state.playerCards ?? []).flatMap((c) => {
      if (c.exhausted || ownerOf(c) !== ownerOf(pu) || (state.reacted ?? []).includes(ownerOf(c))) return [];
      const b = cardDef(c.defId)?.boosts.find((x) => x.name === 'Veil of Shadows');
      return b ? [{ key: `card:${c.id}:${b.name}`, unitId: pu.id, unit: pu.name, name: b.name, text: b.text, cost: '', costAmount: 0, cardId: c.id }] : [];
    });
  }
  return [];
}

/** Whether a unit already has an Evade Roll against enemy attacks from one of these Reactions. */
export const grantedEvade = (pu: PlayerUnit): boolean => activeEffects(pu).some((e) => e.mods.mayEvade);

/** Words for the prompt: what happened, in the rulebook's terms. */
export function reactionMoment(state: GameState, pr: PendingReaction): string {
  const pu = state.playerUnits.find((p) => p.id === pr.unitId);
  const name = pu?.name ?? 'Your Unit';
  const ai = pr.aiUnitId ? state.army.units.find((u) => u.id === pr.aiUnitId) : undefined;
  const foe = ai?.label ?? 'The Enemy Unit';
  switch (pr.kind ?? 'damage') {
    case 'aiRanged': return `${foe} declares a Ranged Attack against ${name}.`;
    case 'afterAiRanged': return `${foe} has resolved its Ranged Attack against ${name}.`;
    case 'aiCharge': return `${foe} declares a Charge against ${name}.`;
    case 'afterCharge': return `${name} resolved a successful Charge.`;
    case 'afterPlace': return `${name} resolved a PLACE effect.`;
    default: return `${pr.source} deals ${pr.amount} Damage to ${name}.`;
  }
}
