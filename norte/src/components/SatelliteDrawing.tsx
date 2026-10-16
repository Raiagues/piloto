type Props = {
  variant: 0 | 1;
};

function SolarPanel({ x, y, width, height }: { x: number; y: number; width: number; height: number }) {
  const columns = 5;
  const rows = 3;
  const verticals = Array.from({ length: columns - 1 }, (_, index) => x + ((index + 1) * width) / columns);
  const horizontals = Array.from({ length: rows - 1 }, (_, index) => y + ((index + 1) * height) / rows);

  return (
    <g>
      <rect x={x} y={y} width={width} height={height} rx="2" />
      {verticals.map((lineX) => <line key={lineX} x1={lineX} y1={y} x2={lineX} y2={y + height} />)}
      {horizontals.map((lineY) => <line key={lineY} x1={x} y1={lineY} x2={x + width} y2={lineY} />)}
    </g>
  );
}

export function SatelliteDrawing({ variant }: Props) {
  return (
    <svg className="satellite-svg" viewBox="0 0 1000 430" role="img" aria-label="Orthographic technical satellite drawing">
      <g className="construction-lines">
        <line x1="95" y1="215" x2="910" y2="215" />
        <line x1="500" y1="55" x2="500" y2="370" strokeDasharray="8 7" />
        <circle cx="500" cy="215" r="145" />
        <line x1="235" y1="78" x2="765" y2="78" />
        <line x1="235" y1="69" x2="235" y2="87" />
        <line x1="765" y1="69" x2="765" y2="87" />
        <text x="472" y="66">18.60 m</text>
      </g>

      <g className="satellite-outline">
        {variant === 1 && <SolarPanel x={165} y={173} width={250} height={84} />}
        {variant === 0 && <g><path d="M220 150 Q150 215 220 280" /><path d="M220 150 Q270 215 220 280" /><line x1="220" y1="150" x2="220" y2="280" /><line x1="220" y1="215" x2="342" y2="215" /></g>}
        <rect x="410" y="145" width="180" height="140" rx="4" />
        <rect x="432" y="163" width="55" height="104" rx="2" />
        <rect x="500" y="163" width="68" height="104" rx="2" />
        <circle cx="455" cy="185" r="5" />
        <circle cx="545" cy="185" r="5" />
        <circle cx="455" cy="245" r="5" />
        <circle cx="545" cy="245" r="5" />
        <line x1="410" y1="178" x2="590" y2="178" />
        <line x1="410" y1="252" x2="590" y2="252" />
        <path d="M590 192 L630 215 L590 238" />
        {variant === 1 && <path d="M410 192 L370 215 L410 238" />}
        <SolarPanel x={630} y={173} width={255} height={84} />
        <g transform={variant === 0 ? "translate(480 108)" : "translate(475 88) rotate(-25 25 35)"}>
          <path d="M0 30 Q25 0 50 30 Q25 45 0 30" />
          <line x1="25" y1="31" x2="25" y2="67" />
          <line x1="25" y1="50" x2="42" y2="62" />
        </g>
        {variant === 1 && <g transform="translate(485 302) rotate(155 20 20)"><path d="M0 20 Q20 0 40 20 Q20 33 0 20" /><line x1="20" y1="20" x2="20" y2="52" /></g>}
      </g>

      <g className="dimensions">
        <line x1="410" y1="316" x2="590" y2="316" />
        <line x1="410" y1="306" x2="410" y2="326" />
        <line x1="590" y1="306" x2="590" y2="326" />
        <text x="475" y="338">4.20 m</text>
        <line x1="910" y1="160" x2="910" y2="270" />
        <line x1="900" y1="160" x2="920" y2="160" />
        <line x1="900" y1="270" x2="920" y2="270" />
        <text x="927" y="220">6.20 m</text>
        <text x="715" y="318">VISTA LATERAL</text>
        <text x="715" y="340">ESCALA 1:20</text>
      </g>
    </svg>
  );
}
