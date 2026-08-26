// Points at the local branch Edge Server (not the cloud backend). In
// production each branch's terminals resolve this via mDNS auto-discovery
// on the LAN instead of a hardcoded URL.
export const EDGE_SERVER_URL = 'http://localhost:4000';
export const EDGE_WS_URL = 'ws://localhost:4000/ws';

let currentUserSession = null;

export function setActiveUser(user) {
  currentUserSession = user;
}

export function getActiveUser() {
  return currentUserSession;
}

async function request(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(currentUserSession ? {
      'x-user-id': currentUserSession.id,
      'x-user-role': currentUserSession.role,
      'x-user-name': encodeURIComponent(currentUserSession.name),
    } : {}),
    ...(options.headers || {}),
  };

  const res = await fetch(`${EDGE_SERVER_URL}${path}`, {
    ...options,
    headers,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  return res.json();
}

export const api = {
  // Auth
  loginPin: (pin) => request('/api/auth/login-pin', { method: 'POST', body: JSON.stringify({ pin }) }),
  getUsers: (branchId) => request(`/api/auth/users?branch_id=${branchId}`),

  // Core POS & KDS
  getBranch: () => request('/api/branch'),
  getMenu: (branchId) => request(`/api/menu?branch_id=${branchId}`),
  getTables: (branchId) => request(`/api/tables?branch_id=${branchId}`),
  getOrders: (branchId, status) => request(`/api/orders?branch_id=${branchId}${status ? `&status=${status}` : ''}`),
  createOrder: (payload) => request('/api/orders', { method: 'POST', body: JSON.stringify(payload) }),
  updateItemStatus: (orderId, itemId, status) =>
    request(`/api/orders/${orderId}/items/${itemId}`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  updateOrderStatus: (orderId, status) =>
    request(`/api/orders/${orderId}`, { method: 'PATCH', body: JSON.stringify({ status }) }),

  // Payments & Idempotency (NFR-8, FR-5.2, FR-5.3)
  processPayment: (payload) => request('/api/payments', { method: 'POST', body: JSON.stringify(payload) }),

  // Hardware Bridging & Virtual Spooler (Phase 3)
  getHardwareStatus: () => request('/api/hardware/status'),
  printTest: (type = 'RECEIPT') => request('/api/hardware/print-test', { method: 'POST', body: JSON.stringify({ type }) }),
  kickDrawer: () => request('/api/hardware/kick-drawer', { method: 'POST' }),

  // Inventory & Recipes (Phase 4)
  getInventory: (branchId) => request(`/api/inventory?branch_id=${branchId}`),
  updateStock: (id, stock_qty) => request(`/api/inventory/${id}`, { method: 'PATCH', body: JSON.stringify({ stock_qty }) }),
  getRecipes: (branchId) => request(`/api/recipes?branch_id=${branchId}`),
  getEODReport: (branchId, date) => request(`/api/reports/eod?branch_id=${branchId}${date ? `&date=${date}` : ''}`),

  // Public QR Guest Self-Order (FR-6.5)
  getPublicMenu: (branchId) => request(`/api/public/menu?branch_id=${branchId}`),
  createPublicOrder: (payload) => request('/api/public/orders', { method: 'POST', body: JSON.stringify(payload) }),

  // Audit Logs (RBAC Scoped)
  getAuditLogs: (scope = 'today') => request(`/api/audit-logs?scope=${scope}`),

  // Cloud Sync
  getSyncStatus: () => request('/api/sync/status'),
  simulateWan: (online) => request('/api/sync/simulate-wan', { method: 'POST', body: JSON.stringify({ online }) }),
  triggerReplay: () => request('/api/sync/replay', { method: 'POST' }),
  getCloudRecords: () => request('/api/sync/cloud-records'),
};
