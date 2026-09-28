import { useEffect, useMemo, useRef, useState } from 'react';
import { Rng, hashSeed } from '@engine/rng';
import type { Faction } from '@engine/types/units';

const FACTION_KEY: Record<Faction, string> = { Terran: 'terran', Zerg: 'zerg', Protoss: 'protoss' };
const base = () => `${import.meta.env.BASE_URL}dice/`;

export function faceUrl(faction: Faction, value: number): string {
  return `${base()}${FACTION_KEY[faction]}/face-${Math.max(1, Math.min(6, value))}.png`;
}
export function tumbleUrl(faction: Faction, i: number): string {
  return `${base()}${FACTION_KEY[faction]}/tumble-${((i % 4) + 4) % 4 + 1}.png`;
}

/** A landed die face (your faction dice art). */
export function DieFace({ faction, value, className = '' }: { faction: Faction; value: number; className?: string }) {
  return <img className={className} src={faceUrl(faction, value)} alt={String(value)} draggable={false} />;
}

/** A die still tumbling. */
export function DieTumble({ faction, i = 0, className = '' }: { faction: Faction; i?: number; className?: string }) {
  return <img className={className} src={tumbleUrl(faction, i)} alt="" draggable={false} />;
}

/** One die: tumbles for `delay` ms, then lands on `value`. */
function Die({ faction, value, hit, delay, size, label, replayKey }: { faction: Faction; value: number; hit: boolean | null; delay: number; size: number; label?: string; replayKey: number }) {
  const [frame, setFrame] = useState(0);
  const [landed, setLanded] = useState(false);
  const rot = useRef(Math.random() * 40 - 20);
  useEffect(() => {
    setLanded(false);
    rot.current = Math.random() * 40 - 20;
    const start = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const e = t - start;
      if (e >= delay) {
        setLanded(true);
        return;
      }
      setFrame(Math.floor(e / 70));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [delay, replayKey]);
  const cls = landed ? (hit === null ? 'die3d landed' : hit ? 'die3d landed hit' : 'die3d landed miss') : 'die3d rolling';
  const style: React.CSSProperties = { width: size, height: size, transform: landed ? `rotate(${rot.current * 0.15}deg)` : `rotate(${(frame * 47) % 360}deg) scale(${1 + 0.15 * Math.sin(frame)})` };
  return (
    <span className={cls} style={style} title={label}>
      <img src={landed ? faceUrl(faction, value) : tumbleUrl(faction, frame)} alt={landed ? String(value) : 'rolling'} draggable={false} />
      {landed && label && <span className="die3d-label">{label}</span>}
    </span>
  );
}

/**
 * Faction-styled dice roll: tumbling frames, then each die lands on its value.
 * `need` marks hits (>= need) green and misses dim; pass null for unjudged dice (Surge).
 */
export function DiceRoll({ faction, rolls, need, surge, size = 44 }: { faction: Faction; rolls: number[]; need: number | null; surge?: { die: string; value: number } | undefined; size?: number }) {
  const [replayKey, setReplayKey] = useState(0);
  const total = 700 + Math.min(rolls.length, 18) * 45;
  return (
    <div className="dice3d">
      {rolls.map((r, i) => <Die key={`${replayKey}-${i}`} faction={faction} value={r} hit={need === null ? null : r >= need} delay={500 + (i * 45) % 700} size={size} replayKey={replayKey} />)}
      {surge && <Die key={`${replayKey}-s`} faction={faction} value={Math.max(1, Math.min(6, surge.value))} hit={null} delay={total} size={size + 8} label={`Surge ${surge.die}`} replayKey={replayKey} />}
      <button type="button" className="die3d-replay" onClick={() => setReplayKey((k) => k + 1)} title="Roll again (same result)">↻</button>
    </div>
  );
}

/**
 * The AI's charge distance, rolled by the app as it rolls the AI's attack dice: the die (the higher of two when the
 * AI rolls 2D6), then how far that takes the charge. The roll comes from `seed` (the game, the round, the phase and
 * the Unit), so it stays the same however often the order is drawn again, a reload included.
 */
export function ChargeRoll({ faction, dice, speed, bonus = 0, seed }: { faction: Faction; dice: '1d6' | '2d6high'; speed: number; bonus?: number; seed: string }) {
  const rolls = useMemo(() => { const rng = Rng.from(hashSeed(seed)); return Array.from({ length: dice === '2d6high' ? 2 : 1 }, () => rng.d6()); }, [seed, dice]);
  const roll = Math.max(...rolls);
  const reach = speed + roll + bonus;
  return (
    <div className="charge-roll">
      <DiceRoll faction={faction} rolls={rolls} need={null} size={40} />
      <p className="ask">The AI rolls {roll}{rolls.length > 1 ? ' (the higher die)' : ''}: its charge reaches <b>{reach}"</b>, the roll plus its Speed of {speed}{bonus ? ` and ${bonus} from its card` : ''}. An enemy within {reach}": the charge is made. Farther: the charge fails and the Unit stays where it is.</p>
    </div>
  );
}
