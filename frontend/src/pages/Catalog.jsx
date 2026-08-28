import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store';
import { api } from '../api';
import { notify } from '../components/Toast';
import {
  Store,
  Plus,
  Pencil,
  Trash2,
  X,
  Armchair,
  UtensilsCrossed,
  Lock,
} from 'lucide-react';

const EMPTY_BRANCH = {
  name: '',
  receipt_name: '',
  address: '',
  phone: '',
  currency: 'EGP',
  timezone: 'Africa/Cairo',
  copy_menu_from: '',
};
const EMPTY_TABLE = { table_number: '', zone: 'Indoor', capacity: 4 };
const EMPTY_MENU = { name: '', category: 'Food', price: '', tax_rate: 0.14, is_available: 1 };

export default function Catalog() {
  const {
    currentUser,
    branchId,
    branches,
    tables,
    menu,
    fetchBranches,
    switchBranch,
    saveBranch,
    removeBranch,
    saveTable,
    removeTable,
    saveMenuItem,
    removeMenuItem,
  } = useStore();

  const [tab, setTab] = useState('branches');
  const [catalogBranchId, setCatalogBranchId] = useState(branchId);
  const [catalogTables, setCatalogTables] = useState([]);
  const [catalogMenu, setCatalogMenu] = useState([]);
  const [loading, setLoading] = useState(false);
  const [editor, setEditor] = useState(null);
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);

  const isManager = currentUser?.role === 'manager';
  const activeBranch = branches.find((b) => b.id === catalogBranchId);

  useEffect(() => {
    fetchBranches().catch(() => {});
  }, []);

  useEffect(() => {
    if (branchId && !catalogBranchId) setCatalogBranchId(branchId);
  }, [branchId, catalogBranchId]);

  useEffect(() => {
    if (!catalogBranchId) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([
      api.getTables(catalogBranchId),
      api.getMenu(catalogBranchId, true),
    ])
      .then(([nextTables, nextMenu]) => {
        if (!cancelled) {
          setCatalogTables(nextTables);
          setCatalogMenu(nextMenu);
        }
      })
      .catch(() => {
        if (!cancelled) notify.error('Load failed', 'Could not load this branch catalog');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [catalogBranchId, branchId, tables, menu]);

  const refreshCatalog = async () => {
    if (!catalogBranchId) return;
    const [nextTables, nextMenu] = await Promise.all([
      api.getTables(catalogBranchId),
      api.getMenu(catalogBranchId, true),
    ]);
    setCatalogTables(nextTables);
    setCatalogMenu(nextMenu);
  };

  const categories = useMemo(
    () => [...new Set(catalogMenu.map((m) => m.category).filter(Boolean))],
    [catalogMenu],
  );

  if (!isManager) {
    return (
      <div className="audit-denied-card">
        <Lock size={32} />
        <h3>Access Restricted</h3>
        <p>Catalog management is restricted to General Managers.</p>
      </div>
    );
  }

  const openCreate = (type) => {
    if (type === 'branch') setForm({ ...EMPTY_BRANCH });
    if (type === 'table') setForm({ ...EMPTY_TABLE, branch_id: catalogBranchId });
    if (type === 'menu') setForm({ ...EMPTY_MENU, branch_id: catalogBranchId });
    setEditor({ type, mode: 'create', id: null });
  };

  const openEdit = (type, row) => {
    if (type === 'branch') {
      setForm({
        name: row.name || '',
        receipt_name: row.receipt_name || '',
        address: row.address || '',
        phone: row.phone || '',
        currency: row.currency || 'EGP',
        timezone: row.timezone || 'Africa/Cairo',
      });
    }
    if (type === 'table') {
      setForm({
        branch_id: row.branch_id,
        table_number: row.table_number || '',
        zone: row.zone || 'Indoor',
        capacity: row.capacity || 4,
      });
    }
    if (type === 'menu') {
      setForm({
        branch_id: row.branch_id,
        name: row.name || '',
        category: row.category || 'Food',
        price: row.price ?? '',
        tax_rate: row.tax_rate ?? 0.14,
        is_available: row.is_available ? 1 : 0,
      });
    }
    setEditor({ type, mode: 'edit', id: row.id });
  };

  const closeEditor = () => {
    setEditor(null);
    setForm({});
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!editor) return;
    setSaving(true);
    try {
      if (editor.type === 'branch') {
        const payload = { ...form };
        if (editor.mode === 'edit') delete payload.copy_menu_from;
        if (!payload.copy_menu_from) delete payload.copy_menu_from;
        await saveBranch(payload, editor.mode === 'edit' ? editor.id : null);
        notify.success(editor.mode === 'edit' ? 'Branch updated' : 'Branch created', payload.name);
      }
      if (editor.type === 'table') {
        await saveTable(form, editor.mode === 'edit' ? editor.id : null);
        notify.success(editor.mode === 'edit' ? 'Table updated' : 'Table added', `Table ${form.table_number}`);
      }
      if (editor.type === 'menu') {
        await saveMenuItem(
          { ...form, price: Number(form.price), tax_rate: Number(form.tax_rate), is_available: form.is_available ? 1 : 0 },
          editor.mode === 'edit' ? editor.id : null,
        );
        notify.success(editor.mode === 'edit' ? 'Product updated' : 'Product added', form.name);
      }
      await refreshCatalog();
      closeEditor();
    } catch (err) {
      notify.error('Save failed', err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (type, row) => {
    const label = type === 'branch' ? row.name : type === 'table' ? `Table ${row.table_number}` : row.name;
    if (!window.confirm(`Delete ${label}? This cannot be undone.`)) return;
    try {
      if (type === 'branch') await removeBranch(row.id);
      if (type === 'table') await removeTable(row.id);
      if (type === 'menu') await removeMenuItem(row.id);
      await refreshCatalog();
      notify.success('Deleted', label);
    } catch (err) {
      notify.error('Delete failed', err.message);
    }
  };

  const setField = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  return (
    <div className="catalog-page">
      <div className="inv-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div className="catalog-icon">
            <Store size={22} />
          </div>
          <div>
            <h2>Branch & Catalog Manager</h2>
            <p className="inv-subtitle">Add and edit branches, floor tables, and menu products</p>
          </div>
        </div>
        <div className="inv-tabs">
          <button className={`inv-tab-btn ${tab === 'branches' ? 'active' : ''}`} onClick={() => setTab('branches')}>
            <Store size={14} /> Branches ({branches.length})
          </button>
          <button className={`inv-tab-btn ${tab === 'tables' ? 'active' : ''}`} onClick={() => setTab('tables')}>
            <Armchair size={14} /> Tables
          </button>
          <button className={`inv-tab-btn ${tab === 'menu' ? 'active' : ''}`} onClick={() => setTab('menu')}>
            <UtensilsCrossed size={14} /> Menu
          </button>
        </div>
      </div>

      {tab !== 'branches' && (
        <div className="catalog-toolbar">
          <label>
            Working branch
            <select value={catalogBranchId || ''} onChange={(e) => setCatalogBranchId(e.target.value)}>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </label>
          {catalogBranchId && catalogBranchId !== branchId && (
            <button className="btn-print" type="button" onClick={() => switchBranch(catalogBranchId)}>
              Use this branch on POS
            </button>
          )}
        </div>
      )}

      {tab === 'branches' && (
        <div className="eod-section-card">
          <div className="table-card-head">
            <h3>All branches</h3>
            <button className="btn-print" type="button" onClick={() => openCreate('branch')}>
              <Plus size={14} /> Add branch
            </button>
          </div>
          <div className="eod-table-scroll">
            <table className="eod-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Receipt name</th>
                  <th>Address</th>
                  <th>Phone</th>
                  <th>Tables</th>
                  <th>Menu items</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {branches.map((b) => (
                  <tr key={b.id} className={b.id === branchId ? 'catalog-active-row' : ''}>
                    <td className="font-medium">{b.name}</td>
                    <td>{b.receipt_name || '—'}</td>
                    <td>{b.address || '—'}</td>
                    <td>{b.phone || '—'}</td>
                    <td>{b.tableCount ?? 0}</td>
                    <td>{b.menuCount ?? 0}</td>
                    <td className="catalog-actions">
                      <button type="button" title="Edit" onClick={() => openEdit('branch', b)}><Pencil size={14} /></button>
                      <button type="button" title="Delete" onClick={() => handleDelete('branch', b)}><Trash2 size={14} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'tables' && (
        <div className="eod-section-card">
          <div className="table-card-head">
            <h3>Tables — {activeBranch?.name || 'Branch'}</h3>
            <button className="btn-print" type="button" onClick={() => openCreate('table')} disabled={!catalogBranchId}>
              <Plus size={14} /> Add table
            </button>
          </div>
          {loading ? <div className="loading-state">Loading tables…</div> : (
            <table className="eod-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Zone</th>
                  <th>Capacity</th>
                  <th>Floor status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {catalogTables.map((t) => (
                  <tr key={t.id}>
                    <td className="font-medium">Table {t.table_number}</td>
                    <td>{t.zone}</td>
                    <td>{t.capacity}</td>
                    <td>{t.status}</td>
                    <td className="catalog-actions">
                      <button type="button" onClick={() => openEdit('table', t)}><Pencil size={14} /></button>
                      <button type="button" onClick={() => handleDelete('table', t)}><Trash2 size={14} /></button>
                    </td>
                  </tr>
                ))}
                {catalogTables.length === 0 && (
                  <tr><td colSpan={5} className="spooler-empty">No tables yet. Add the first one for this branch.</td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'menu' && (
        <div className="eod-section-card">
          <div className="table-card-head">
            <h3>Menu products — {activeBranch?.name || 'Branch'}</h3>
            <button className="btn-print" type="button" onClick={() => openCreate('menu')} disabled={!catalogBranchId}>
              <Plus size={14} /> Add product
            </button>
          </div>
          {loading ? <div className="loading-state">Loading menu…</div> : (
            <table className="eod-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Category</th>
                  <th>Price</th>
                  <th>Tax</th>
                  <th>Available</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {catalogMenu.map((item) => (
                  <tr key={item.id} className={!item.is_available ? 'eod-row-idle' : ''}>
                    <td className="font-medium">{item.name}</td>
                    <td>{item.category}</td>
                    <td>EGP {Number(item.price || 0).toFixed(2)}</td>
                    <td>{Math.round((item.tax_rate || 0) * 100)}%</td>
                    <td>{item.is_available ? 'Yes' : 'Hidden'}</td>
                    <td className="catalog-actions">
                      <button type="button" onClick={() => openEdit('menu', item)}><Pencil size={14} /></button>
                      <button type="button" onClick={() => handleDelete('menu', item)}><Trash2 size={14} /></button>
                    </td>
                  </tr>
                ))}
                {catalogMenu.length === 0 && (
                  <tr><td colSpan={6} className="spooler-empty">No products yet. Add a menu item or copy a menu when creating a branch.</td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      )}

      {editor && (
        <div className="modal-backdrop" onClick={closeEditor}>
          <div className="modal-card catalog-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>
                {editor.mode === 'edit' ? 'Edit' : 'Add'}{' '}
                {editor.type === 'branch' ? 'branch' : editor.type === 'table' ? 'table' : 'menu product'}
              </h3>
              <button className="btn-close" type="button" onClick={closeEditor}><X size={18} /></button>
            </div>
            <form className="catalog-form" onSubmit={handleSave}>
              {editor.type === 'branch' && (
                <>
                  <label>Branch name<input required value={form.name || ''} onChange={(e) => setField('name', e.target.value)} /></label>
                  <label>Receipt name<input value={form.receipt_name || ''} onChange={(e) => setField('receipt_name', e.target.value)} placeholder="Printed on receipts" /></label>
                  <label>Address<input value={form.address || ''} onChange={(e) => setField('address', e.target.value)} /></label>
                  <label>Phone<input value={form.phone || ''} onChange={(e) => setField('phone', e.target.value)} /></label>
                  <div className="catalog-form-row">
                    <label>Currency<input value={form.currency || ''} onChange={(e) => setField('currency', e.target.value)} /></label>
                    <label>Timezone<input value={form.timezone || ''} onChange={(e) => setField('timezone', e.target.value)} /></label>
                  </div>
                  {editor.mode === 'create' && branches.length > 0 && (
                    <label>
                      Copy menu from
                      <select value={form.copy_menu_from || ''} onChange={(e) => setField('copy_menu_from', e.target.value)}>
                        <option value="">Don’t copy</option>
                        {branches.map((b) => (
                          <option key={b.id} value={b.id}>{b.name}</option>
                        ))}
                      </select>
                    </label>
                  )}
                </>
              )}
              {editor.type === 'table' && (
                <>
                  <label>Table number<input required value={form.table_number || ''} onChange={(e) => setField('table_number', e.target.value)} /></label>
                  <label>
                    Zone
                    <select value={form.zone || 'Indoor'} onChange={(e) => setField('zone', e.target.value)}>
                      {['Indoor', 'Terrace', 'Garden', 'Bar', 'Patio'].map((z) => (
                        <option key={z} value={z}>{z}</option>
                      ))}
                    </select>
                  </label>
                  <label>Capacity<input type="number" min="1" value={form.capacity || 4} onChange={(e) => setField('capacity', Number(e.target.value))} /></label>
                </>
              )}
              {editor.type === 'menu' && (
                <>
                  <label>Product name<input required value={form.name || ''} onChange={(e) => setField('name', e.target.value)} /></label>
                  <label>
                    Category
                    <input list="menu-cats" value={form.category || ''} onChange={(e) => setField('category', e.target.value)} />
                    <datalist id="menu-cats">
                      {['Coffee', 'Food', 'Beverage', 'Bakery', 'Dessert', ...categories].map((c) => (
                        <option key={c} value={c} />
                      ))}
                    </datalist>
                  </label>
                  <div className="catalog-form-row">
                    <label>Price (EGP)<input required type="number" min="0" step="0.5" value={form.price} onChange={(e) => setField('price', e.target.value)} /></label>
                    <label>Tax rate<input type="number" min="0" max="1" step="0.01" value={form.tax_rate} onChange={(e) => setField('tax_rate', e.target.value)} /></label>
                  </div>
                  <label className="catalog-check">
                    <input type="checkbox" checked={Boolean(form.is_available)} onChange={(e) => setField('is_available', e.target.checked ? 1 : 0)} />
                    Available on POS
                  </label>
                </>
              )}
              <div className="catalog-form-actions">
                <button type="button" className="btn-hw-action" onClick={closeEditor}>Cancel</button>
                <button type="submit" className="btn-print" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
