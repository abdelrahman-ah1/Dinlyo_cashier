import { useEffect, useState } from 'react';
import { api } from '../api';

export default function SelfOrder({ tableNumber = '3', branchId = 'default', onBackToPos }) {
  const [menu, setMenu] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedCat, setSelectedCat] = useState('All');
  const [cart, setCart] = useState([]);
  const [guestName, setGuestName] = useState('');
  const [orderSuccess, setOrderSuccess] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setLoading(true);
    api.getPublicMenu(branchId)
      .then((data) => {
        setMenu(data);
        setLoading(false);
      })
      .catch((err) => {
        console.error('Failed to load public menu:', err);
        setLoading(false);
      });
  }, [branchId]);

  const categories = ['All', ...new Set(menu.map(m => m.category))];
  const filteredMenu = selectedCat === 'All' ? menu : menu.filter(m => m.category === selectedCat);

  const handleAddToCart = (item) => {
    setCart((prev) => {
      const idx = prev.findIndex(i => i.item_id === item.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], quantity: next[idx].quantity + 1 };
        return next;
      }
      return [...prev, { item_id: item.id, item_name: item.name, price: item.price, quantity: 1 }];
    });
  };

  const handleUpdateQty = (itemId, delta) => {
    setCart((prev) => {
      return prev
        .map((line) => {
          if (line.item_id === itemId) {
            const newQty = line.quantity + delta;
            return newQty > 0 ? { ...line, quantity: newQty } : null;
          }
          return line;
        })
        .filter(Boolean);
    });
  };

  const cartTotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);

  const handleSubmitOrder = async () => {
    if (cart.length === 0 || submitting) return;
    setSubmitting(true);
    try {
      const order = await api.createPublicOrder({
        branch_id: branchId,
        table_id: String(tableNumber),
        items: cart.map(i => ({ item_id: i.item_id, quantity: i.quantity })),
        guest_name: guestName.trim() || `Guest at Table ${tableNumber}`,
      });
      setOrderSuccess(order);
      setCart([]);
      setSubmitting(false);
    } catch (err) {
      alert('Order submission failed: ' + err.message);
      setSubmitting(false);
    }
  };

  if (orderSuccess) {
    return (
      <div className="self-order-container">
        <div className="self-order-success-card">
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>🎉</div>
          <h2>Order Sent to Kitchen!</h2>
          <p className="order-num-highlight">Ticket #{orderSuccess.id.slice(0, 6).toUpperCase()}</p>
          <div className="success-meta-box">
            <div>Table: <strong>Table {tableNumber}</strong></div>
            <div>Items: <strong>{orderSuccess.items?.length} items</strong></div>
            <div>Total: <strong>EGP {orderSuccess.total?.toFixed(2)}</strong></div>
          </div>
          <p style={{ fontSize: '13px', opacity: 0.8, marginTop: '16px' }}>
            Our kitchen staff has received your ticket and is preparing your order right now.
          </p>
          <div className="success-actions">
            <button className="btn-order-more" onClick={() => setOrderSuccess(null)}>
              + Place Another Order
            </button>
            {onBackToPos && (
              <button className="btn-back-pos" onClick={onBackToPos}>
                ← Return to Cashier POS
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="self-order-container">
      {/* Mobile App Header */}
      <div className="self-order-nav">
        <div>
          <div className="brand-logo-text">DEMO RESTAURANT</div>
          <div className="table-badge-mobile">🍽️ Table {tableNumber} • Dine-In Guest Order</div>
        </div>
        {onBackToPos && (
          <button className="btn-exit-self-order" onClick={onBackToPos}>
            Exit to POS
          </button>
        )}
      </div>

      {/* Categories Horizontal Scroll Bar */}
      <div className="category-scroll-bar">
        {categories.map((cat) => (
          <button
            key={cat}
            className={`cat-pill-btn ${selectedCat === cat ? 'active' : ''}`}
            onClick={() => setSelectedCat(cat)}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Menu Cards */}
      <div className="self-menu-grid">
        {loading ? (
          <div className="loading-state">Loading menu...</div>
        ) : (
          filteredMenu.map((item) => {
            const inCart = cart.find(i => i.item_id === item.id);
            return (
              <div key={item.id} className="self-menu-card">
                <div className="self-card-info">
                  <span className="self-card-cat">{item.category}</span>
                  <h3 className="self-card-title">{item.name}</h3>
                  <div className="self-card-price">EGP {item.price.toFixed(2)}</div>
                </div>
                <div className="self-card-actions">
                  {inCart ? (
                    <div className="qty-picker">
                      <button onClick={() => handleUpdateQty(item.id, -1)}>-</button>
                      <span>{inCart.quantity}</span>
                      <button onClick={() => handleUpdateQty(item.id, 1)}>+</button>
                    </div>
                  ) : (
                    <button className="btn-add-item" onClick={() => handleAddToCart(item)}>
                      + Add
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Bottom Cart Drawer / Checkout Bar */}
      {cart.length > 0 && (
        <div className="self-order-bottom-bar">
          <div className="cart-summary-col">
            <div className="cart-total-amount">EGP {cartTotal.toFixed(2)}</div>
            <div className="cart-items-count">{cart.reduce((s, i) => s + i.quantity, 0)} items in cart</div>
          </div>
          <div className="cart-actions-col">
            <input
              type="text"
              placeholder="Your name (optional)"
              className="guest-name-input"
              value={guestName}
              onChange={(e) => setGuestName(e.target.value)}
            />
            <button className="btn-submit-order" onClick={handleSubmitOrder} disabled={submitting}>
              {submitting ? 'Sending...' : '⚡ Send to Kitchen'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
