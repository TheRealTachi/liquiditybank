/**
 * Small horizontal flow diagram explaining what the program does.
 *
 *   [Trade on pump.fun] → [0.30% creator fee] → [Vault PDA]
 *                                                   ↓
 *                              [Pre-grad: buy + burn] / [Post-grad: pair LP + burn]
 *                                                   ↓
 *                                              [Incinerator]
 */
export function FlowDiagram() {
  return (
    <svg
      viewBox="0 0 1200 360"
      xmlns="http://www.w3.org/2000/svg"
      className="w-full h-auto"
      aria-hidden
    >
      <defs>
        <marker
          id="arrow"
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#c8a661" />
        </marker>
      </defs>

      {/* Row 1: trade → fee → vault */}
      <Node x={20} y={40} w={220} label="01" title="Trade" sub="pump.fun curve or PumpSwap" />
      <Arrow x1={240} y1={80} x2={350} y2={80} />
      <Node x={350} y={40} w={220} label="02" title="0.30% creator fee" sub="paid in SOL" />
      <Arrow x1={570} y1={80} x2={680} y2={80} />
      <Node x={680} y={40} w={220} label="03" title="Vault PDA" sub="program-derived · no key" bright />
      <Arrow x1={900} y1={80} x2={1010} y2={80} />
      <Node x={1010} y={40} w={170} label="04" title="Crank" sub="anyone may fire" />

      {/* Center "or" branch label */}
      <text x={600} y={170} textAnchor="middle" fontSize="11" fill="#7e95b3" fontFamily="JetBrains Mono, monospace" letterSpacing="0.2em">
        TWO PATHS — DEPENDING ON STATE
      </text>

      {/* Row 2 — two parallel branches */}
      <Node x={80} y={200} w={460} label="A" title="Pre-graduation — burn supply" sub="Vault spends SOL on the curve, sends bought tokens to the incinerator. SOL stays in the curve, becomes LP at graduation." />
      <Node x={660} y={200} w={460} label="B" title="Post-graduation — burn LP" sub="Vault swaps half to tokens, pairs with SOL, deposits as PumpSwap LP. Mints LP to incinerator. Pool depth ↑ forever." />

      {/* Arrows down to incinerator */}
      <Arrow x1={310} y1={302} x2={555} y2={325} />
      <Arrow x1={890} y1={302} x2={645} y2={325} />
      <rect x={490} y={325} width={220} height={28} fill="none" stroke="#c8a661" strokeWidth="1" />
      <text x={600} y={343} textAnchor="middle" fontSize="13" fill="#c8a661" fontFamily="Roboto Slab, serif" fontWeight="600" letterSpacing="0.18em">
        INCINERATOR — FOREVER
      </text>
    </svg>
  );
}

function Node({
  x,
  y,
  w,
  label,
  title,
  sub,
  bright,
}: {
  x: number;
  y: number;
  w: number;
  label: string;
  title: string;
  sub: string;
  bright?: boolean;
}) {
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={w}
        height={80}
        fill="none"
        stroke={bright ? "#c8a661" : "rgba(199,209,221,0.28)"}
        strokeWidth={bright ? "1.5" : "1"}
      />
      <text
        x={x + 14}
        y={y + 22}
        fontSize="10"
        fill={bright ? "#c8a661" : "#7e95b3"}
        fontFamily="JetBrains Mono, monospace"
        letterSpacing="0.18em"
      >
        {label}
      </text>
      <text
        x={x + 14}
        y={y + 44}
        fontSize="15"
        fill="#f4efe1"
        fontFamily="Roboto Slab, serif"
        fontWeight="500"
      >
        {title}
      </text>
      <foreignObject x={x + 14} y={y + 50} width={w - 28} height={28}>
        <div
          style={{
            fontSize: "11px",
            color: "#c7d1dd",
            fontFamily: "Inter, sans-serif",
            lineHeight: 1.35,
          }}
        >
          {sub}
        </div>
      </foreignObject>
    </g>
  );
}

function Arrow({
  x1,
  y1,
  x2,
  y2,
}: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}) {
  return (
    <line
      x1={x1}
      y1={y1}
      x2={x2}
      y2={y2}
      stroke="#c8a661"
      strokeWidth="1.5"
      markerEnd="url(#arrow)"
    />
  );
}
