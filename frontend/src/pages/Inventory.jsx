import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { api } from '../api';

export default function Inventory() {
  const { inventory, inventoryLoading, fetchInventory, updateInventoryStock, branchId, currentUser } = useStore();
  const [recipes, setRecipes] = useState([]);
  const [recipesLoading, setRecipesLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('stock'); // 'stock' | 'recipes'
  const [editingItem, setEditingItem] = useState(null);
  const [adjustQty, setAdjustQty] = useState('');
  const [feedbackMsg, setFeedbackMsg] = useState(null);

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
      setFeedbackMsg(`Updated ${editingItem.name} stock to ${adjustQty} ${editingItem.unit}`);
      setEditingItem(null);
      setAdjustQty('');
      setTimeout(() => setFeedbackMsg(null), 3000);
    } catch (err) {
      alert('Failed to update stock: ' + err.message);
    }
  };

  const isManager = currentUser?.role === 'manager';

  return (
    <div className="inventory-page">
      <div className="inv-header">
        <div>
          <h2>📦 Ingredient Inventory & Recipe Deductions</h2>
          <p className="inv-subtitle">
            Real-time stock depletion linked to menu orders (FR-6.1, FR-6.2, FR-6.3)
          </p>
        </div>
        <div className="inv-tabs">
          <button
            className={`inv-tab-btn ${activeTab === 'stock' ? 'active' : ''}`}
            onClick={() => setActiveTab('stock')}
          >
            Ingredient Stock ({totalItems})
          </button>
          <button
            className={`inv-tab-btn ${activeTab === 'recipes' ? 'active' : ''}`}
            onClick={() => setActiveTab('recipes')}
          >
            Menu Recipes ({recipes.length})
          </button>
        </div>
      </div>

      {feedbackMsg && (
        <div className="feedback-banner success">
          ✓ {feedbackMsg}
        </div>
      )}

      {lowStockItems.length > 0 && activeTab === 'stock' && (
        <div className="feedback-banner warning">
          ⚠️ <strong>Low Stock Alert:</strong> {lowStockItems.map(i => `${i.name} (${i.stock_qty} ${i.unit} left)`).join(', ')}
        </div>
      )}

      {/* KPI Cards */}
      <div className="inv-kpi-grid">
        <div className="inv-kpi-card">
          <div className="kpi-label">Total Ingredients</div>
          <div className="kpi-value">{totalItems}</div>
          <div className="kpi-foot">Tracked across catalog</div>
        </div>
        <div className="inv-kpi-card in-stock">
          <div className="kpi-label">Adequate Stock</div>
          <div className="kpi-value">{inStockItems.length}</div>
          <div className="kpi-foot">Healthy inventory</div>
        </div>
        <div className="inv-kpi-card low-stock">
          <div className="kpi-label">Low Stock Warnings</div>
          <div className="kpi-value">{lowStockItems.length}</div>
          <div className="kpi-foot">At or below reorder level</div>
        </div>
        <div className="inv-kpi-card out-stock">
          <div className="kpi-label">Out of Stock</div>
          <div className="kpi-value">{outOfStockItems.length}</div>
          <div className="kpi-foot">Requires immediate restock</div>
        </div>
      </div>

      {/* Main Content: Stock Table */}
      {activeTab === 'stock' && (
        <div className="inv-table-card">
          <div className="table-card-head">
            <h3>Current Stock Levels</h3>
            <button className="btn-refresh" onClick={fetchInventory} disabled={inventoryLoading}>
              {inventoryLoading ? 'Refreshing...' : '🔄 Refresh Stock'}
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
                    <td><span className="category-pill">{item.category}</span></td>
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
                        <span className="text-muted" style={{ fontSize: '11px' }}>Manager only</span>
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
              <button className="btn-close" onClick={() => setEditingItem(null)}>×</button>
            </div>
            <form onSubmit={handleSaveStock} className="modal-body">
              <p style={{ fontSize: '13px', opacity: 0.8, marginBottom: '16px' }}>
                Current stock: <strong>{editingItem.stock_qty} {editingItem.unit}</strong> (Reorder threshold: {editingItem.reorder_level} {editingItem.unit})
              </p>
              <div className="form-group">
                <label>New Stock Quantity ({editingItem.unit}):</label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  className="input-number"
                  value={adjustQty}
                  onChange={(e) => setAdjustQty(e.target.value)}
                  autoFocus
                  required
                />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setEditingItem(null)}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary">
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
