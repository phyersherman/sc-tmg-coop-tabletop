import type { GameEvent, GameState } from '@engine/types/game';
import type { Command } from '@engine/director/reducer';
import type { AttackParams, AttackResult } from '@engine/combat/resolve';
import type { Faction } from '@engine/types/units';
import { chargeImpactSetup, playerAttackSetup, withLeader } from '@engine/director/reducer';
import { resolveAttack } from '@engine/combat/resolve';
import { Rng } from '@engine/rng';
import { unitById } from '@data/index';
import { abilityGap, aiPos, chargeOptions, damageHelpers, modelsWithin, playerPos, playerWeapons } from '@engine/player/rules';
import { playerUnitDef } from '@engine/sense/playerUnits';
import { SAVE_BOOSTS, SELF_REACTIONS, UNIT_ABILITIES, cardDef, chargeMods, effectiveSpeed, evadeFor, ownerOf, passiveTough } from '@engine/abilities/index';

/**
 * The Combat Tray's model: one attack or charge as a row of dice pools (ATTACK ▸ SURGE ▸ ARMOUR ▸ EVADE ▸ DAMAGE,
 * or CHARGE ▸ IMPACT ▸ …). Pure functions so the sequence can be tested without the UI.
 */

export type PoolId = 'charge' | 'impact' | 'attack' | 'surge' | 'armour' | 'evade' | 'damage';

export interface Pool {
  id: PoolId;
  label: string;
  /** Who rolls these dice: you (Roll / Enter from table) or the AI (animates on its own). */
  owner: 'you' | 'ai';
  /** Which unit's side throws them. */
  roller: 'attacker' | 'defender';
  dice: number;
  /** X+ to succeed, or null for a plain value (Surge, charge). */
  need: number | null;
  /** The dice faces, [] when only the count is known (entered from the table), null while not rolled yet. */
  faces: number[] | null;
  successes: number | null;
  /** Entering from the table: a count of successes, or a die value. */
  entry: 'count' | 'value';
  /** Highest value for a value entry (D3 = 3). */
  maxValue?: number;
  /** Ask how many successes were 6s (CRITICAL HIT, PRECISION). */
  sixes?: boolean;
  note?: string;
  /** Charge reach against the distance needed. */
  bar?: { reach: number; needed: number };
  /** DAMAGE pool outcome. */
  outcome?: { damage: number; removed: number; destroyed: boolean; tone: 'kill' | 'hurt' | 'safe' };
}

export interface CombatInput {
  attack?: number[];
  surge?: number;
  charge?: number[];
  impact?: number[];
  armour?: number[];
  evade?: number[];
  boosts: string[];
  reactions: string[];
}

type ChargeEvent = Extract<GameEvent, { kind: 'charge' }>;

/** What was known when the combat opened, so the tray still reads right after the target is destroyed. */
export interface CombatMeta {
  attacker: string;
  defender: string;
  attackerFaction: Faction;
  defenderFaction: Faction;
  weapon?: string;
  dice?: number;
  need?: number;
  crit?: boolean;
  surgeDie?: string;
  surgeTypes?: string[];
  models?: number;
  speed?: number;
  bonus?: number;
  needed?: number;
  twoDice?: boolean;
  impact?: { dice: number; need: number };
}

export interface CombatItem {
  key: string;
  /** The attacking side. */
  side: 'ai' | 'players';
  attackerId: string;
  defenderId: string;
  meta: CombatMeta;
  /** Your attack or charge, not sent to the rules engine yet. */
  plan?: { kind: 'attack'; unitId: string; weaponId: string; targetId: string; models: number } | { kind: 'charge'; unitId: string; targetId: string; leaderIndex?: number };
  /** Your action was sent: waiting for its result. */
  sent?: boolean;
  charge?: ChargeEvent;
  attack?: AttackResult;
  /** An AI attack waiting for your saves. */
  pending?: AttackResult;
  input: CombatInput;
  /** Results to acknowledge when the tray closes (the AI waits for them). */
  ackIds: string[];
  /** Shown already landed (no animation). */
  settled?: boolean;
}

