import { useEffect, useState, useRef } from 'react';
import { useStore } from '../store';

const NEXT_STATUS = { placed: 'in_prep', in_prep: 'ready', ready: 'served' };
const ACTION_LABEL = { placed: 'Start prep', in_prep: 'Mark ready', ready: 'Serve' };
const URGENT_SECONDS = 8 * 60;

function useNow() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function elapsedLabel(createdAt, now) {
  const seconds = Math.max(0, Math.floor((now - new Date(createdAt + 'Z').getTime()) / 1000));
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return { text: `${m}:${String(s).padStart(2, '0')}`, seconds };
}

// FR-3.6: Synthesized Web Audio API order arrival chime
function playKitchenChime() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();

    const now = ctx.currentTime;
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();

    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(587.33, now); // D5
    osc1.frequency.exponentialRampToValueAtTime(880, now + 0.15); // A5

    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(880, now + 0.15);

    gain.gain.setValueAtTime(0.3, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(ctx.destination);

    osc1.start(now);
    osc2.start(now + 0.15);
    osc1.stop(now + 0.6);
    osc2.stop(now + 0.6);
  } catch (e) {
    console.warn('Audio chime unavailable:', e);
  }
}

export default function KDS() {
  const { orders, tables, setItemStatus, lastNewOrderArrival } = useStore();
  const now = useNow();
  const [soundEnabled, setSoundEnabled] = useState(true);
  const prevArrivalRef = useRef(lastNewOrderArrival);

  // Trigger audio alert on new ticket arrival (FR-3.6)
  useEffect(() => {
    if (lastNewOrderArrival && lastNewOrderArrival !== prevArrivalRef.current) {
      prevArrivalRef.current = lastNewOrderArrival;
      if (soundEnabled) {
        playKitchenChime();
      }
    }
  }, [lastNewOrderArrival, soundEnabled]);

  const activeOrders = orders
    .filter((o) => o.status === 'open')
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

  return (
    <div className="kds-board">
      <div className="kds-header-bar">
        <div className="kds-summary-stats">
          <span className="badge badge-active">{activeOrders.length} Active Tickets</span>
          <span className="badge badge-urgent">
            {activeOrders.filter(o => (now - new Date(o.created_at + 'Z').getTime()) / 1000 > URGENT_SECONDS).length} Urgent (&gt;8m)
          </span>
        </div>
        <div className="kds-controls">
          <button
            className={`btn-chime-toggle ${soundEnabled ? 'active' : 'muted'}`}
            onClick={() => {
              setSoundEnabled(!soundEnabled);
              if (!soundEnabled) playKitchenChime();
            }}
            title="Toggle kitchen sound chime"
          >
            {soundEnabled ? '🔔 Chime On' : '🔕 Chime Muted'}
          </button>
          <button className="btn-test-chime" onClick={() => playKitchenChime()} title="Test ticket arrival chime">
            🎵 Test Chime
          </button>
        </div>
      </div>

      {activeOrders.length === 0 && (
        <div className="kds-empty">
          <div style={{ fontSize: '32px', marginBottom: '12px' }}>👨‍🍳</div>
          <div>No active tickets in queue.</div>
          <div style={{ fontSize: '12px', opacity: 0.7, marginTop: '4px' }}>New orders sent from POS or QR Guest App appear here in &lt;1 second with chime alert.</div>
        </div>
      )}

      <div className="ticket-grid">
        {activeOrders.map((order) => {
          const { text, seconds } = elapsedLabel(order.created_at, now);
          const urgent = seconds > URGENT_SECONDS;
          const table = tables.find((t) => t.id === order.table_id || t.table_number === String(order.table_id));

          return (
            <div key={order.id} className={`ticket ${urgent ? 'urgent' : ''}`}>
              <div className="ticket-head">
                <div>
                  <div className="ticket-id">
                    #{order.id.slice(0, 5).toUpperCase()}
                    {order.created_by === 'guest_self_order' && (
                      <span className="guest-pill">QR Guest</span>
                    )}
                  </div>
                  <div className="ticket-meta">
                    {order.order_type === 'dine_in' ? `Table ${table?.table_number ?? order.table_id ?? '—'}` : 'Takeaway'}
                  </div>
                </div>
                <div className={`ticket-timer ${urgent ? 'timer-urgent' : ''}`}>{text}</div>
              </div>

              <div className="ticket-body">
                {order.items.map((line) => (
                  <div className="ticket-line" key={line.id}>
                    <span className="qty">{line.quantity}×</span>
                    <span className="line-name">{line.item_name}</span>
                    {line.status === 'served' ? (
                      <span className="status-pill served">Served</span>
                    ) : (
                      <button
                        className={`ticket-action ${line.status === 'placed' ? 'prep' : line.status === 'in_prep' ? 'ready' : 'served'}`}
                        style={{ flex: 'none', padding: '4px 10px', fontSize: '10.5px' }}
                        onClick={() => setItemStatus(order.id, line.id, NEXT_STATUS[line.status])}
                      >
                        {ACTION_LABEL[line.status]}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
