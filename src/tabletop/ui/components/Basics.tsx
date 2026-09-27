import type { ReactNode } from 'react';

export function Panel({ title, tag, accent, children, className = '' }: { title?: string; tag?: ReactNode; accent?: boolean; children: ReactNode; className?: string }) {
  return (
    <section className={`panel ${accent ? 'accent' : ''} ${className}`}>
      {(title || tag) && (
        <div className="panel-title">
          {title && <h3>{title}</h3>}
          {tag && <span className="tag accent">{tag}</span>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Btn({ children, onClick, variant = '', size = '', disabled, block, type = 'button', className = '', title }: { className?: string; title?: string; children: ReactNode; onClick?: () => void; variant?: '' | 'primary' | 'ghost' | 'danger' | 'ok'; size?: '' | 'sm' | 'lg'; disabled?: boolean; block?: boolean; type?: 'button' | 'submit' }) {
  const cls = ['btn', variant ? `btn-${variant}` : '', size ? `btn-${size}` : '', block ? 'btn-block' : '', className].filter(Boolean).join(' ');
  return (
    <button type={type} className={cls} onClick={onClick} disabled={disabled} title={title}>
      {children}
    </button>
  );
}

export function Stepper({ value, onChange, min = 0, max = 99, step = 1 }: { value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number }) {
  return (
    <span className="stepper">
      <button type="button" onClick={() => onChange(Math.max(min, value - step))} aria-label="decrease">−</button>
      {/* Type the number straight in: the text is selected on focus so a digit replaces it. */}
      <input
        className="stepper-value"
        inputMode="numeric"
        value={value}
        aria-label="value"
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => {
          const n = Number(e.target.value.replace(/[^0-9]/g, ''));
          if (e.target.value.trim() === '' || Number.isNaN(n)) return;
          onChange(Math.max(min, Math.min(max, n)));
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp') { e.preventDefault(); onChange(Math.min(max, value + step)); }
          else if (e.key === 'ArrowDown') { e.preventDefault(); onChange(Math.max(min, value - step)); }
        }}
      />
      <button type="button" onClick={() => onChange(Math.min(max, value + step))} aria-label="increase">+</button>
    </span>
  );
}

export function Toggle({ on, onChange, children }: { on: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <span className={`toggle ${on ? 'on' : ''}`} onClick={() => onChange(!on)} role="switch" aria-checked={on}>
      <span>{on ? '■' : '□'}</span>
      {children}
    </span>
  );
}

export function Lines({ lines }: { lines: string[] }) {
  return (
    <div className="stack">
      {lines.map((l, i) => (
        <p key={i}>{l}</p>
      ))}
    </div>
  );
}