export const emptyInput = (): CombatInput => ({ boosts: [], reactions: [] });

const surgeMax = (die?: string) => (die === 'D6' ? 6 : die === 'D3+1' ? 4 : die === 'BT' ? 12 : 3);
const count = (faces: number[], need: number) => faces.filter((f) => f >= need).length;
const factionOf = (g: GameState, side: 'ai' | 'players', id: string): Faction => {
  if (side === 'ai') { const u = g.army.units.find((x) => x.id === id); return u ? unitById(u.defId).faction : g.config.aiFaction; }
  const pu = g.playerUnits.find((p) => p.id === id);
  return pu ? playerUnitDef(pu).faction : 'Terran';
};
const nameOf = (g: GameState, side: 'ai' | 'players', id: string) => (side === 'ai' ? g.army.units.find((u) => u.id === id)?.label : g.playerUnits.find((p) => p.id === id)?.name) ?? 'Unit';

/** Dice count and target number for a picked attack (long range included). */
export function attackRollSpec(g: GameState, pa: { unitId: string; weaponId: string; targetId: string; models: number }) {
  const au = g.playerUnits.find((p) => p.id === pa.unitId);
  const tu = g.army.units.find((u) => u.id === pa.targetId);
  const w = au ? playerWeapons(g, au).find((x) => x.id === pa.weaponId) : undefined;
  if (!au || !tu || !w) return null;
  const from = playerPos(g, au);
  const tp = aiPos(g, tu);
  const longRange = w.range !== 'E' && !!from && !!tp && Math.hypot(from.x - tp.x, from.y - tp.y) > w.range;
  return { au, tu, w, dice: pa.models * w.roa, need: Math.min(7, w.hit + (longRange ? 1 : 0)), longRange, faction: playerUnitDef(au).faction };
}

/** Faces standing in for dice rolled on the table: `successes` of them made `need`, `sixes` of those were 6s. */
export function facesFromCount(dice: number, successes: number, sixes: number, need: number): number[] {
  const hitFace = Math.min(6, Math.max(1, need));
  const miss = Math.max(1, Math.min(hitFace - 1, 1));
  return Array.from({ length: Math.max(0, dice) }, (_, i) => (i < sixes ? 6 : i < successes ? hitFace : miss));
}

/** A new tray entry for your picked attack. */
export function planAttack(g: GameState, pa: { unitId: string; weaponId: string; targetId: string; models: number }): CombatItem | null {
  const spec = attackRollSpec(g, pa);
  const setup = playerAttackSetup(g, { t: 'playerAttack', ...pa });
  if (!spec || !setup) return null;
  const w = setup.params.weapon;
  return {
    key: `attack:${pa.unitId}:${pa.targetId}:${pa.weaponId}:${g.log.length}`,
    side: 'players',
    attackerId: pa.unitId,
    defenderId: pa.targetId,
    plan: { kind: 'attack', ...pa },
    meta: {
      attacker: spec.au.name, defender: spec.tu.label, attackerFaction: spec.faction, defenderFaction: g.config.aiFaction,
      weapon: w.name, dice: w.roa * setup.params.models, need: Math.min(7, w.hit - (setup.params.hitMod ?? 0)), models: setup.params.models,
      crit: w.keywords.some((k) => /CRITICAL|PRECISION/i.test(k.k)),
      surgeDie: w.surgeTypes.length && w.surgeDie ? w.surgeDie : undefined, surgeTypes: w.surgeTypes,
    },
    input: emptyInput(),
    ackIds: [],
  };
}

