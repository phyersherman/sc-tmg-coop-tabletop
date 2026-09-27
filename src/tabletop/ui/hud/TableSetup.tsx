import { createPortal } from 'react-dom';
import type { GameState } from '@engine/types/game';
import { piecesNeeded } from '@data/terrainMaps';
import { mapLayout } from '@engine/terrain/remix';
import { aiSegments, describeSegment, playerSegments } from '@engine/terrain/geometry';
import { TableMap } from '../components/TableMap';
import { refSlug, refUrl, useRefArt } from '../components/refArt';
import { Btn } from '../components/Basics';
import { RewardToken } from '../components/Tokens';
import { REWARDS, sideState } from '@engine/missions/sideMarkers';
import { unitById } from '@data/index';

const inch = (n: number) => `${+n.toFixed(1)}"`;

/**
 * Setting up the table before round 1, in the order the rulebook gives (Part 9.3): table size, entry edges,
 * Zone of Influence markers, Mission Markers, then the terrain map piece by piece. The map on the left is the
 * table as the app sees it, numbered to match the list.
 */
export function TableSetup({ g, onDone, doneLabel = 'Table is set' }: { g: GameState; onDone: () => void; doneLabel?: string }) {
  const art = useRefArt();
  const d = g.deployment;
  const t = d.table;
  const map = g.config.terrainMapId ? mapLayout(g.config.terrainMapId, d) : null;
  const partial = (segs: typeof d.entry.red) => segs.some((s) => !(s.from === 0 && s.to === (s.edge === 'N' || s.edge === 'S' ? t.width : t.height)));
  const needsZoi = partial(d.entry.red) || partial(d.entry.blue);
  // A mission's garrison: enemy units set on the table before the game.
  const garrison = g.army.units.filter((u) => u.location === 'table' && typeof u.special?.guard === 'number');
  // A co-op mission's side markers: a guard or a Structure on each, and the reward that taking it earns.
  const sides = Object.entries(sideState(g).objects).map(([id, o]) => ({ id: Number(id), o, u: g.army.units.find((x) => x.id === o.unitId) }));
  return createPortal(
    <div className="table-setup" role="dialog" aria-label="Set up the table">
      <div className="table-setup-head">
        <div>
          <span className="muted small">Before round 1</span>
          <h2>Set up the table</h2>
        </div>
        <Btn variant="primary" size="lg" onClick={onDone}>{doneLabel}</Btn>
      </div>
      <div className="table-setup-body">
        <div className="table-setup-map">
          <TableMap deployment={d} terrain={g.terrain} markers={g.markers} refArt />
          <p className="small muted">Measured from the top-left corner of the table, as you look at it here. Your entry edge is blue, the AI's red.</p>
        </div>
        <ol className="table-setup-steps">
          <li>
            <b>Table</b>
            <span>{t.width}" × {t.height}" — {d.name}.</span>
          </li>
          <li>
            <b>Entry edges</b>
            <span>Yours: {playerSegments(d).map((s) => describeSegment(s, t)).join(' and ')}. The AI's: {aiSegments(d).map((s) => describeSegment(s, t)).join(' and ')}.</span>
          </li>
          {needsZoi && (
            <li>
              <b>Zone of Influence markers</b>
              <span>At the ends of each entry edge that does not run the full length of the table.</span>
            </li>
          )}
          <li>
            <b>Mission Markers</b>
            <ul>
              {g.markers.map((m) => (
                <li key={m.id}>
                  Marker {m.id} ({m.affinity === 'ai' ? 'red' : m.affinity === 'players' ? 'blue' : 'neutral'}) at {inch(m.x)} from the left, {inch(m.y)} from the top
                  {m.movedFrom && (m.movedFrom.piece === 'Lost Temple Ramp'
                    ? <span className="warn"> — the card puts it at ({inch(m.movedFrom.x)}, {inch(m.movedFrom.y)}), across the Lost Temple Ramp's edge; set it up on top of the plateau here instead</span>
                    : <span className="warn"> — the card puts it at ({inch(m.movedFrom.x)}, {inch(m.movedFrom.y)}), inside {m.movedFrom.piece}; set it just beside the wall here instead</span>)}
                </li>
              ))}
            </ul>
          </li>
          {sides.length > 0 && (
            <li>
              <b>Side markers</b>
              <span>Something of the enemy's stands on each side marker. Set it up now, with its reward token beside the marker (print them from Tokens). Destroy it, then hold the marker at a Scoring phase: the reward is yours for the next round only. The rest of the enemy leaves side markers alone.</span>
              <ul className="table-setup-sides">
                {sides.map(({ id, o, u }) => {
                  const def = u ? unitById(u.defId) : null;
                  return (
                    <li key={id}>
                      <RewardToken kind={o.reward} size="0.95in" />
                      <span>
                        <b>Marker {id}: {o.object === 'guard' ? `${def?.name ?? 'a unit'} guard` : `${def?.name ?? 'a Structure'} (Structure)`}</b>
                        {o.object === 'guard'
                          ? ` — ${u?.models ?? ''} model${u?.models === 1 ? '' : 's'} of ${def?.name ?? 'the unit'} on the marker, in coherency, with a Guard token. It holds the marker, shoots and fights back, and never leaves or returns. Use spare models or stand-ins.`
                          : ` — stand any building on the marker, or its printed token. HP ${def?.stats.hp ?? ''}${def?.stats.shields ? ` + ${def.stats.shields} shields` : ''}, Armour ${def?.stats.armour ?? ''}+. It never fights back.`}
                        <br /><span className="muted">Reward: <b>{REWARDS[o.reward].name}</b> — {REWARDS[o.reward].text}.</span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </li>
          )}
          {garrison.length > 0 && (
            <li>
              <b>Enemy on the table</b>
              <span>These start in place, holding the objectives. They do not move in round 1.</span>
              <ul>
                {garrison.map((u) => {
                  const at = g.sense?.ai[u.id]?.[0];
                  const m = g.markers.find((x) => x.id === u.special?.guard);
                  return (
                    <li key={u.id}>
                      {u.label} ({u.models} model{u.models === 1 ? '' : 's'}){m ? ` on Marker ${m.id}` : ''}{at ? `: leading model at ${inch(at.x)} from the left, ${inch(at.y)} from the top` : ''}
                    </li>
                  );
                })}
              </ul>
            </li>
          )}
          <li>
            <b>Terrain{map ? `: ${map.name}` : ''}</b>
            {map ? (
              <>
                <span>{map.page ? `From the core rulebook, page ${map.page}.` : 'Built the way the rulebook\'s maps are.'} Take out: {piecesNeeded({ pieces: g.terrain.pieces }).map((p) => `${p.count}× ${p.label}`).join(', ')}.</span>
                <ul className="table-setup-pieces">
                  {g.terrain.pieces.map((p) => (
                    <li key={p.n}>
                      {art?.images[`${refSlug(p.label)}--render`] && !/short side$/.test(p.label) ? <img className="table-setup-thumb" src={refUrl(refSlug(p.label), 'render')} alt="" /> : <span className="table-setup-thumb" />}
                      <span className="tag">#{p.n}</span> {p.label}: centre {inch(p.x + p.w / 2)} from the left, {inch(p.y + p.h / 2)} from the top{p.rot ? `, turned ${Math.abs(p.rot)}° ${p.rot > 0 ? 'clockwise' : 'anticlockwise'}` : p.w >= p.h ? ', lengthwise left to right' : ', lengthwise top to bottom'}
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <span>Place terrain as shown on the map; the numbers match the list in the game log.</span>
            )}
          </li>
        </ol>
      </div>
    </div>,
    document.body,
  );
}
