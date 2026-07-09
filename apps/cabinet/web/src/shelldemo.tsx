import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/base.css';
import { AppShell, type SurfaceId } from './components/shell/index.js';
import { Card, Dial, Rule, SectionLabel } from './components/instruments/index.js';

function Demo() {
  const [active, setActive] = useState<SurfaceId>('today');
  return (
    <AppShell
      active={active}
      onNavigate={setActive}
      onCommand={(i) => console.log('intent:', i)}
      datestamp={<>Tue &middot; <b>7 Jul</b> &middot; 06:12</>}
      presence="idle"
      presenceMeta="last swept 06:06 · next sweep 06:36 · weekly review Sunday"
    >
      <div style={{ maxWidth: 880, margin: '0 auto', padding: '30px 34px', display: 'flex', flexDirection: 'column', gap: 28 }}>
        <div>
          <h1>Good morning, Ben. <span style={{ color: 'var(--brass)', fontStyle: 'italic' }}>A quiet day</span> — two things worth a minute.</h1>
          <p className="voice" style={{ fontSize: 17, color: '#cdbfa4', maxWidth: '60ch', marginTop: 12 }}>
            Protein three mornings straight and weight still drifting down. The only real items are a refill that runs out Saturday and dining running hot.
          </p>
        </div>
        <div>
          <SectionLabel>Vitals</SectionLabel>
          <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 14 }}>
            <Card cap="Nutrition · today" tag="on track"><Dial value={142} max={185} unit="/ 185 g protein" sub="1,840 / 2,300 kcal" /></Card>
            <Card cap="Weight · 7-day" tag="−0.6"><Rule readout="178.4" unit="lb" points={[178.9, 178.7, 179, 178.6, 178.5, 178.6, 178.4]} markerPct={41} /></Card>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

createRoot(document.getElementById('root')!).render(<Demo />);