/** A new tray entry for your picked charge. */
export function planCharge(g: GameState, pc: { unitId: string; targetId: string; leaderIndex?: number }): CombatItem | null {
  const cu = g.playerUnits.find((p) => p.id === pc.unitId);
  const tu = g.army.units.find((u) => u.id === pc.targetId);
  if (!cu || !tu) return null;
  // Measured from the model you picked to lead the charge.
  const lg = pc.leaderIndex ? withLeader(g, pc.unitId, pc.leaderIndex) : g;
  const lu = lg.playerUnits.find((p) => p.id === cu.id);
  const opt = lu ? chargeOptions(lg, lu).find((c) => c.unit.id === pc.targetId) : undefined;
  if (!opt) return null;
  const cm = chargeMods(cu);
  const def = playerUnitDef(cu);
  return {
    key: `charge:${pc.unitId}:${pc.targetId}:${g.log.length}`,
    side: 'players',
    attackerId: pc.unitId,
    defenderId: pc.targetId,
    plan: { kind: 'charge', ...pc },
    meta: {
      attacker: cu.name, defender: tu.label, attackerFaction: def.faction, defenderFaction: g.config.aiFaction,
      speed: effectiveSpeed(cu), bonus: cm.bonus, needed: opt.needed, twoDice: cm.twoDice,
      impact: def.impact ? { dice: def.impact.dice * cu.models, need: Math.max(2, def.impact.hit - cm.impactHit) } : undefined,
    },
    input: emptyInput(),
    ackIds: [],
  };
}

/** A tray entry for a result that happened without you rolling (AI attacks and charges). */
export function resultItem(g: GameState, from: { attack?: AttackResult; pending?: AttackResult; charge?: ChargeEvent }): CombatItem {
  const a = from.attack ?? from.pending;
  const side = a ? a.attacker.side : from.charge!.side;
  const attackerId = a ? a.attacker.unitId : from.charge!.unitId;
  const defenderId = a ? a.defender.unitId : from.charge!.targetId;
  const foe = side === 'ai' ? 'players' : 'ai';
  const ackIds: string[] = [];
  if (from.charge) ackIds.push(chargeAckId(from.charge));
  if (a) ackIds.push(a.id);
  return {
    key: `result:${a?.id ?? chargeAckId(from.charge!)}`,
    side, attackerId, defenderId,
    meta: { attacker: a?.attacker.label ?? nameOf(g, side, attackerId), defender: a?.defender.label ?? nameOf(g, foe, defenderId), attackerFaction: factionOf(g, side, attackerId), defenderFaction: factionOf(g, foe, defenderId), weapon: a?.weapon },
    charge: from.charge, attack: from.attack, pending: from.pending,
    input: emptyInput(),
    ackIds,
  };
}

/** Same key the game screen uses to hold the AI until a charge result is continued. */
export const chargeAckId = (c: { round: number; unitId: string; reach: number; targetId: string }) => `charge:${c.round}:${c.unitId}:${c.reach}:${c.targetId}`;

/** Cards and reactions you may use before your Armour roll, and your Evade. */
export function saveOptions(g: GameState, a: AttackResult) {
  const pu = g.playerUnits.find((p) => p.id === a.defender.unitId);
  // Only the defending player's own cards: a Tactical card is played by the player who brought it.
  const boosts = pu ? (g.playerCards ?? []).filter((c) => !c.exhausted && ownerOf(c) === ownerOf(pu)).flatMap((c) => {
    const d = cardDef(c.defId);
    const b = d?.boosts.find((x) => SAVE_BOOSTS[x.name] && SAVE_BOOSTS[x.name]!.filter(pu));
    return d && b ? [{ cardId: c.id, name: b.name, card: d.name, text: SAVE_BOOSTS[b.name]!.text }] : [];
  }) : [];
  // Reactions to damage, offered while you roll the saves. "Within 4"" is measured as every range is: base edge
  // to base edge, between the closest models of the two units, not from one leading model to the other.
  /** A reaction offered while you roll saves: from a friendly unit nearby, or from the unit itself. */
  type Reaction = { key: string; unitId: string; unit: string; name: string; reduce: number; cost: string; tough?: number; capDmg?: number; evade?: number; note?: string };
  const helpers: Reaction[] = pu ? damageHelpers(g, pu) : [];
  // The unit's own Reactions to being attacked: soak the damage, harden the armour, cap it, or vanish into a roll.
  const own: Reaction[] = pu && !pu.destroyed && pu.location === 'table' ? unitById(pu.defId).abilities.flatMap((ab): Reaction[] => {
    const r = SELF_REACTIONS.find((x) => x.name === ab.name);
    if (!r || !r.ok(g, pu)) return [];
    const spec = UNIT_ABILITIES[ab.name];
    if (!spec?.repeatable && (pu.used ?? []).includes(ab.name)) return [];
    return [{
      key: `${pu.id}:${ab.name}`, unitId: pu.id, unit: pu.name, name: ab.name,
      reduce: r.reduce ?? 0, tough: r.tough, capDmg: r.capDmg, evade: r.evade, note: r.note,
      cost: ab.cost ? `${ab.cost.amount} ${ab.cost.resource}` : '',
    }];
  }) : [];
  const reactions = [...own, ...helpers];
  return { pu, boosts, reactions, evade: pu ? evadeFor(g, pu, a) : null, armour: pu ? unitById(pu.defId).stats.armour : a.armour };
}

