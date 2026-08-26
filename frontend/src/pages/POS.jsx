import { useMemo, useState } from 'react';
import { useStore } from '../store';
import { notify } from '../components/Toast';
import {
  ShoppingBag,
  UtensilsCrossed,
  QrCode,
  CreditCard,
  Banknote,
  Send,
  Check,
  Minus,
  Plus,
  X,
  Loader2
} from 'lucide-react';

export default function POS({ onOpenQrModal }) {
  const { menu, tables, orders, placeOrder, payOrder } = useStore();
  const [selectedTable, setSelectedTable] = useState(null);
  const [orderType, setOrderType] = useState('dine_in');
  const [activeCategory, setActiveCategory] = useState('All');
  const [cart, setCart] = useState([]); // [{item, quantity}]
  const [sending, setSending] = useState(false);
  const [justSent, setJustSent] = useState(false);
  const [paymentModalOrder, setPaymentModalOrder] = useState(null);
  const [processingPay, setProcessingPay] = useState(false);

  const categories = useMemo(() => ['All', ...new Set(menu.map((m) => m.category))], [menu]);
  const visibleItems = useMemo(
    () => (activeCategory === 'All' ? menu : menu.filter((m) => m.category === activeCategory)),
    [menu, activeCategory]
  );

  const addToCart = (item) => {
    setCart((prev) => {
      const idx = prev.findIndex((l) => l.item.id === item.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], quantity: next[idx].quantity + 1 };
        return next;
      }
      return [...prev, { item, quantity: 1 }];
    });
    notify.info('Added to Cart', `${item.name} • EGP ${item.price.toFixed(2)}`, 1800);
  };

  const changeQty = (itemId, delta) => {
    setCart((prev) =>
      prev
        .map((l) => (l.item.id === itemId ? { ...l, quantity: l.quantity + delta } : l))
        .filter((l) => l.quantity > 0)
    );
  };

  const total = cart.reduce((sum, l) => sum + l.item.price * l.quantity, 0);
  const canSend = cart.length > 0 && (orderType === 'takeaway' || selectedTable);

  const handleSend = async () => {
    setSending(true);
    try {
      const order = await placeOrder({
        tableId: orderType === 'dine_in' ? selectedTable : null,
        orderType,
        items: cart.map((l) => ({ item_id: l.item.id, quantity: l.quantity })),
      });
      setCart([]);
      setJustSent(true);
      notify.success('Sent to Kitchen', `Ticket #${order.id.slice(0, 6).toUpperCase()} sent to KDS board.`);
      setTimeout(() => setJustSent(false), 1600);
    } catch (e) {
      notify.error('Order Failed', e.message);
    } finally {
      setSending(false);
    }
  };

  const handleProcessPayment = async (method) => {
    if (!paymentModalOrder || processingPay) return;
    setProcessingPay(true);
    try {
      await payOrder(paymentModalOrder.id, paymentModalOrder.total, method);
      notify.success(
        'Payment Settled',
        `Order #${paymentModalOrder.id.slice(0, 6).toUpperCase()} cleared via ${method.toUpperCase()}. Receipt spooled.`
      );
      setPaymentModalOrder(null);
      setProcessingPay(false);
    } catch (e) {
      notify.error('Payment Failed', e.message);
      setProcessingPay(false);
    }
  };

  // Find active order for selected table (if occupied)
  const activeTableOrder = selectedTable
    ? orders.find(o => o.table_id === selectedTable && o.status === 'open')
    : null;

  return (
    <div className="pos-layout">
      <div className="pos-main">
        {/* Table Selector Bar with QR Modal and Occupied status */}
        <div className="table-strip">
          {tables.map((t) => {
            const hasOpenOrder = orders.some(o => o.table_id === t.id && o.status === 'open');
            return (
              <div
                key={t.id}
                className={`table-chip-wrapper ${selectedTable === t.id ? 'selected' : ''}`}
              >
                <button
                  className={`table-chip ${selectedTable === t.id ? 'selected' : ''} ${t.status === 'occupied' || hasOpenOrder ? 'occupied' : ''}`}
                  onClick={() => {
                    setSelectedTable(t.id);
                    setOrderType('dine_in');
                  }}
                >
                  <span>Table {t.table_number}</span>
                  <span className="zone">{t.zone}</span>
                </button>
                {onOpenQrModal && (
                  <button
                    className="btn-table-qr-badge"
                    title={`Generate QR Code for Table ${t.table_number}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenQrModal(t);
                    }}
                  >
                    <QrCode size={10} style={{ marginRight: '2px' }} />
                    <span>QR</span>
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {/* If selected table already has an active open order, show settled banner */}
        {activeTableOrder && (
          <div className="active-table-order-banner">
            <div className="banner-info">
              <UtensilsCrossed size={18} style={{ color: '#3b82f6' }} />
              <div>
                <span><strong>Table {tables.find(t => t.id === selectedTable)?.table_number}</strong> has an active order #{activeTableOrder.id.slice(0, 5).toUpperCase()} ({activeTableOrder.items?.length} items)</span>
              </div>
              <span className="banner-total">EGP {activeTableOrder.total?.toFixed(2)}</span>
            </div>
            <button className="btn-settle-order" onClick={() => setPaymentModalOrder(activeTableOrder)}>
              <CreditCard size={14} style={{ marginRight: '6px', verticalAlign: 'middle' }} />
              <span>Settle & Print Receipt</span>
            </button>
          </div>
        )}

        <div className="category-row">
          {categories.map((c) => (
            <button
              key={c}
              className={`category-pill ${activeCategory === c ? 'active' : ''}`}
              onClick={() => setActiveCategory(c)}
            >
              {c}
            </button>
          ))}
        </div>

        <div className="menu-grid">
          {visibleItems.map((item) => (
            <button key={item.id} className="menu-card" onClick={() => addToCart(item)}>
              <span className="item-name">{item.name}</span>
              <span className="item-price">EGP {item.price.toFixed(0)}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="cart-panel">
        <div className="cart-header">
          <div>
            <h2>Current Order</h2>
            <div className="sub">
              {orderType === 'dine_in'
                ? selectedTable
                  ? `Table ${tables.find((t) => t.id === selectedTable)?.table_number}`
                  : 'No table selected'
                : 'Takeaway Order'}
            </div>
          </div>
          <ShoppingBag size={18} style={{ color: 'var(--text-faint)' }} />
        </div>

        <div className="cart-items">
          {cart.length === 0 ? (
            <div className="cart-empty">
              <div className="cart-empty-icon">
                <ShoppingBag size={22} />
              </div>
              <div style={{ fontWeight: 600, fontSize: '13.5px', color: 'var(--text-dim)' }}>
                Your order is empty
              </div>
              <div style={{ fontSize: '11.5px', color: 'var(--text-faint)', maxWidth: '180px' }}>
                Tap menu cards on the left to add items to this ticket.
              </div>
            </div>
          ) : (
            cart.map((line) => (
              <div className="cart-line" key={line.item.id}>
                <span className="name">{line.item.name}</span>
                <div className="qty-controls">
                  <button className="qty-btn" onClick={() => changeQty(line.item.id, -1)}>
                    <Minus size={12} />
                  </button>
                  <span style={{ minWidth: '16px', textAlign: 'center', fontWeight: 700 }}>{line.quantity}</span>
                  <button className="qty-btn" onClick={() => changeQty(line.item.id, 1)}>
                    <Plus size={12} />
                  </button>
                </div>
                <span className="line-total">EGP {(line.item.price * line.quantity).toFixed(0)}</span>
              </div>
            ))
          )}
        </div>

        <div className="cart-footer">
          <div className="order-type-toggle">
            <button
              className={orderType === 'dine_in' ? 'active' : ''}
              onClick={() => setOrderType('dine_in')}
            >
              <UtensilsCrossed size={13} />
              <span>Dine-in</span>
            </button>
            <button
              className={orderType === 'takeaway' ? 'active' : ''}
              onClick={() => {
                setOrderType('takeaway');
                setSelectedTable(null);
              }}
            >
              <ShoppingBag size={13} />
              <span>Takeaway</span>
            </button>
          </div>
          <div className="cart-total-row">
            <span>Total</span>
            <span className="total-amt">EGP {total.toFixed(0)}</span>
          </div>
          <button className="send-btn" disabled={!canSend || sending} onClick={handleSend}>
            {justSent ? (
              <>
                <Check size={16} />
                <span>Sent to Kitchen!</span>
              </>
            ) : sending ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                <span>Sending…</span>
              </>
            ) : (
              <>
                <Send size={16} />
                <span>Send to Kitchen</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Payment Tender Modal */}
      {paymentModalOrder && (
        <div className="modal-backdrop" onClick={() => setPaymentModalOrder(null)}>
          <div className="modal-card payment-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <CreditCard size={18} style={{ color: 'var(--accent)' }} />
                <h3>Settle Order #{paymentModalOrder.id.slice(0, 6).toUpperCase()}</h3>
              </div>
              <button className="btn-close" onClick={() => setPaymentModalOrder(null)}><X size={18} /></button>
            </div>
            <div className="modal-body" style={{ padding: '20px' }}>
              <div className="pay-amount-display">
                <span className="label">Total Amount Due:</span>
                <span className="value">EGP {paymentModalOrder.total?.toFixed(2)}</span>
              </div>
              <p style={{ fontSize: '12px', color: 'var(--text-dim)', textAlign: 'center', marginBottom: '20px' }}>
                Selecting Cash automatically triggers the cash drawer kick solenoid (FR-5.3) and dispatches an itemized thermal receipt (FR-5.2).
              </p>
              <div className="tender-btn-grid">
                <button
                  className="btn-tender cash"
                  disabled={processingPay}
                  onClick={() => handleProcessPayment('cash')}
                >
                  <Banknote size={32} />
                  <span>Cash Payment</span>
                  <small>Kicks drawer & prints receipt</small>
                </button>
                <button
                  className="btn-tender card"
                  disabled={processingPay}
                  onClick={() => handleProcessPayment('card')}
                >
                  <CreditCard size={32} />
                  <span>Card / Terminal</span>
                  <small>Captures terminal & prints receipt</small>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

