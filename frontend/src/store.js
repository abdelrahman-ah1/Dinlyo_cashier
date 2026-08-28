import { create } from 'zustand';
import { api, EDGE_WS_URL, setActiveUser } from './api';

let reconnectTimeout = null;

const initialUser = {
  id: 'user-manager',
  name: 'Sarah Chen (Manager)',
  role: 'manager',
};
setActiveUser(initialUser);

export const useStore = create((set, get) => ({
  shopProfile: null,
  branchId: null,
  branches: [],
  currentUser: initialUser,
  users: [],
  menu: [],
  tables: [],
  orders: [],
  auditLogs: [],
  auditLogScope: 'today',
  auditLogLoading: false,
  auditLogError: null,
  inventory: [],
  inventoryLoading: false,
  lowStockAlerts: [],
  hardwareJobs: [],
  drawerKickCount: 0,
  eodReport: null,
  eodLoading: false,
  wsConnected: false,
  ws: null,
  lastNewOrderArrival: null,
  syncStatus: {
    wanOnline: true,
    isSyncing: false,
    pendingCount: 0,
    syncingCount: 0,
    syncedCount: 0,
    failedCount: 0,
    totalCount: 0,
    lastSyncedAt: null,
    recentEvents: [],
  },

  async init(role = 'pos') {
    try {
      const branches = await api.getBranches().catch(() => []);
      const preferredId = get().branchId || branches[0]?.id;
      const shop = await api.getBranch(preferredId);
      const branch_id = shop.branch_id;
      const [menu, tables, orders, sync, users, inv] = await Promise.all([
        api.getMenu(branch_id),
        api.getTables(branch_id),
        api.getOrders(branch_id, 'active'),
        api.getSyncStatus().catch(() => null),
        api.getUsers(branch_id).catch(() => []),
        api.getInventory(branch_id).catch(() => []),
      ]);
      set({
        branchId: branch_id,
        shopProfile: shop,
        branches,
        menu,
        tables,
        orders,
        users,
        inventory: inv,
        ...(sync ? { syncStatus: sync } : {}),
      });
      get().connectWs(branch_id, role);
    } catch (err) {
      console.error('[Store] Init failed:', err);
    }
  },

  async fetchBranches() {
    const branches = await api.getBranches();
    set({ branches });
    return branches;
  },

  async switchBranch(branchId) {
    const shop = await api.getBranch(branchId);
    const [menu, tables, orders, users, inv] = await Promise.all([
      api.getMenu(branchId),
      api.getTables(branchId),
      api.getOrders(branchId, 'active'),
      api.getUsers(branchId).catch(() => []),
      api.getInventory(branchId).catch(() => []),
    ]);
    set({
      branchId,
      shopProfile: shop,
      menu,
      tables,
      orders,
      users,
      inventory: inv,
    });
    get().connectWs(branchId, 'pos');
  },

  async saveBranch(payload, id = null) {
    const saved = id ? await api.updateBranch(id, payload) : await api.createBranch(payload);
    await get().fetchBranches();
    if (get().branchId === saved.id) {
      const shop = await api.getBranch(saved.id);
      set({ shopProfile: shop });
    }
    return saved;
  },

  async removeBranch(id) {
    await api.deleteBranch(id);
    const branches = await get().fetchBranches();
    if (get().branchId === id) {
      const next = branches[0]?.id;
      if (next) await get().switchBranch(next);
    }
  },

  async saveTable(payload, id = null) {
    const saved = id ? await api.updateTable(id, payload) : await api.createTable(payload);
    const branchId = saved.branch_id || get().branchId;
    if (branchId === get().branchId) {
      const tables = await api.getTables(branchId);
      set({ tables });
    }
    await get().fetchBranches();
    return saved;
  },

  async removeTable(id) {
    await api.deleteTable(id);
    const tables = await api.getTables(get().branchId);
    set({ tables });
    await get().fetchBranches();
  },

  async saveMenuItem(payload, id = null) {
    const saved = id ? await api.updateMenuItem(id, payload) : await api.createMenuItem(payload);
    const branchId = saved.branch_id || get().branchId;
    if (branchId === get().branchId) {
      const menu = await api.getMenu(branchId);
      set({ menu });
    }
    await get().fetchBranches();
    return saved;
  },

  async removeMenuItem(id) {
    await api.deleteMenuItem(id);
    const menu = await api.getMenu(get().branchId);
    set({ menu });
    await get().fetchBranches();
  },

  connectWs(branchId, role = 'pos') {
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout);
      reconnectTimeout = null;
    }

    const prevWs = get().ws;
    if (prevWs) {
      prevWs.onopen = null;
      prevWs.onclose = null;
      prevWs.onerror = null;
      prevWs.onmessage = null;
      prevWs.close();
    }

    const ws = new WebSocket(`${EDGE_WS_URL}?branch_id=${branchId}&role=${role}`);

    ws.onopen = async () => {
      set({ wsConnected: true });
      // FR-4.3: State resync on reconnect (fetch current active orders)
      try {
        const activeOrders = await api.getOrders(branchId, 'active');
        const tables = await api.getTables(branchId);
        set({ orders: activeOrders, tables });
      } catch (err) {
        console.warn('[WS] Reconnect resync error:', err);
      }
    };

    ws.onclose = () => {
      set({ wsConnected: false });
      if (get().branchId) {
        reconnectTimeout = setTimeout(() => {
          get().connectWs(branchId, role);
        }, 2000);
      }
    };

    ws.onerror = () => {
      set({ wsConnected: false });
    };

    ws.onmessage = (msg) => {
      try {
        const event = JSON.parse(msg.data);
        if (event.type === 'sync.status') {
          set({ syncStatus: event.sync });
        } else if (event.type === 'inventory.updated') {
          get().fetchInventory();
        } else if (event.type === 'inventory.low_stock_alert') {
          set((s) => ({ lowStockAlerts: [event.alert, ...s.lowStockAlerts].slice(0, 10) }));
        } else if (event.type === 'hardware.print_spooled') {
          set((s) => ({ hardwareJobs: [event.job, ...s.hardwareJobs].slice(0, 30) }));
        } else if (event.type === 'hardware.drawer_kicked') {
          set((s) => ({ drawerKickCount: s.drawerKickCount + 1, hardwareJobs: [event.event, ...s.hardwareJobs].slice(0, 30) }));
        } else {
          if (event.type === 'order.created') {
            set({ lastNewOrderArrival: Date.now() });
          }
          get().applyEvent(event);
        }
      } catch (e) {
        console.error('[WS] Parse error:', e);
      }
    };

    set({ ws });
  },

  applyEvent(event) {
    if (!event.order) return;
    set((state) => {
      const orders = [...state.orders];
      const idx = orders.findIndex((o) => o.id === event.order.id);

      if (event.order.status === 'open') {
        if (idx >= 0) orders[idx] = event.order;
        else orders.unshift(event.order);
      } else {
        if (idx >= 0) orders.splice(idx, 1);
      }

      const tables = state.tables.map((t) =>
        t.id === event.order.table_id
          ? { ...t, status: event.order.status === 'paid' ? 'dirty' : 'occupied' }
          : t
      );

      return { orders, tables };
    });
  },

  async placeOrder({ tableId, orderType, items }) {
    const branchId = get().branchId;
    const order = await api.createOrder({
      branch_id: branchId,
      table_id: tableId,
      order_type: orderType,
      items,
    });
    get().applyEvent({ order });
    get().fetchInventory();
    return order;
  },

  async setItemStatus(orderId, itemId, status) {
    const order = await api.updateItemStatus(orderId, itemId, status);
    get().applyEvent({ order });
  },

  async payOrder(orderId, amount, method = 'cash', extras = {}) {
    const payment = await api.processPayment({
      order_id: orderId,
      amount,
      method,
      cash_tendered: extras.cash_tendered,
      card_last4: extras.card_last4,
      approval_code: extras.approval_code,
      idempotency_key: `pay_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    });
    // Order is marked paid
    const updatedOrders = get().orders.filter(o => o.id !== orderId);
    set({ orders: updatedOrders });
    return payment;
  },

  async markOrderPaid(orderId) {
    const order = await api.updateOrderStatus(orderId, 'paid');
    get().applyEvent({ order });
  },

  async fetchInventory() {
    if (!get().branchId) return;
    set({ inventoryLoading: true });
    try {
      const inv = await api.getInventory(get().branchId);
      set({ inventory: inv, inventoryLoading: false });
    } catch (e) {
      set({ inventoryLoading: false });
    }
  },

  async updateInventoryStock(itemId, stockQty) {
    await api.updateStock(itemId, stockQty);
    await get().fetchInventory();
  },

  async fetchEODReport(date = null) {
    if (!get().branchId) return;
    set({ eodLoading: true });
    try {
      const report = await api.getEODReport(get().branchId, date);
      set({ eodReport: report, eodLoading: false });
    } catch (e) {
      set({ eodLoading: false });
    }
  },

  async fetchHardwareStatus() {
    try {
      const hw = await api.getHardwareStatus();
      set({ hardwareJobs: hw.recentJobs || [], drawerKickCount: hw.drawerKickCount || 0 });
    } catch (e) {}
  },

  async kickDrawer() {
    const res = await api.kickDrawer();
    set((s) => ({ drawerKickCount: s.drawerKickCount + 1, hardwareJobs: [res, ...s.hardwareJobs].slice(0, 30) }));
  },

  async printTestReceipt(type = 'RECEIPT') {
    const job = await api.printTest(type);
    set((s) => ({ hardwareJobs: [job, ...s.hardwareJobs].slice(0, 30) }));
  },

  async toggleWan(online) {
    const updated = await api.simulateWan(online);
    set({ syncStatus: updated });
  },

  async triggerReplay() {
    const updated = await api.triggerReplay();
    set({ syncStatus: updated });
  },

  async loginWithPin(pin) {
    const res = await api.loginPin(pin);
    setActiveUser(res.user);
    set({ currentUser: res.user });
    return res.user;
  },

  setUser(user) {
    setActiveUser(user);
    set({ currentUser: user });
  },

  async fetchAuditLogs(scope = 'today') {
    set({ auditLogLoading: true, auditLogError: null, auditLogScope: scope });
    try {
      const data = await api.getAuditLogs(scope);
      set({ auditLogs: data.logs || [], auditLogLoading: false });
    } catch (err) {
      set({ auditLogError: err.message, auditLogs: [], auditLogLoading: false });
    }
  },
}));