/** Your Armour roll against a pending AI attack, with the boosts you picked. */
function savesMath(g: GameState, a: AttackResult, input: CombatInput) {
  const opts = saveOptions(g, a);
  const chosen = opts.boosts.filter((b) => input.boosts.includes(b.cardId)).map((b) => SAVE_BOOSTS[b.name]!);
  // DODGE sends Surge hits back to the Armour pool; TOUGH turns failed saves into successes.
  const back = Math.min(a.surge?.applied ?? 0, chosen.reduce((n, b) => n + (b.dodge ?? 0), 0));
  const reacting = opts.reactions.filter((r) => input.reactions.includes(r.key));
  const tough = chosen.reduce((n, b) => n + (b.tough ?? 0), 0) + reacting.reduce((n, r) => n + (r.tough ?? 0), 0) + (opts.pu ? passiveTough(opts.pu) : 0);
  const reduce = chosen.reduce((n, b) => n + (b.reduce ?? 0), 0) + reacting.reduce((n, r) => n + r.reduce, 0);
  const toSave = a.hits - (a.surge?.applied ?? 0) - a.critical + back;
  // No Armour dice to roll (every hit skipped Armour by Surge or CRITICAL HIT) counts as the Armour step done, or
  // the Evade step after it could never be reached: it would wait on saves nobody can make.
  const made = input.armour ? count(input.armour, opts.armour) : toSave <= 0 ? 0 : null;
  const saved = made === null ? null : Math.min(toSave, made + tough);
  const pool = saved === null ? null : a.hits - saved;
  // Prophetic Vision replaces the Evade value outright; Improved Barrier caps the weapon's Damage.
  const forced = reacting.find((r) => r.evade !== undefined);
  const evade = forced ? { value: forced.evade!, reason: forced.name } : opts.evade;
  const capDmg = reacting.reduce((n: number | undefined, r) => (r.capDmg === undefined ? n : Math.min(n ?? Infinity, r.capDmg)), undefined);
  return { ...opts, evade, capDmg, toSave, back, tough, reduce, made, saved, pool };
}

function damagePool(a: AttackResult | undefined, roller: 'attacker' | 'defender', note?: string): Pool {
  return {
    id: 'damage', label: 'DAMAGE', owner: 'ai', roller, dice: 0, need: null, faces: a ? [] : null, successes: a ? a.damage : null, entry: 'count',
    note: a ? (a.dmgPer > 1 && a.damage ? `${a.dmgPer} damage per hit` : undefined) : note,
    outcome: a ? { damage: a.damage, removed: a.removed, destroyed: a.destroyed, tone: a.destroyed || a.removed ? 'kill' : a.damage ? 'hurt' : 'safe' } : undefined,
  };
}

