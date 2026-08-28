import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store';
import { notify } from '../components/Toast';
import ThermalCashReceipt from '../components/ThermalCashReceipt';
import { buildReceiptLayout } from '../receipt';
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
  const { menu, tables, orders, placeOrder, payOrder, shopProfile } = useStore();
  const [selectedTable, setSelectedTable] = useState(null);
  const [orderType, setOrderType] = useState('dine_in');
  const [activeCategory, setActiveCategory] = useState('All');
  const [cart, setCart] = useState([]); // [{item, quantity}]
  const [sending, setSending] = useState(false);
  const [justSent, setJustSent] = useState(false);
  const [paymentModalOrder, setPaymentModalOrder] = useState(null);
  const [processingPay, setProcessingPay] = useState(false);
  const [payMethod, setPayMethod] = useState('cash');
  const [cashInput, setCashInput] = useState('');

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

  useEffect(() => {
    setCashInput('');
    setPayMethod('cash');
  }, [paymentModalOrder?.id]);

  const paymentTable = paymentModalOrder
    ? tables.find((t) => t.id === paymentModalOrder.table_id)
    : null;
  const dueAmount = Number(paymentModalOrder?.total) || 0;
  const cashTendered = cashInput === '' ? dueAmount : Number(cashInput);
  const liveChange = Math.max(0, (Number.isFinite(cashTendered) ? cashTendered : 0) - dueAmount);
  const cashShort = payMethod === 'cash' && Number.isFinite(cashTendered) && cashTendered < dueAmount;
  const cashSuggestions = useMemo(() => {
    const due = dueAmount;
    const rounded = Math.ceil(due / 50) * 50;
    return [...new Set([due, rounded, 100, 200, 500].filter((n) => n >= due))].slice(0, 4);
  }, [dueAmount]);

  const liveReceiptLayout = useMemo(() => {
    if (!paymentModalOrder) return null;
    return buildReceiptLayout({
      shop: shopProfile || {},
      order: {
        ...paymentModalOrder,
        table_number: paymentTable?.table_number,
      },
      payment: {
        method: payMethod,
        cash_tendered: payMethod === 'cash' ? (Number.isFinite(cashTendered) ? cashTendered : dueAmount) : null,
        card_last4: payMethod === 'card' ? String(paymentModalOrder.id || '').replace(/[^0-9a-z]/gi, '').slice(-4).toUpperCase() : null,
        approval_code: payMethod === 'card' ? `#${String(paymentModalOrder.id || '').slice(0, 6).toUpperCase()}` : null,
      },
    });
  }, [paymentModalOrder, paymentTable, shopProfile, payMethod, cashTendered, dueAmount]);

  const handleProcessPayment = async (method) => {
    if (!paymentModalOrder || processingPay) return;
    if (method === 'cash') {
      const tendered = cashInput === '' ? dueAmount : Number(cashInput);
      if (!Number.isFinite(tendered) || tendered < dueAmount) {
        notify.error('Insufficient Cash', 'Cash tendered must cover the amount due.');
        return;
      }
    }
    setProcessingPay(true);
    try {
      const extras = method === 'cash'
        ? { cash_tendered: cashInput === '' ? dueAmount : Number(cashInput) }
        : {
            card_last4: String(paymentModalOrder.id || '').replace(/[^0-9a-z]/gi, '').slice(-4).toUpperCase(),
            approval_code: `#${String(paymentModalOrder.id || '').slice(0, 6).toUpperCase()}`,
          };
      await payOrder(paymentModalOrder.id, paymentModalOrder.total, method, extras);
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
            <div className="modal-body payment-settle-body">
              <div className="payment-settle-controls">
                <div className="pay-amount-display">
                  <span className="label">Total Amount Due:</span>
                  <span className="value">EGP {dueAmount.toFixed(1)}</span>
                </div>

                <div className="pay-method-toggle">
                  <button
                    className={`pay-method-chip ${payMethod === 'cash' ? 'active' : ''}`}
                    onClick={() => setPayMethod('cash')}
                    type="button"
                  >
                    <Banknote size={14} /> Cash
                  </button>
                  <button
                    className={`pay-method-chip ${payMethod === 'card' ? 'active' : ''}`}
                    onClick={() => setPayMethod('card')}
                    type="button"
                  >
                    <CreditCard size={14} /> Card
                  </button>
                </div>

                {payMethod === 'cash' && (
                  <div className="cash-tender-box">
                    <label htmlFor="cash-tendered">Cash tendered</label>
                    <input
                      id="cash-tendered"
                      type="number"
                      min={dueAmount}
                      step="0.5"
                      placeholder={dueAmount.toFixed(1)}
                      value={cashInput}
                      onChange={(e) => setCashInput(e.target.value)}
                    />
                    <div className="cash-quick-btns">
                      {cashSuggestions.map((amt) => (
                        <button type="button" key={amt} onClick={() => setCashInput(String(amt))}>
                          {amt === dueAmount ? 'Exact' : amt}
                        </button>
                      ))}
                    </div>
                    <div className={`cash-change ${cashShort ? 'short' : ''}`}>
                      {cashShort
                        ? `Short by EGP ${(dueAmount - cashTendered).toFixed(1)}`
                        : `Change: EGP ${liveChange.toFixed(1)}`}
                    </div>
                  </div>
                )}

                <p className="pay-hint">
                  Confirming payment prints a live receipt from this order and {payMethod === 'cash' ? 'kicks the cash drawer.' : 'records the card approval.'}
                </p>
                <div className="tender-btn-grid">
                  <button
                    className="btn-tender cash"
                    disabled={processingPay || (payMethod === 'cash' && cashShort)}
                    onClick={() => handleProcessPayment(payMethod)}
                  >
                    {payMethod === 'cash' ? <Banknote size={28} /> : <CreditCard size={28} />}
                    <span>{payMethod === 'cash' ? 'Confirm Cash & Print' : 'Confirm Card & Print'}</span>
                    <small>{processingPay ? 'Printing…' : 'Receipt updates from this order'}</small>
                  </button>
                </div>
              </div>
              <div className="payment-receipt-preview">
                <div className="spooler-col-title">Live receipt</div>
                <ThermalCashReceipt layout={liveReceiptLayout} compact />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

