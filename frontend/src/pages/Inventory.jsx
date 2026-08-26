import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { api } from '../api';
import { notify } from '../components/Toast';
import {
  Boxes,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  X,
  ChefHat
} from 'lucide-react';

export default function Inventory() {
  const { inventory, inventoryLoading, fetchInventory, updateInventoryStock, branchId, currentUser } = useStore();
  const [recipes, setRecipes] = useState([]);
  const [recipesLoading, setRecipesLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('stock'); // 'stock' | 'recipes'
  const [editingItem, setEditingItem] = useState(null);
  const [adjustQty, setAdjustQty] = useState('');

  useEffect(() => {
    fetchInventory();
    if (branchId) {
      setRecipesLoading(true);
      api.getRecipes(branchId)
        .then(data => {
          setRecipes(data);
          setRecipesLoading(false);
        })
        .catch(() => setRecipesLoading(false));
    }
  }, [branchId]);

  const totalItems = inventory.length;
  const lowStockItems = inventory.filter(i => i.status === 'low_stock');
  const outOfStockItems = inventory.filter(i => i.status === 'out_of_stock');
  const inStockItems = inventory.filter(i => i.status === 'in_stock');

  const handleSaveStock = async (e) => {
    e.preventDefault();
    if (!editingItem || adjustQty === '') return;
    try {
      await updateInventoryStock(editingItem.id, Number(adjustQty));
      notify.success(
        'Stock Updated',
        `${editingItem.name} stock level reset to ${adjustQty} ${editingItem.unit}.`
      );
      setEditingItem(null);
      setAdjustQty('');
    } catch (err) {
      notify.error('Update Failed', err.message || 'Failed to update stock');
    }
  };

  const isManager = currentUser?.role === 'manager';

  return (
    <div className="inventory-page">
      <div className="inv-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{
            width: '42px',
            height: '42px',
            borderRadius: '10px',
            background: 'rgba(249, 115, 22, 0.15)',
            color: 'var(--accent)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <Boxes size={24} />
          </div>
          <div>
            <h2>Ingredient Inventory & Recipe Deductions</h2>
            <p className="inv-subtitle">
              Real-time stock depletion linked to menu orders (FR-6.1, FR-6.2, FR-6.3)
            </p>
          </div>
        </div>
        <div className="inv-tabs">
          <button
            className={`inv-tab-btn ${activeTab === 'stock' ? 'active' : ''}`}
            onClick={() => setActiveTab('stock')}
          >
            <Boxes size={14} style={{ marginRight: '6px', verticalAlign: 'middle' }} />
            <span>Stock Levels ({totalItems})</span>
          </button>
          <button
            className={`inv-tab-btn ${activeTab === 'recipes' ? 'active' : ''}`}
            onClick={() => setActiveTab('recipes')}
          >
            <ChefHat size={14} style={{ marginRight: '6px', verticalAlign: 'middle' }} />
            <span>Recipes ({recipes.length})</span>
          </button>
        </div>
      </div>

      {lowStockItems.length > 0 && activeTab === 'stock' && (
        <div className="feedback-banner warning" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <AlertTriangle size={18} style={{ color: '#f59e0b', flexShrink: 0 }} />
          <div>
            <strong>Low Stock Alert:</strong> {lowStockItems.map(i => `${i.name} (${i.stock_qty} ${i.unit} left)`).join(', ')}
          </div>
        </div>
      )}

      {/* KPI Cards */}
      <div className="inv-kpi-grid">
        <div className="inv-kpi-card">
          <div className="kpi-label">Total Ingredients</div>
          <div className="kpi-value">{totalItems}</div>
          <div className="kpi-foot">Tracked across menu catalog</div>
        </div>
        <div className="inv-kpi-card in-stock">
          <div className="kpi-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <CheckCircle2 size={13} style={{ color: '#10b981' }} />
            <span>Adequate Stock</span>
          </div>
          <div className="kpi-value">{inStockItems.length}</div>
          <div className="kpi-foot">Healthy inventory levels</div>
        </div>
        <div className="inv-kpi-card low-stock">
          <div className="kpi-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <AlertTriangle size={13} style={{ color: '#f59e0b' }} />
            <span>Low Stock Warnings</span>
          </div>
          <div className="kpi-value">{lowStockItems.length}</div>
          <div className="kpi-foot">At or below reorder threshold</div>
        </div>
        <div className="inv-kpi-card out-stock">
          <div className="kpi-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <XCircle size={13} style={{ color: '#ef4444' }} />
            <span>Out of Stock</span>
          </div>
          <div className="kpi-value">{outOfStockItems.length}</div>
          <div className="kpi-foot">Requires immediate supplier order</div>
        </div>
      </div>

      {/* Main Content: Stock Table */}
      {activeTab === 'stock' && (
        <div className="inv-table-card">
          <div className="table-card-head">
            <h3>Current Stock Levels</h3>
            <button
              className="btn-refresh"
              onClick={() => {
                fetchInventory();
                notify.info('Inventory', 'Stock records refreshed');
              }}
              disabled={inventoryLoading}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
            >
              <RefreshCw size={13} className={inventoryLoading ? 'animate-spin' : ''} />
              <span>{inventoryLoading ? 'Refreshing...' : 'Refresh Stock'}</span>
            </button>
          </div>

          <table className="inv-table">
            <thead>
              <tr>
                <th>Ingredient</th>
                <th>Category</th>
                <th>Current Stock</th>
                <th>Reorder Level</th>
                <th>Unit Cost</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {inventory.map((item) => {
                const percent = Math.min(100, Math.round((item.stock_qty / (item.reorder_level * 3 || 100)) * 100));
                return (
                  <tr key={item.id} className={`status-row-${item.status}`}>
                    <td className="font-semibold">{item.name}</td>
                    <td><span className="category-pill" style={{ padding: '3px 10px', fontSize: '11px' }}>{item.category}</span></td>
                    <td>
                      <div className="stock-level-cell">
                        <span className="stock-num">{item.stock_qty} {item.unit}</span>
                        <div className="stock-meter">
                          <div
                            className={`stock-meter-bar ${item.status}`}
                            style={{ width: `${percent}%` }}
                          />
                        </div>
                      </div>
                    </td>
                    <td>{item.reorder_level} {item.unit}</td>
                    <td>EGP {item.cost_per_unit?.toFixed(2)} / {item.unit}</td>
                    <td>
                      <span className={`status-badge badge-${item.status}`}>
                        {item.status === 'in_stock' ? 'In Stock' : item.status === 'low_stock' ? 'Low Stock' : 'Out of Stock'}
                      </span>
                    </td>
                    <td>
                      {isManager ? (
                        <button
                          className="btn-stock-adjust"
                          onClick={() => {
                            setEditingItem(item);
                            setAdjustQty(String(item.stock_qty));
                          }}
                        >
                          Restock
                        </button>
                      ) : (
                        <span className="text-muted" style={{ fontSize: '11px', color: 'var(--text-faint)' }}>Manager only</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Main Content: Recipe Explorer */}
      {activeTab === 'recipes' && (
        <div className="inv-table-card">
          <div className="table-card-head">
            <h3>Menu Item Recipes & Automatic Consumption</h3>
          </div>
          <table className="inv-table">
            <thead>
              <tr>
                <th>Menu Item</th>
                <th>Consumed Ingredient</th>
                <th>Quantity Used Per Serving</th>
              </tr>
            </thead>
            <tbody>
              {recipes.map((r) => (
                <tr key={r.id}>
                  <td className="font-semibold">{r.menu_item_name}</td>
                  <td>{r.ingredient_name}</td>
                  <td>
                    <span className="qty-tag">{r.qty_used} {r.unit}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Restock Modal */}
      {editingItem && (
        <div className="modal-backdrop" onClick={() => setEditingItem(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Restock {editingItem.name}</h3>
              <button className="btn-close" onClick={() => setEditingItem(null)}><X size={18} /></button>
            </div>
            <form onSubmit={handleSaveStock} className="modal-body" style={{ padding: '20px' }}>
              <p style={{ fontSize: '13px', color: 'var(--text-dim)', marginBottom: '16px' }}>
                Current stock: <strong>{editingItem.stock_qty} {editingItem.unit}</strong> (Reorder threshold: {editingItem.reorder_level} {editingItem.unit})
              </p>
              <div className="form-group" style={{ marginBottom: '20px' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px' }}>
                  New Stock Quantity ({editingItem.unit}):
                </label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  className="input-number"
                  style={{
                    width: '100%',
                    padding: '10px 14px',
                    borderRadius: '8px',
                    border: '1px solid var(--border)',
                    background: 'var(--surface-2)',
                    color: 'var(--text)',
                    fontSize: '15px'
                  }}
                  value={adjustQty}
                  onChange={(e) => setAdjustQty(e.target.value)}
                  autoFocus
                  required
                />
              </div>
              <div className="modal-actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button
                  type="button"
                  className="btn-secondary"
                  style={{
                    padding: '8px 16px',
                    borderRadius: '8px',
                    background: 'var(--surface-2)',
                    border: '1px solid var(--border)',
                    color: 'var(--text)'
                  }}
                  onClick={() => setEditingItem(null)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                  style={{
                    padding: '8px 18px',
                    borderRadius: '8px',
                    background: 'var(--accent)',
                    border: 'none',
                    color: 'white',
                    fontWeight: 700
                  }}
                >
                  Save Stock Level
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