/** Armour, Evade and Damage pools of an attack whose hits are known. */
function defencePools(g: GameState, item: CombatItem, a: AttackResult | undefined): Pool[] {
  const out: Pool[] = [];
  const youDefend = item.side === 'ai';
  const p = item.pending;
  if (p && !a) {
    const m = savesMath(g, p, item.input);
    const owner = youRollSaves(g, p) ? 'you' : 'ai';
    out.push({
      id: 'armour', label: 'ARMOUR', owner, roller: 'defender', dice: m.toSave, need: m.armour, faces: m.toSave === 0 ? [] : item.input.armour ?? null, successes: m.saved, entry: 'count',
      note: [m.back ? `DODGE: ${m.back} Surge hit${m.back === 1 ? '' : 's'} back` : '', m.tough ? `TOUGH (${m.tough})` : '', m.reduce ? `−${m.reduce} damage` : ''].filter(Boolean).join(' · ') || undefined,
    });
    if (m.evade && (m.pool === null || m.pool > 0)) {
      out.push({ id: 'evade', label: 'EVADE', owner, roller: 'defender', dice: m.pool ?? 0, need: m.evade.value, faces: m.pool === null ? null : item.input.evade ?? null, successes: item.input.evade ? count(item.input.evade, m.evade.value) : null, entry: 'count', note: m.evade.reason });
    }
    out.push(damagePool(undefined, 'attacker', m.capDmg !== undefined ? `Damage capped at ${m.capDmg} per hit` : undefined));
    return out;
  }
  if (!a && item.plan?.kind === 'attack') return [...previewDefence(g, item), damagePool(undefined, 'attacker')];
  if (!a) {
    out.push({ id: 'armour', label: 'ARMOUR', owner: 'ai', roller: 'defender', dice: 0, need: null, faces: null, successes: null, entry: 'count' });
    out.push(damagePool(undefined, 'attacker'));
    return out;
  }
  const toSave = a.hits - (a.surge?.applied ?? 0) - a.critical;
  if (a.hits > 0) {
    const faces = item.input.armour ?? (a.saveRolls.length ? a.saveRolls : []);
    out.push({
      id: 'armour', label: 'ARMOUR', owner: youDefend ? 'you' : 'ai', roller: 'defender', dice: Math.max(0, toSave), need: a.armour, faces, successes: a.saved, entry: 'count',
      note: [toSave <= 0 ? 'Every hit skips Armour' : '', a.toughUsed ? `TOUGH (${a.toughUsed})` : ''].filter(Boolean).join(' · ') || undefined,
    });
  }
  if (a.evade) out.push({ id: 'evade', label: 'EVADE', owner: youDefend ? 'you' : 'ai', roller: 'defender', dice: item.input.evade?.length ?? a.evade.rolls.length, need: a.evade.value, faces: item.input.evade ?? a.evade.rolls, successes: a.evade.saved, entry: 'count', note: a.evade.reason });
  out.push(damagePool(a, 'attacker'));
  return out;
}

/** You roll your own saves when you asked to, or when a Ready card or reaction could change them. */
export function youRollSaves(g: GameState, a: AttackResult): boolean {
  // Your saves are always yours to roll in the simulation, as on a table.
  if (g.config.options.manualSaves || g.config.playMode === 'video') return true;
  const o = saveOptions(g, a);
  return o.boosts.length > 0 || o.reactions.length > 0;
}

/** The command for your attack with the dice rolled so far. */
function attackCommand(item: CombatItem): Extract<Command, { t: 'playerAttack' }> | null {
  if (item.plan?.kind !== 'attack') return null;
  const pa = item.plan;
  return { t: 'playerAttack', unitId: pa.unitId, weaponId: pa.weaponId, targetId: pa.targetId, models: pa.models, rolls: item.input.attack, surge: item.input.surge, saveRolls: item.input.armour, evadeRolls: item.input.evade };
}

/**
 * Whether this attack's Surge can do anything: the weapon has a Surge die and the target carries one of its Surge
 * types. A Surge that cannot apply is never rolled, so nothing may wait on it.
 */
