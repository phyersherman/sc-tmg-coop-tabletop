import { useState } from 'react';
import type { Faction } from '@engine/types/units';
import { Btn, Panel, Stepper } from './Basics';
import { DiceRoll } from './DiceRoll';

/** Roll your own dice in the app with faction-styled dice. */
export function PlayerDice({ defaultFaction }: { defaultFaction: Faction }) {
  const [faction, setFaction] = useState<Faction>(defaultFaction);
  const [n, setN] = useState(6);
  const [hit, setHit] = useState(3);
  const [surge, setSurge] = useState<'none' | 'D3' | 'D3+1' | 'D6'>('none');
  const [result, setResult] = useState<{ rolls: number[]; surge?: number; key: number } | null>(null);
  const roll = () => {
    const rolls = Array.from({ length: n }, () => 1 + Math.floor(Math.random() * 6));
    let s: number | undefined;
    if (surge === 'D6') s = 1 + Math.floor(Math.random() * 6);
    else if (surge === 'D3') s = 1 + Math.floor(Math.random() * 3);
    else if (surge === 'D3+1') s = 2 + Math.floor(Math.random() * 3);
    setResult({ rolls, surge: s, key: (result?.key ?? 0) + 1 });
  };
  const hits = result ? result.rolls.filter((r) => r >= hit).length : 0;
  return (
    <Panel title="Your dice" tag={`${faction}`}>
      <div className="row">
        {(['Terran', 'Zerg', 'Protoss'] as Faction[]).map((f) => <Btn key={f} size="sm" variant={faction === f ? 'primary' : ''} onClick={() => setFaction(f)}>{f}</Btn>)}
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <label>Dice</label><Stepper value={n} onChange={setN} min={1} max={30} />
        <label>Hit on</label><Stepper value={hit} onChange={setHit} min={2} max={6} />
        <label>Surge</label>
        <select value={surge} onChange={(e) => setSurge(e.target.value as typeof surge)}>
          <option value="none">none</option><option value="D3">D3</option><option value="D3+1">D3+1</option><option value="D6">D6</option>
        </select>
        <Btn variant="primary" size="lg" onClick={roll}>Roll</Btn>
      </div>
      {result && (
        <div key={result.key}>
          <DiceRoll faction={faction} rolls={result.rolls} need={hit} surge={result.surge !== undefined ? { die: surge, value: result.surge } : undefined} />
          <p><b>{hits} hit{hits === 1 ? '' : 's'}</b> of {n} on {hit}+{result.surge !== undefined ? ` · Surge ${result.surge}` : ''}. Roll Armour saves for the hits (minus any Surge that applies).</p>
        </div>
      )}
    </Panel>
  );
}
