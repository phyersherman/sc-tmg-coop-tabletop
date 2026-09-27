import { Btn } from '../components/Basics';
import { TokenSheet } from '../components/Tokens';

/** The printable side-marker tokens: print, cut out, and set each beside its marker at the start of a co-op mission. */
export function TokensScreen() {
  return (
    <div className="tokens-page">
      <div className="no-print">
        <h1>Side-marker tokens</h1>
        <p className="muted">Print this page, cut the tokens out, and set each one beside its marker when you set up a co-op mission: the table setup says which goes where. A reward token tells everyone what a side marker is worth once its guard or Structure is destroyed and a player holds the marker at a Scoring phase. Gold rewards go to one unit, blue to one player, violet change the mission.</p>
        <Btn variant="primary" onClick={() => window.print()}>Print the tokens</Btn>
      </div>
      <TokenSheet />
    </div>
  );
}
