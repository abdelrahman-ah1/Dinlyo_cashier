import { useEffect, useState, useRef } from 'react';
import { useStore } from '../store';
import { notify } from '../components/Toast';
import {
  ChefHat,
  Bell,
  BellOff,
  Volume2,
  Clock,
  Flame,
  Check,
  Smartphone
} from 'lucide-react';

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
  if (!createdAt) return { text: '0:00', seconds: 0 };
  const dateStr = typeof createdAt === 'string' && !createdAt.endsWith('Z') ? `${createdAt}Z` : createdAt;
  const time = new Date(dateStr).getTime();
  if (isNaN(time)) return { text: '0:00', seconds: 0 };
  const seconds = Math.max(0, Math.floor((now - time) / 1000));
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
      notify.info('New Ticket Arrived', 'Kitchen queue updated with a new order.');
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
              const nextState = !soundEnabled;
              setSoundEnabled(nextState);
              if (nextState) playKitchenChime();
              notify.info('Kitchen Sound', nextState ? 'Chime alerts enabled' : 'Chime alerts muted');
            }}
            title="Toggle kitchen sound chime"
          >
            {soundEnabled ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                <Bell size={14} /> Chime On
              </span>
            ) : (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                <BellOff size={14} /> Chime Muted
              </span>
            )}
          </button>
          <button
            className="btn-test-chime"
            onClick={() => {
              playKitchenChime();
              notify.info('Audio Check', 'Synthesized 587Hz -> 880Hz alert played');
            }}
            title="Test ticket arrival chime"
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              <Volume2 size={14} /> Test Chime
            </span>
          </button>
        </div>
      </div>

      {activeOrders.length === 0 && (
        <div className="kds-empty">
          <div style={{
            width: '64px',
            height: '64px',
            borderRadius: '16px',
            background: 'var(--surface-2)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 16px',
            color: 'var(--accent)'
          }}>
            <ChefHat size={36} />
          </div>
          <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text)' }}>No active tickets in kitchen queue</div>
          <div style={{ fontSize: '12.5px', color: 'var(--text-faint)', marginTop: '6px', maxWidth: '320px' }}>
            New orders placed at Cashier POS or scanned via Table QR codes will arrive here instantly with an audible chime.
          </div>
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
                  <div className="ticket-id" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span>#{order.id.slice(0, 5).toUpperCase()}</span>
                    {order.created_by === 'guest_self_order' && (
                      <span className="guest-pill" style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                        <Smartphone size={10} /> QR Guest
                      </span>
                    )}
                  </div>
                  <div className="ticket-meta">
                    {order.order_type === 'dine_in' ? `Table ${table?.table_number ?? order.table_id ?? '—'}` : 'Takeaway'}
                  </div>
                </div>
                <div className={`ticket-timer ${urgent ? 'timer-urgent' : ''}`} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  {urgent ? <Flame size={13} /> : <Clock size={12} />}
                  <span>{text}</span>
                </div>
              </div>

              <div className="ticket-body">
                {order.items.map((line) => (
                  <div className="ticket-line" key={line.id}>
                    <span className="qty">{line.quantity}×</span>
                    <span className="line-name">{line.item_name}</span>
                    {line.status === 'served' ? (
                      <span className="status-pill served" style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                        <Check size={11} /> Served
                      </span>
                    ) : (
                      <button
                        className={`ticket-action ${line.status === 'placed' ? 'prep' : line.status === 'in_prep' ? 'ready' : 'served'}`}
                        style={{ flex: 'none', padding: '4px 10px', fontSize: '11px' }}
                        onClick={() => {
                          const next = NEXT_STATUS[line.status];
                          setItemStatus(order.id, line.id, next);
                          notify.success('Item Status', `${line.item_name} updated to ${next.toUpperCase()}`);
                        }}
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

