import { createRoot } from 'react-dom/client';
import './styles/base.css';
import { Dial, Ring, Rule, Gauge, Sparkline, Card, StatReadout, SectionLabel } from './components/instruments/index.js';

const weight = [178.9, 178.7, 179.0, 178.6, 178.5, 178.6, 178.4];
const cash = [18, 16, 17, 10, 12, 6];

function Gallery() {
  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: '48px 32px', display: 'flex', flexDirection: 'column', gap: 32 }}>
      <div>
        <div style={{ fontFamily: 'var(--serif)', fontSize: 28, fontWeight: 600, letterSpacing: '0.14em' }}>CABINET</div>
        <div className="label">Instrument family</div>
      </div>

      <div>
        <SectionLabel>Vitals</SectionLabel>
        <div style={{ display: 'grid', gridTemplateColumns: '1.35fr 1fr 1fr 1fr', gap: 14 }}>
          <Card cap="Nutrition · today" tag="on track">
            <Dial value={142} max={185} unit="/ 185 g protein" sub="1,840 / 2,300 kcal · 3 meals" />
          </Card>
          <Card cap="Weight · 7-day" tag="−0.6">
            <Rule readout="178.4" unit="lb" points={weight} markerPct={41} />
          </Card>
          <Card cap="Tasks · due" tag="3 today" tagTone="warn">
            <div className="inst-ring">
              <Ring value={3} max={11} />
              <StatReadout big={<span className="unit">of <b style={{ color: 'var(--linen)' }}>11</b> open</span>} sub="2 overdue →" />
            </div>
          </Card>
          <Card cap="Cash · month" tag="+ flow">
            <StatReadout big="+$1,240" tone="ok" sub="in $6,180 · out $4,940" />
            <Sparkline points={cash} color="var(--patina)" height={22} />
          </Card>
        </div>
      </div>

      <div>
        <SectionLabel>Gauges &amp; states</SectionLabel>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
          <Card cap="Dining budget">
            <Gauge value={454} max={500} leftLabel="92% spent" rightLabel="$46 left · 8d" />
          </Card>
          <Card cap="Dining budget · over">
            <Gauge value={512} max={500} leftLabel="over" rightLabel="−$12" />
          </Card>
          <Card cap="Storage">
            <Gauge value={120} max={400} leftLabel="30%" rightLabel="280 GB free" />
          </Card>
        </div>
      </div>

      <div>
        <SectionLabel n="2">Signature cards</SectionLabel>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <Card cap="Attention" severity="crit">
            <div style={{ fontFamily: 'var(--serif)', fontSize: 17 }}>Metformin runs out Saturday</div>
            <div style={{ fontSize: 13.5, color: 'var(--linen-dim)' }}>8 tablets left. I can reorder from your July plan.</div>
          </Card>
          <Card paper>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 11, letterSpacing: '0.14em' }}>TIER 2 — AWAITING YOUR SIGN-OFF</div>
            <div style={{ fontWeight: 600 }}>git push origin main</div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>publish the v2 build</div>
          </Card>
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById('gallery')!).render(<Gallery />);
