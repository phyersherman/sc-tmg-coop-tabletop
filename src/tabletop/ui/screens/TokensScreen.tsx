import { Btn } from '../components/Basics';
import { TokenSheet } from '../components/Tokens';

/** The printable side-marker tokens: print, cut out, and set each beside its marker at the start of a co-op mission. */
export function TokensScreen() {
  return (
    <div className="tokens-page">
      <div className="no-print">
        <h1>Side Marker Tokens</h1>
        <p className="muted">Print this page and cut out the tokens. When setting up a co-op mission, place each token beside its side marker as the table setup lists. A reward token shows what its side marker is worth. The players earn it by destroying the guard or Structure, then holding the marker in a Scoring phase. Gold rewards go to one Unit, blue to one player, and violet change the mission.</p>
        <Btn variant="primary" onClick={() => window.print()}>Print the tokens</Btn>
      </div>
      <TokenSheet />
    </div>
  );
}