function surgeCanApply(g: GameState, item: CombatItem): boolean {
  const src = item.attack ?? item.pending;
  if (src?.surge) return src.surge.matched;
  if (!item.meta.surgeDie) return false;
  const defender = item.side === 'players' ? g.army.units.find((u) => u.id === item.defenderId) : g.playerUnits.find((p) => p.id === item.defenderId);
  return !!defender && (item.meta.surgeTypes ?? []).some((t) => (unitById(defender.defId).tags as string[]).includes(t));
}

/**
 * Your attack before it is applied: the AI's Armour and Evade are rolled step by step in the tray, previewed with the
 * same rules the engine uses, and the attack is applied (damage, casualties) only once every die is in.
 */
function previewDefence(g: GameState, item: CombatItem): Pool[] {
  const cmd = attackCommand(item);
  const setup = cmd ? playerAttackSetup(g, cmd) : null;
  // A Surge is waited for only when it is actually rolled: not for a Blast Template, which rolls none, and not
  // against a target the weapon's Surge types do not match, where no Surge step is ever shown.
  const surgeNeeded = !!item.meta.surgeDie && item.meta.surgeDie !== 'BT' && surgeCanApply(g, item);
  const hitsKnown = !!item.input.attack && (!surgeNeeded || item.input.surge !== undefined || count(item.input.attack, item.meta.need ?? 4) === 0);
  return previewSaves(item, setup?.params ?? null, hitsKnown);
}

/**
 * A charge's IMPACT before it is applied: the same preview, from the dice you rolled for IMPACT, so the target's
 * Armour and Evade are rolled in the tray and the charge only resolves once every die has landed.
 */
function previewImpact(g: GameState, item: CombatItem): Pool[] {
  if (item.plan?.kind !== 'charge') return [];
  const pc = item.plan;
  const roll = Math.max(...(item.input.charge ?? [1]));
  const setup = chargeImpactSetup(g, { t: 'playerCharge', unitId: pc.unitId, targetId: pc.targetId, roll, impactRolls: item.input.impact, leaderIndex: pc.leaderIndex });
  return previewSaves(item, setup?.params ?? null, !!item.input.impact);
}

/** The defender's Armour and Evade for an attack that has not been applied yet, worked out with the engine's own rules. */
function previewSaves(item: CombatItem, params: AttackParams | null, hitsKnown: boolean): Pool[] {
  if (!params || !hitsKnown) return [{ id: 'armour', label: 'ARMOUR', owner: 'ai', roller: 'defender', dice: 0, need: null, faces: null, successes: null, entry: 'count' }];
  const setup = { params };
  const before = resolveAttack(Rng.from(1), { ...setup.params, manualSaves: true });
  const toSave = before.hits - (before.surge?.applied ?? 0) - before.critical;
  const out: Pool[] = [];
  if (before.hits === 0) return out;
  const saves = item.input.armour ?? (toSave <= 0 ? [] : null);
  const after = saves ? resolveAttack(Rng.from(1), { ...setup.params, presetSaves: saves, presetEvade: item.input.evade ?? Array(99).fill(1) }) : null;
  out.push({
    id: 'armour', label: 'ARMOUR', owner: 'ai', roller: 'defender', dice: Math.max(0, toSave), need: before.armour, faces: saves, successes: after ? after.saved : null, entry: 'count',
    note: [toSave <= 0 ? 'Every hit skips Armour' : '', after?.toughUsed ? `TOUGH (${after.toughUsed})` : ''].filter(Boolean).join(' · ') || undefined,
  });
  if (after?.evade) {
    out.push({ id: 'evade', label: 'EVADE', owner: 'ai', roller: 'defender', dice: after.evade.rolls.length, need: after.evade.value, faces: item.input.evade ?? null, successes: item.input.evade ? after.evade.saved : null, entry: 'count', note: after.evade.reason });
  }
  return out;
}

