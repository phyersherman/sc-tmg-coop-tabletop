import { create } from 'zustand';
import type { Command } from '@engine/director/reducer';

export type Screen = 'home' | 'setup' | 'game' | 'rulebook' | 'terrain' | 'debrief' | 'collection' | 'armies' | 'tokens' | 'tutorial';

export interface PendingAbility {
  kind: 'unit' | 'card';
  /** Unit using the ability, or the active unit for a card boost. */
  unitId?: string;
  /** Ability name or boost name. */
  name: string;
  cardId?: string;
  target: 'friendly' | 'enemy' | 'point';
  range?: number;
  hint?: string;
  option?: number;
  payWith?: string[];
}

export interface UiState {
  screen: Screen;
  briefingSeen: boolean;
  /** The table has been set up for this game (the step before the briefing). */
  tableSet: boolean;
  /** Your selected unit on the game screen. */
  selectedUnitId: string | null;
  /** Reserve unit armed for deployment: next click on the map places it. */
  armedDeploy: string | null;
  /**
   * A unit picked up to move by point and click: a ghost of one base follows the pointer (green where it can
   * stand, red where it cannot) and a click sets it down. `move`: the unit, led by model `index`. `adjust`: model
   * `index` alone, set anywhere Wholly Within coherency (squad-mates on its spot step aside). `led`: the model to
   * lead has been chosen, so a click on one of the squad's own models is now a destination, not a new leader.
   */
  moveArm: { side: 'ai' | 'players'; unitId: string; mode: 'move' | 'adjust'; index: number; led?: boolean } | null;
  setMoveArm(a: UiState['moveArm']): void;
  /** The simulation's own timed step (an activation ending, a forced pass), so the screen can show it running down. */
  autoStep: { what: 'endActivation' | 'pass'; at: number; ms: number } | null;
  setAutoStep(a: UiState['autoStep']): void;
  /** Attack/charge mode: weapon chosen, waiting for a target click. */
  targeting: { weaponId: string; kind: 'attack' | 'charge'; /** Models striking or firing (defaults to the ranks in a fight, else the whole unit). */ models?: number } | null;
  toast: { text: string; kind: 'error' | 'info'; at: number } | null;
  autopilot: boolean;
  freePlacement: boolean;
  showLegend: boolean;
  setShowLegend(v: boolean): void;
  /** Your attack waiting for its dice (chosen weapon and target). */
  /** An ability or card boost waiting for a target picked on the map. */
  pendingAbility: PendingAbility | null;
  setPendingAbility(p: PendingAbility | null): void;
  /** A cost waiting for you to choose which Ready cards to exhaust. */
  pendingPay: { cost: number; title: string; cmd?: Extract<Command, { t: 'useAbility' }>; ability?: PendingAbility } | null;
  setPendingPay(p: UiState['pendingPay']): void;
  /** An ability with options waiting for the choice (e.g. Orders). */
  abilityDraft: { unitId: string; name: string } | null;
  setAbilityDraft(d: { unitId: string; name: string } | null): void;
  /** The AI order the player has chosen to reveal (turn-change gate). */
  revealedOrder: string | null;
  revealOrder(key: string | null): void;
  /** AI unit whose card is shown (clicked on the map or in the roster). */
  inspectId: string | null;
  inspect(id: string | null): void;
  pendingAttack: { unitId: string; weaponId: string; targetId: string; models: number } | null;
  /** Your charge waiting for its die. */
  pendingCharge: { unitId: string; targetId: string; /** The model you picked to lead the charge. */ leaderIndex?: number } | null;
  setPendingAttack(p: UiState['pendingAttack']): void;
  setPendingCharge(p: UiState['pendingCharge']): void;
  /** Last AI attack/charge the user has acknowledged; the autopilot waits for new ones. */
  /** Every result you have continued past (a charge and its Impact attack are acknowledged separately). */
  acked: Record<string, true>;
  /** Attack reveals whose animation has finished (so remounting shows them settled, not replaying). */
  revealed: Record<string, true>;
  /** Player attack/charge reveals the user has closed. */
  dismissed: Record<string, true>;
  ack(id: string): void;
  dismiss(id: string): void;
  select(id: string | null): void;
  armDeploy(id: string | null): void;
  setTargeting(t: UiState['targeting']): void;
  showToast(text: string, kind?: 'error' | 'info'): void;
  setAutopilot(v: boolean): void;
  setFreePlacement(v: boolean): void;
  go(screen: Screen): void;
  setBriefingSeen(v: boolean): void;
  setTableSet(v: boolean): void;
}

export const useUi = create<UiState>((set) => ({
  screen: 'home',
  briefingSeen: false,
  tableSet: false,
  selectedUnitId: null,
  armedDeploy: null,
  moveArm: null,
  setMoveArm: (moveArm) => set(moveArm ? { moveArm, targeting: null, armedDeploy: null, pendingAbility: null } : { moveArm }),
  autoStep: null,
  setAutoStep: (autoStep) => set({ autoStep }),
  targeting: null,
  toast: null,
  autopilot: false,
  freePlacement: false,
  showLegend: false,
  setShowLegend: (showLegend) => set({ showLegend }),
  pendingAbility: null,
  setPendingAbility: (pendingAbility) => set(pendingAbility ? { pendingAbility, targeting: null, moveArm: null } : { pendingAbility, targeting: null }),
  pendingPay: null,
  setPendingPay: (pendingPay) => set({ pendingPay }),
  abilityDraft: null,
  setAbilityDraft: (abilityDraft) => set({ abilityDraft, pendingAbility: null, targeting: null, pendingAttack: null, pendingCharge: null }),
  revealedOrder: null,
  revealOrder: (revealedOrder) => set({ revealedOrder }),
  inspectId: null,
  inspect: (inspectId) => set({ inspectId }),
  pendingAttack: null,
  pendingCharge: null,
  setPendingAttack: (pendingAttack) => set({ pendingAttack, pendingCharge: null, targeting: null }),
  setPendingCharge: (pendingCharge) => set({ pendingCharge, pendingAttack: null, targeting: null }),
  acked: {},
  revealed: {},
  dismissed: {},
  ack: (ackId) => set((s) => ({ acked: { ...s.acked, [ackId]: true }, revealed: { ...s.revealed, [ackId]: true } })),
  dismiss: (id) => set((s) => ({ dismissed: { ...s.dismissed, [id]: true } })),
  select: (selectedUnitId) => set((s) => ({ selectedUnitId, targeting: null, pendingAttack: null, pendingCharge: null, pendingAbility: null, abilityDraft: null, moveArm: s.moveArm && s.moveArm.side === 'players' && s.moveArm.unitId !== selectedUnitId ? null : s.moveArm })),
  armDeploy: (armedDeploy) => set(armedDeploy ? { armedDeploy, moveArm: null, targeting: null } : { armedDeploy }),
  setTargeting: (targeting) => set(targeting ? { targeting, moveArm: null } : { targeting }),
  showToast: (text, kind = 'error') => set({ toast: { text, kind, at: Date.now() } }),
  setAutopilot: (autopilot) => set({ autopilot }),
  setFreePlacement: (freePlacement) => set({ freePlacement }),
  go: (screen) => set({ screen }),
  // A new game starts at the table: clearing the briefing clears the setup with it.
  setBriefingSeen: (briefingSeen) => set(briefingSeen ? { briefingSeen } : { briefingSeen, tableSet: false }),
  setTableSet: (tableSet) => set({ tableSet }),
}));

if (import.meta.env.DEV) (window as unknown as { __ui: typeof useUi }).__ui = useUi;
