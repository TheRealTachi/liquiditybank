/**
 * Vault-door SVG — sits behind the hero as a structural motif. Rotates slowly
 * to suggest mechanical movement without being noisy.
 */
export function VaultDoor({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 600 600"
      xmlns="http://www.w3.org/2000/svg"
      className={"vault-door " + className}
      aria-hidden
    >
      <defs>
        <radialGradient id="vd-gold" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#c8a661" stopOpacity="0.18" />
          <stop offset="60%" stopColor="#c8a661" stopOpacity="0.04" />
          <stop offset="100%" stopColor="#c8a661" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* outer rim */}
      <circle cx="300" cy="300" r="280" fill="none" stroke="rgba(200,166,97,0.18)" strokeWidth="1.5" />
      <circle cx="300" cy="300" r="270" fill="none" stroke="rgba(200,166,97,0.10)" strokeWidth="1" />
      <circle cx="300" cy="300" r="252" fill="none" stroke="rgba(200,166,97,0.28)" strokeWidth="1" />

      {/* faint inner glow */}
      <circle cx="300" cy="300" r="252" fill="url(#vd-gold)" />

      {/* radial bolt-markers — 24 of them, spaced 15° apart */}
      {Array.from({ length: 24 }).map((_, i) => {
        const angle = (i * 360) / 24;
        const rad = (angle * Math.PI) / 180;
        const r1 = 252;
        const r2 = 262;
        const x1 = 300 + Math.cos(rad) * r1;
        const y1 = 300 + Math.sin(rad) * r1;
        const x2 = 300 + Math.cos(rad) * r2;
        const y2 = 300 + Math.sin(rad) * r2;
        return (
          <line
            key={i}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke="rgba(200,166,97,0.32)"
            strokeWidth="1"
          />
        );
      })}

      {/* spokes — 8 of them */}
      {Array.from({ length: 8 }).map((_, i) => {
        const angle = (i * 360) / 8;
        const rad = (angle * Math.PI) / 180;
        const r1 = 60;
        const r2 = 240;
        const x1 = 300 + Math.cos(rad) * r1;
        const y1 = 300 + Math.sin(rad) * r1;
        const x2 = 300 + Math.cos(rad) * r2;
        const y2 = 300 + Math.sin(rad) * r2;
        return (
          <line
            key={"sp" + i}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke="rgba(200,166,97,0.16)"
            strokeWidth="1"
          />
        );
      })}

      {/* center hub */}
      <circle cx="300" cy="300" r="50" fill="none" stroke="rgba(200,166,97,0.45)" strokeWidth="1.5" />
      <circle cx="300" cy="300" r="36" fill="none" stroke="rgba(200,166,97,0.30)" strokeWidth="1" />
      <circle cx="300" cy="300" r="6" fill="rgba(200,166,97,0.55)" />

      {/* small cardinal pegs */}
      {[0, 90, 180, 270].map((angle, i) => {
        const rad = (angle * Math.PI) / 180;
        const r = 50;
        const x = 300 + Math.cos(rad) * r;
        const y = 300 + Math.sin(rad) * r;
        return <circle key={"pg" + i} cx={x} cy={y} r="3" fill="rgba(200,166,97,0.55)" />;
      })}

      {/* outer ring tick numerals (just decorative — every 30°) */}
      {Array.from({ length: 12 }).map((_, i) => {
        const angle = (i * 360) / 12 - 90;
        const rad = (angle * Math.PI) / 180;
        const r = 230;
        const x = 300 + Math.cos(rad) * r;
        const y = 300 + Math.sin(rad) * r;
        return (
          <text
            key={"tk" + i}
            x={x}
            y={y}
            fontSize="9"
            fill="rgba(200,166,97,0.40)"
            fontFamily="JetBrains Mono, monospace"
            textAnchor="middle"
            dominantBaseline="middle"
          >
            {String(i + 1).padStart(2, "0")}
          </text>
        );
      })}
    </svg>
  );
}