/** The pools of a combat, in order, filled in as far as the dice are known. */
export function buildPools(g: GameState, item: CombatItem): Pool[] {
  const { meta, input } = item;
  const a = item.attack;
  const you = item.side === 'players' ? 'you' : 'ai';
  const out: Pool[] = [];
  const isCharge = item.plan?.kind === 'charge' || !!item.charge;
  if (isCharge) {
    const c = item.charge;
    const faces = input.charge ?? c?.rolls ?? null;
    const roll = faces?.length ? Math.max(...faces) : null;
    const reach = c ? c.reach : roll === null ? null : (meta.speed ?? 0) + roll + (meta.bonus ?? 0);
    const needed = c ? c.needed : meta.needed ?? 0;
    const success = reach === null ? null : reach >= needed;
    out.push({
      id: 'charge', label: 'CHARGE', owner: you, roller: 'attacker', dice: faces?.length ?? (meta.twoDice ? 2 : 1), need: null, faces, successes: roll, entry: 'value', maxValue: 6,
      note: c || meta.speed === undefined ? (meta.twoDice ? '2D6, highest' : undefined) : `Speed ${meta.speed}"${meta.bonus ? ` + ${meta.bonus}"` : ''} + ${meta.twoDice ? '2D6 (highest)' : 'D6'}`,
      bar: reach === null ? undefined : { reach, needed },
    });
    if (success === false) return out;
    const impactResult = a && a.phase === 'Impact' ? a : undefined;
    const impactPending = item.pending && item.pending.phase === 'Impact' ? item.pending : undefined;
    const hasImpact = item.side === 'players' ? !!meta.impact : !!(impactResult ?? impactPending);
    if (!hasImpact) return out;
    const src = impactResult ?? impactPending;
    const impactFaces = input.impact ?? src?.rolls ?? null;
    const impactNeed = src?.hit ?? meta.impact?.need ?? 4;
    out.push({ id: 'impact', label: 'IMPACT', owner: you, roller: 'attacker', dice: src?.dice ?? meta.impact?.dice ?? 0, need: impactNeed, faces: success === null ? null : impactFaces, successes: src ? src.hits : impactFaces ? count(impactFaces, impactNeed) : null, entry: 'count' });
    if (!impactResult && item.plan?.kind === 'charge') return [...out, ...previewImpact(g, item), damagePool(undefined, 'attacker')];
    return [...out, ...defencePools(g, item, impactResult)];
  }
  const src = a ?? item.pending;
  const need = src?.hit ?? meta.need ?? 4;
  const attackFaces = input.attack ?? src?.rolls ?? null;
  out.push({
    id: 'attack', label: 'ATTACK', owner: you, roller: 'attacker', dice: src?.dice ?? meta.dice ?? 0, need, faces: attackFaces,
    successes: src ? src.hits : attackFaces ? count(attackFaces, need) : null, entry: 'count', sixes: meta.crit,
    note: src?.precisionUsed ? `incl. ${src.precisionUsed} from PRECISION` : meta.models ? `${meta.models} model${meta.models === 1 ? '' : 's'} · ${meta.weapon}` : src?.weapon,
  });
  const surgeDie = src?.surge?.die ?? meta.surgeDie;
  // The Surge die is only rolled when it can apply: the target has one of the weapon's Surge types.
  const defender = item.side === 'players' ? g.army.units.find((u) => u.id === item.defenderId) : g.playerUnits.find((p) => p.id === item.defenderId);
  void defender;
  const surgeApplies = surgeCanApply(g, item);
  if (surgeDie && surgeApplies) {
    const hitsSoFar = out[0]!.successes;
    const noHits = hitsSoFar === 0 && !meta.crit;
    // A Blast Template rolls no Surge die: its Surge is however many models the template covered, so the step
    // shows that number instead of asking for a roll.
    const blast = surgeDie === 'BT';
    const faces = blast ? [] : input.surge !== undefined ? [input.surge] : src?.surge ? [src.surge.roll] : noHits ? [] : null;
    // Before your attack is applied, the same rules preview what the Surge did.
    const cmd = !src && (blast || input.surge !== undefined) ? attackCommand(item) : null;
    const setup = cmd ? playerAttackSetup(g, cmd) : null;
    const sv = setup ? resolveAttack(Rng.from(1), { ...setup.params, manualSaves: true }).surge : src?.surge;
    out.push({
      id: 'surge', label: blast ? 'TEMPLATE' : 'SURGE', owner: you, roller: 'attacker', dice: blast ? 0 : 1, need: null, faces, successes: sv ? sv.applied : null, entry: 'value', maxValue: surgeMax(surgeDie),
      note: blast
        ? `${sv?.roll ?? 0} model${sv?.roll === 1 ? '' : 's'} under the template${sv?.matched ? ` · ${sv.applied} hit${sv.applied === 1 ? '' : 's'} skip Armour` : ''}`
        : sv ? (sv.matched ? `${sv.applied} hit${sv.applied === 1 ? '' : 's'} skip Armour${src?.critical ? ` · CRITICAL ${src.critical}` : ''}` : 'No matching target type') : noHits ? 'No hits' : `${surgeDie} · ${(meta.surgeTypes ?? []).join('/')}`,
    });
  } else if (src?.critical) {
    out[0]!.note = `${out[0]!.note ? `${out[0]!.note} · ` : ''}CRITICAL: ${src.critical} skip Armour`;
  }
  return [...out, ...defencePools(g, item, a)];
}

