import type { GameState } from '@engine/types/game';
import type { Command } from '@engine/director/reducer';
import { unitsWithActions } from '@engine/player/actions';
import { useSettings } from '@tt/store/settingsStore';
import { useUi } from '@tt/store/uiStore';

let armedAt = 0;

/** Pass, with a reminder first when units can still act (press Pass again within a few seconds to confirm). */
export function passWithReminder(g: GameState, dispatch: (c: Command) => void): void {
  const ui = useUi.getState();
  const waiting = unitsWithActions(g).filter((p) => p.location === 'table' || p.location === 'reserves');
  const ask = useSettings.getState().confirmPass !== false;
  if (ask && waiting.length && Date.now() - armedAt > 4000) {
    armedAt = Date.now();
    ui.showToast(`${waiting.length} unit${waiting.length === 1 ? '' : 's'} can still act: ${waiting.map((p) => p.name).join(', ')}. Press Pass again to pass.`, 'info');
    return;
  }
  armedAt = 0;
  ui.select(null);
  ui.armDeploy(null);
  dispatch({ t: 'playersPass' });
}