/** The command to send once your dice are in, or null while something is still to be rolled. */
export function commandFor(g: GameState, item: CombatItem): Command | null {
  const pools = buildPools(g, item);
  if (item.plan && !item.sent) {
    // Your attack waits for every die, the AI's Armour and Evade included; a charge for your own dice.
    // Your attack and your charge both wait for every die, the target's Armour and Evade included.
    const needed = pools.filter((p) => p.id !== 'damage');
    if (needed.some((p) => p.faces === null)) return null;
    if (item.plan.kind === 'attack') return attackCommand(item);
    const pc = item.plan;
    const roll = Math.max(...(item.input.charge ?? [1]));
    return { t: 'playerCharge', unitId: pc.unitId, targetId: pc.targetId, roll, impactRolls: item.input.impact, impactSaveRolls: item.input.armour, impactEvadeRolls: item.input.evade, leaderIndex: pc.leaderIndex };
  }
  if (item.pending && !item.attack) {
    const mine = pools.filter((p) => p.id === 'armour' || p.id === 'evade');
    if (mine.some((p) => p.faces === null)) return null;
    const m = savesMath(g, item.pending, item.input);
    const evadePool = pools.find((p) => p.id === 'evade');
    return {
      t: 'enterSaves',
      saved: m.made ?? 0,
      evaded: evadePool?.successes ?? undefined,
      boostCards: item.input.boosts,
      reactions: m.reactions.filter((r) => item.input.reactions.includes(r.key)).map((r) => ({ unitId: r.unitId, name: r.name, reduce: r.reduce })),
    };
  }
  return null;
}

/**
 * Your saves against a pending AI attack, rolled by the app: Armour, then Evade on what got through when the
 * unit has one. A way out of the saves step that does not depend on the tray — the game must never be stuck there.
 */
export function autoSaves(g: GameState, a: AttackResult): Extract<Command, { t: 'enterSaves' }> {
  const d6 = () => 1 + Math.floor(Math.random() * 6);
  const first = savesMath(g, a, emptyInput());
  const armourFaces = Array.from({ length: Math.max(0, first.toSave) }, d6);
  const m = savesMath(g, a, { ...emptyInput(), armour: armourFaces });
  const pool = m.pool ?? 0;
  const evaded = m.evade && pool > 0 ? Array.from({ length: pool }, d6).filter((f) => f >= m.evade!.value).length : undefined;
  return { t: 'enterSaves', saved: m.made ?? 0, evaded };
}
