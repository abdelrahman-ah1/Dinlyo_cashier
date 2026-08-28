import Fastify from 'fastify';
import cors from '@fastify/cors';
import { WebSocketServer } from 'ws';
import { nanoid } from 'nanoid';
import { initDb, getDb, DEMO_BRANCH_ID, recordOutboxEvent, recordAuditLog, getShopProfile } from './db.js';
import { syncEngine } from './sync.js';
import { authenticatePin, extractUserFromRequest } from './auth.js';
import { hardwareBridge } from './hardware.js';
import { inventoryEngine } from './inventory.js';

const PORT = process.env.PORT || 4000;
const fastify = Fastify({ logger: false });
await fastify.register(cors, { origin: true });

// Initialize MongoDB / Document Store
await initDb();

// ---------------------------------------------------------------------------
// LOCAL WEBSOCKET HUB (Edge Server role)
// ---------------------------------------------------------------------------
const clients = new Set(); // { ws, role, branchId }

function broadcast(branchId, event) {
  const payload = JSON.stringify(event);
  for (const client of clients) {
    if (client.branchId === branchId && client.ws.readyState === 1) {
      client.ws.send(payload);
    }
  }
}

// Hook up sync engine status notifications to the local WebSocket broadcast
syncEngine.setBroadcastCallback((event) => {
  broadcast(DEMO_BRANCH_ID, event);
});

// Hook up hardware notifications to WebSocket broadcast
hardwareBridge.setBroadcastCallback((event) => {
  broadcast(DEMO_BRANCH_ID, event);
});

// Hook up inventory notifications to WebSocket broadcast
inventoryEngine.setBroadcastCallback((event) => {
  broadcast(DEMO_BRANCH_ID, event);
});

// Helper to normalize document fields (_id and id)
function formatDoc(doc) {
  if (!doc) return null;
  const id = doc.id || (doc._id ? String(doc._id) : nanoid());
  const res = { ...doc, id, _id: id };
  if (Array.isArray(res.items)) {
    res.items = res.items.map(it => ({
      ...it,
      id: it.id || (it._id ? String(it._id) : nanoid()),
      _id: it.id || (it._id ? String(it._id) : nanoid()),
    }));
  }
  return res;
}

async function requireManager(req, reply) {
  const user = await extractUserFromRequest(req);
  if (user.role !== 'manager') {
    reply.code(403).send({ error: 'Forbidden: Only General Managers can add or edit catalog data.' });
    return null;
  }
  return user;
}

function byId(id) {
  return { $or: [{ id }, { _id: id }] };
}

// ---------------------------------------------------------------------------
// AUTH & RBAC ENDPOINTS
// ---------------------------------------------------------------------------

fastify.post('/api/auth/login-pin', async (req, reply) => {
  const { pin } = req.body || {};
  const user = await authenticatePin(pin);
  if (!user) {
    return reply.code(401).send({ error: 'Invalid PIN. Access denied.' });
  }

  await recordAuditLog({
    branchId: user.branch_id || DEMO_BRANCH_ID,
    user,
    action: 'USER_LOGIN',
    entityType: 'users',
    entityId: user.id,
    details: { name: user.name, role: user.role },
  });

  return { user };
});

fastify.get('/api/auth/users', async (req) => {
  const branchId = req.query.branch_id || DEMO_BRANCH_ID;
  const db = getDb();
  const users = await db.collection('users')
    .find({ branch_id: branchId, is_active: 1 })
    .toArray();

  return (users || []).map(u => ({
    id: u.id || String(u._id),
    _id: u.id || String(u._id),
    name: u.name,
    role: u.role,
    branch_id: u.branch_id,
    is_active: u.is_active,
  }));
});

// ---------------------------------------------------------------------------
// AUDIT LOGS ENDPOINT (Role Scoped: Manager = Full, Shift Manager = Today, Cashier = Forbidden)
// ---------------------------------------------------------------------------

fastify.get('/api/audit-logs', async (req, reply) => {
  const user = await extractUserFromRequest(req);
  const branchId = req.query.branch_id || DEMO_BRANCH_ID;
  const db = getDb();

  if (user.role === 'cashier') {
    return reply.code(403).send({
      error: 'Forbidden: Cashiers do not have permission to view audit logs.',
      requiredRole: 'shift_manager',
    });
  }

  const todayIso = new Date().toISOString().split('T')[0];

  if (user.role === 'shift_manager') {
    // Shift Managers only see today's audit logs
    const allLogs = await db.collection('audit_logs')
      .find({ branch_id: branchId })
      .sort({ created_at: -1 })
      .limit(100)
      .toArray();

    const todayLogs = (allLogs || [])
      .filter(l => (l.created_at || '').startsWith(todayIso))
      .map(formatDoc);

    return { scope: 'today', role: 'shift_manager', count: todayLogs.length, logs: todayLogs };
  }

  // Managers have full access across all history
  const scope = req.query.scope || 'all';
  const allLogs = await db.collection('audit_logs')
    .find({ branch_id: branchId })
    .sort({ created_at: -1 })
    .limit(200)
    .toArray();

  let logs = (allLogs || []).map(formatDoc);
  if (scope === 'today') {
    logs = logs.filter(l => (l.created_at || '').startsWith(todayIso));
  }

  return { scope, role: 'manager', count: logs.length, logs };
});

// ---------------------------------------------------------------------------
// REST API (order + menu + table management)
// ---------------------------------------------------------------------------

fastify.get('/api/menu', async (req) => {
  const branchId = req.query.branch_id || DEMO_BRANCH_ID;
  const includeUnavailable = req.query.include_unavailable === '1' || req.query.include_unavailable === 'true';
  const db = getDb();
  const query = { branch_id: branchId };
  if (!includeUnavailable) query.is_available = 1;
  const items = await db.collection('menu_items')
    .find(query)
    .sort({ category: 1, name: 1 })
    .toArray();

  return (items || []).map(formatDoc);
});

fastify.get('/api/tables', async (req) => {
  const branchId = req.query.branch_id || DEMO_BRANCH_ID;
  const db = getDb();
  const tables = await db.collection('tables')
    .find({ branch_id: branchId })
    .sort({ zone: 1, table_number: 1 })
    .toArray();

  return (tables || []).map(formatDoc);
});

fastify.get('/api/branches', async () => {
  const db = getDb();
  const branches = await db.collection('branches').find({}).toArray();
  const tables = await db.collection('tables').find({}).toArray();
  const menu = await db.collection('menu_items').find({}).toArray();
  return (branches || [])
    .map((b) => {
      const id = b.id || b._id;
      return formatDoc({
        ...b,
        tableCount: tables.filter((t) => t.branch_id === id).length,
        menuCount: menu.filter((m) => m.branch_id === id && m.is_available !== 0).length,
      });
    })
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
});

fastify.post('/api/branches', async (req, reply) => {
  const user = await requireManager(req, reply);
  if (!user) return;
  const {
    name,
    receipt_name,
    address = '',
    phone = '',
    currency = 'EGP',
    timezone = 'Africa/Cairo',
    copy_menu_from = null,
  } = req.body || {};
  if (!name || !String(name).trim()) {
    return reply.code(400).send({ error: 'Branch name is required' });
  }

  const db = getDb();
  const id = nanoid();
  const doc = {
    _id: id,
    id,
    tenant_id: (await db.collection('tenants').findOne({}))?.id || 'demo-tenant',
    name: String(name).trim(),
    receipt_name: String(receipt_name || name).trim(),
    address: String(address).trim(),
    phone: String(phone).trim(),
    currency: String(currency || 'EGP').trim(),
    timezone: String(timezone || 'Africa/Cairo').trim(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  await db.collection('branches').insertOne(doc);

  if (copy_menu_from) {
    const sourceItems = await db.collection('menu_items').find({ branch_id: copy_menu_from }).toArray();
    if (sourceItems.length) {
      await db.collection('menu_items').insertMany(sourceItems.map((item) => {
        const itemId = nanoid();
        return {
          _id: itemId,
          id: itemId,
          branch_id: id,
          name: item.name,
          category: item.category,
          price: item.price,
          tax_rate: item.tax_rate ?? 0.14,
          is_available: item.is_available ?? 1,
        };
      }));
    }
  }

  await recordAuditLog({
    branchId: id,
    user,
    action: 'BRANCH_CREATED',
    entityType: 'branches',
    entityId: id,
    details: { name: doc.name, copy_menu_from },
  });
  return formatDoc(doc);
});

fastify.patch('/api/branches/:id', async (req, reply) => {
  const user = await requireManager(req, reply);
  if (!user) return;
  const { id } = req.params;
  const db = getDb();
  const existing = await db.collection('branches').findOne(byId(id));
  if (!existing) return reply.code(404).send({ error: 'Branch not found' });

  const allowed = ['name', 'receipt_name', 'address', 'phone', 'currency', 'timezone'];
  const $set = { updated_at: new Date().toISOString() };
  for (const key of allowed) {
    if (req.body?.[key] != null) $set[key] = String(req.body[key]).trim();
  }
  if ($set.name === '') return reply.code(400).send({ error: 'Branch name is required' });

  await db.collection('branches').updateOne(byId(id), { $set });
  const updated = await db.collection('branches').findOne(byId(id));
  await recordAuditLog({
    branchId: id,
    user,
    action: 'BRANCH_UPDATED',
    entityType: 'branches',
    entityId: id,
    details: $set,
  });
  return formatDoc(updated);
});

fastify.delete('/api/branches/:id', async (req, reply) => {
  const user = await requireManager(req, reply);
  if (!user) return;
  const { id } = req.params;
  const db = getDb();
  const branches = await db.collection('branches').find({}).toArray();
  if ((branches || []).length <= 1) {
    return reply.code(400).send({ error: 'Cannot delete the last remaining branch' });
  }
  const existing = await db.collection('branches').findOne(byId(id));
  if (!existing) return reply.code(404).send({ error: 'Branch not found' });

  await db.collection('branches').deleteOne(byId(id));
  await db.collection('tables').deleteMany({ branch_id: id });
  await db.collection('menu_items').deleteMany({ branch_id: id });
  await recordAuditLog({
    branchId: id,
    user,
    action: 'BRANCH_DELETED',
    entityType: 'branches',
    entityId: id,
    details: { name: existing.name },
  });
  return { ok: true, id };
});

fastify.post('/api/tables', async (req, reply) => {
  const user = await requireManager(req, reply);
  if (!user) return;
  const { branch_id = DEMO_BRANCH_ID, table_number, zone = 'Indoor', capacity = 4 } = req.body || {};
  if (!table_number || !String(table_number).trim()) {
    return reply.code(400).send({ error: 'Table number is required' });
  }
  const db = getDb();
  const dup = await db.collection('tables').findOne({
    branch_id,
    table_number: String(table_number).trim(),
  });
  if (dup) return reply.code(409).send({ error: 'A table with that number already exists in this branch' });

  const id = nanoid();
  const doc = {
    _id: id,
    id,
    branch_id,
    table_number: String(table_number).trim(),
    zone: String(zone || 'Indoor').trim(),
    capacity: Number(capacity) || 4,
    status: 'available',
  };
  await db.collection('tables').insertOne(doc);
  await recordAuditLog({
    branchId: branch_id,
    user,
    action: 'TABLE_CREATED',
    entityType: 'tables',
    entityId: id,
    details: { table_number: doc.table_number, zone: doc.zone },
  });
  return formatDoc(doc);
});

fastify.patch('/api/tables/:id', async (req, reply) => {
  const user = await requireManager(req, reply);
  if (!user) return;
  const { id } = req.params;
  const db = getDb();
  const existing = await db.collection('tables').findOne(byId(id));
  if (!existing) return reply.code(404).send({ error: 'Table not found' });

  const $set = {};
  if (req.body?.table_number != null) $set.table_number = String(req.body.table_number).trim();
  if (req.body?.zone != null) $set.zone = String(req.body.zone).trim();
  if (req.body?.capacity != null) $set.capacity = Number(req.body.capacity) || existing.capacity;
  if (req.body?.status != null) $set.status = String(req.body.status).trim();
  if ($set.table_number === '') return reply.code(400).send({ error: 'Table number is required' });

  if ($set.table_number) {
    const dup = await db.collection('tables').findOne({
      branch_id: existing.branch_id,
      table_number: $set.table_number,
    });
    if (dup && (dup.id || dup._id) !== (existing.id || existing._id)) {
      return reply.code(409).send({ error: 'A table with that number already exists in this branch' });
    }
  }

  await db.collection('tables').updateOne(byId(id), { $set });
  const updated = await db.collection('tables').findOne(byId(id));
  await recordAuditLog({
    branchId: existing.branch_id,
    user,
    action: 'TABLE_UPDATED',
    entityType: 'tables',
    entityId: id,
    details: $set,
  });
  return formatDoc(updated);
});

fastify.delete('/api/tables/:id', async (req, reply) => {
  const user = await requireManager(req, reply);
  if (!user) return;
  const { id } = req.params;
  const db = getDb();
  const existing = await db.collection('tables').findOne(byId(id));
  if (!existing) return reply.code(404).send({ error: 'Table not found' });
  const open = await db.collection('orders').findOne({ table_id: id, status: 'open' });
  if (open) return reply.code(400).send({ error: 'Cannot delete a table with an open order' });

  await db.collection('tables').deleteOne(byId(id));
  await recordAuditLog({
    branchId: existing.branch_id,
    user,
    action: 'TABLE_DELETED',
    entityType: 'tables',
    entityId: id,
    details: { table_number: existing.table_number },
  });
  return { ok: true, id };
});

fastify.post('/api/menu', async (req, reply) => {
  const user = await requireManager(req, reply);
  if (!user) return;
  const {
    branch_id = DEMO_BRANCH_ID,
    name,
    category = 'Food',
    price,
    tax_rate = 0.14,
    is_available = 1,
  } = req.body || {};
  if (!name || !String(name).trim()) return reply.code(400).send({ error: 'Product name is required' });
  if (price == null || Number(price) < 0) return reply.code(400).send({ error: 'A valid price is required' });

  const db = getDb();
  const id = nanoid();
  const doc = {
    _id: id,
    id,
    branch_id,
    name: String(name).trim(),
    category: String(category || 'Food').trim(),
    price: Number(price),
    tax_rate: Number(tax_rate) || 0.14,
    is_available: is_available ? 1 : 0,
  };
  await db.collection('menu_items').insertOne(doc);
  await recordAuditLog({
    branchId: branch_id,
    user,
    action: 'MENU_ITEM_CREATED',
    entityType: 'menu_items',
    entityId: id,
    details: { name: doc.name, price: doc.price },
  });
  return formatDoc(doc);
});

fastify.patch('/api/menu/:id', async (req, reply) => {
  const user = await requireManager(req, reply);
  if (!user) return;
  const { id } = req.params;
  const db = getDb();
  const existing = await db.collection('menu_items').findOne(byId(id));
  if (!existing) return reply.code(404).send({ error: 'Menu item not found' });

  const $set = {};
  if (req.body?.name != null) $set.name = String(req.body.name).trim();
  if (req.body?.category != null) $set.category = String(req.body.category).trim();
  if (req.body?.price != null) $set.price = Number(req.body.price);
  if (req.body?.tax_rate != null) $set.tax_rate = Number(req.body.tax_rate);
  if (req.body?.is_available != null) $set.is_available = req.body.is_available ? 1 : 0;
  if ($set.name === '') return reply.code(400).send({ error: 'Product name is required' });
  if ($set.price != null && $set.price < 0) return reply.code(400).send({ error: 'A valid price is required' });

  await db.collection('menu_items').updateOne(byId(id), { $set });
  const updated = await db.collection('menu_items').findOne(byId(id));
  await recordAuditLog({
    branchId: existing.branch_id,
    user,
    action: 'MENU_ITEM_UPDATED',
    entityType: 'menu_items',
    entityId: id,
    details: $set,
  });
  return formatDoc(updated);
});

fastify.delete('/api/menu/:id', async (req, reply) => {
  const user = await requireManager(req, reply);
  if (!user) return;
  const { id } = req.params;
  const db = getDb();
  const existing = await db.collection('menu_items').findOne(byId(id));
  if (!existing) return reply.code(404).send({ error: 'Menu item not found' });
  await db.collection('menu_items').deleteOne(byId(id));
  await recordAuditLog({
    branchId: existing.branch_id,
    user,
    action: 'MENU_ITEM_DELETED',
    entityType: 'menu_items',
    entityId: id,
    details: { name: existing.name },
  });
  return { ok: true, id };
});

fastify.get('/api/orders', async (req) => {
  const branchId = req.query.branch_id || DEMO_BRANCH_ID;
  const status = req.query.status;
  const db = getDb();

  const query = { branch_id: branchId };
  if (status === 'active') {
    query.status = 'open';
  }

  const orders = await db.collection('orders')
    .find(query)
    .sort({ created_at: status === 'active' ? 1 : -1 })
    .limit(100)
    .toArray();

  return (orders || []).map(formatDoc);
});

fastify.post('/api/orders', async (req, reply) => {
  const user = await extractUserFromRequest(req);
  const { branch_id = DEMO_BRANCH_ID, table_id = null, order_type, items } = req.body;
  if (!order_type || !items?.length) {
    return reply.code(400).send({ error: 'order_type and at least one item are required' });
  }

  const db = getDb();
  const orderId = nanoid();
  let total = 0;

  const embeddedItems = [];
  for (const line of items) {
    const menuItem = await db.collection('menu_items').findOne({
      $or: [{ id: line.item_id }, { _id: line.item_id }],
    });
    if (!menuItem) continue;

    const qty = line.quantity || 1;
    const lineId = nanoid();
    total += menuItem.price * qty;

    embeddedItems.push({
      _id: lineId,
      id: lineId,
      order_id: orderId,
      item_id: menuItem.id || String(menuItem._id),
      item_name: menuItem.name,
      price: menuItem.price,
      quantity: qty,
      modifiers: line.modifiers || [],
      modifiers_json: JSON.stringify(line.modifiers || []),
      status: 'placed',
      fired_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  }

  const orderDoc = {
    _id: orderId,
    id: orderId,
    branch_id,
    table_id,
    order_type,
    status: 'open',
    total,
    version: 1,
    items: embeddedItems,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  await db.collection('orders').insertOne(orderDoc);

  if (table_id) {
    await db.collection('tables').updateOne(
      { $or: [{ id: table_id }, { _id: table_id }] },
      { $set: { status: 'occupied' } }
    );
  }

  const formattedOrder = formatDoc(orderDoc);

  // FR-5.1: Automatic Kitchen Ticket ESC/POS Print
  hardwareBridge.printKitchenTicket(formattedOrder).catch(() => {});

  // FR-6.2: Automatic Ingredient Depletion & Low-Stock Alerts
  inventoryEngine.deductIngredientsForOrder(formattedOrder, user).catch(() => {});

  // Atomically record outbox event
  await recordOutboxEvent({
    branchId: branch_id,
    eventType: 'order.created',
    entityType: 'orders',
    entityId: orderId,
    payload: formattedOrder,
  });

  // Record immutable audit log
  await recordAuditLog({
    branchId: branch_id,
    user,
    action: 'ORDER_CREATED',
    entityType: 'orders',
    entityId: orderId,
    details: {
      orderType: order_type,
      tableId: table_id,
      itemCount: items.length,
      total,
    },
  });

  broadcast(branch_id, { type: 'order.created', order: formattedOrder });
  syncEngine.replayPending().catch(() => {});

  return formattedOrder;
});

// KDS updates the status of a single ticket line (Placed -> In Prep -> Ready -> Served)
fastify.patch('/api/orders/:orderId/items/:itemId', async (req, reply) => {
  const user = await extractUserFromRequest(req);
  const { orderId, itemId } = req.params;
  const { status } = req.body;
  const valid = ['placed', 'in_prep', 'ready', 'served'];
  if (!valid.includes(status)) return reply.code(400).send({ error: 'invalid status' });

  const db = getDb();
  const orderDoc = await db.collection('orders').findOne({
    $or: [{ id: orderId }, { _id: orderId }],
  });
  if (!orderDoc) return reply.code(404).send({ error: 'Order not found' });

  // Update item in embedded array
  if (Array.isArray(orderDoc.items)) {
    const item = orderDoc.items.find(it => (it.id === itemId || it._id === itemId));
    if (item) {
      item.status = status;
      item.updated_at = new Date().toISOString();
    }
  }

  // Auto-close order if all lines are served
  const allServed = orderDoc.items.every(i => i.status === 'served');
  if (allServed && orderDoc.status === 'open') {
    orderDoc.status = 'served';
  }
  orderDoc.updated_at = new Date().toISOString();

  await db.collection('orders').updateOne(
    { $or: [{ id: orderId }, { _id: orderId }] },
    { $set: { items: orderDoc.items, status: orderDoc.status, updated_at: orderDoc.updated_at } }
  );

  const formattedOrder = formatDoc(orderDoc);

  await recordOutboxEvent({
    branchId: formattedOrder.branch_id,
    eventType: 'order_item.updated',
    entityType: 'order_items',
    entityId: itemId,
    payload: { orderId, itemId, status, order: formattedOrder },
  });

  await recordAuditLog({
    branchId: formattedOrder.branch_id,
    user,
    action: 'ITEM_STATUS_UPDATED',
    entityType: 'order_items',
    entityId: itemId,
    details: { orderId, newStatus: status },
  });

  broadcast(formattedOrder.branch_id, { type: 'order_item.updated', order: formattedOrder, itemId, status });
  syncEngine.replayPending().catch(() => {});

  return formattedOrder;
});

fastify.patch('/api/orders/:orderId', async (req, reply) => {
  const user = await extractUserFromRequest(req);
  const { orderId } = req.params;
  const { status } = req.body;

  const db = getDb();
  const orderDoc = await db.collection('orders').findOne({
    $or: [{ id: orderId }, { _id: orderId }],
  });
  if (!orderDoc) return reply.code(404).send({ error: 'Order not found' });

  orderDoc.status = status;
  orderDoc.updated_at = new Date().toISOString();

  await db.collection('orders').updateOne(
    { $or: [{ id: orderId }, { _id: orderId }] },
    { $set: { status, updated_at: orderDoc.updated_at } }
  );

  if (status === 'paid' && orderDoc.table_id) {
    await db.collection('tables').updateOne(
      { $or: [{ id: orderDoc.table_id }, { _id: orderDoc.table_id }] },
      { $set: { status: 'dirty' } }
    );
  }

  const formattedOrder = formatDoc(orderDoc);

  await recordOutboxEvent({
    branchId: formattedOrder.branch_id,
    eventType: 'order.updated',
    entityType: 'orders',
    entityId: orderId,
    payload: { order: formattedOrder, status },
  });

  await recordAuditLog({
    branchId: formattedOrder.branch_id,
    user,
    action: 'ORDER_STATUS_UPDATED',
    entityType: 'orders',
    entityId: orderId,
    details: { newStatus: status, total: formattedOrder.total },
  });

  broadcast(formattedOrder.branch_id, { type: 'order.updated', order: formattedOrder });
  syncEngine.replayPending().catch(() => {});

  return formattedOrder;
});

// ---------------------------------------------------------------------------
// PAYMENTS & IDEMPOTENCY ENGINE (NFR-8, FR-5.2, FR-5.3, FR-5.4)
// ---------------------------------------------------------------------------

fastify.post('/api/payments', async (req, reply) => {
  const user = await extractUserFromRequest(req);
  const {
    order_id,
    amount,
    method = 'cash',
    idempotency_key = nanoid(),
    cash_tendered = null,
    card_last4 = null,
    approval_code = null,
  } = req.body || {};

  if (!order_id || amount == null) {
    return reply.code(400).send({ error: 'order_id and amount are required' });
  }

  const db = getDb();
  const paymentsCol = db.collection('payments');

  // NFR-8: Idempotency Check
  const existingPayment = await paymentsCol.findOne({ idempotency_key });
  if (existingPayment) {
    console.log(`[Payment] Idempotent hit: returned existing transaction ${existingPayment.id || existingPayment._id}`);
    return formatDoc(existingPayment);
  }

  // Find order
  const orderDoc = await db.collection('orders').findOne({
    $or: [{ id: order_id }, { _id: order_id }],
  });
  if (!orderDoc) return reply.code(404).send({ error: 'Order not found' });

  const paymentId = nanoid();
  const paymentDoc = {
    _id: paymentId,
    id: paymentId,
    order_id,
    amount: Number(amount),
    method,
    status: 'completed',
    idempotency_key,
    cash_tendered: cash_tendered != null ? Number(cash_tendered) : (method === 'cash' ? Number(amount) : null),
    card_last4: card_last4 || (method === 'card' ? String(1000 + Math.abs(paymentId.split('').reduce((s, c) => s + c.charCodeAt(0), 0)) % 9000) : null),
    approval_code: approval_code || (method === 'card' ? `#${paymentId.replace(/[^a-z0-9]/gi, '').slice(0, 6).toUpperCase()}` : null),
    created_at: new Date().toISOString(),
  };

  await paymentsCol.insertOne(paymentDoc);

  // Mark order as paid
  orderDoc.status = 'paid';
  orderDoc.updated_at = new Date().toISOString();
  await db.collection('orders').updateOne(
    { _id: orderDoc._id },
    { $set: { status: 'paid', updated_at: orderDoc.updated_at } }
  );

  // Mark table dirty if dine-in
  if (orderDoc.table_id) {
    await db.collection('tables').updateOne(
      { $or: [{ id: orderDoc.table_id }, { _id: orderDoc.table_id }] },
      { $set: { status: 'dirty' } }
    );
  }

  const formattedOrder = formatDoc(orderDoc);
  const formattedPayment = formatDoc(paymentDoc);
  const shop = await getShopProfile(formattedOrder.branch_id);
  if (formattedOrder.table_id) {
    const table = await db.collection('tables').findOne({
      $or: [{ id: formattedOrder.table_id }, { _id: formattedOrder.table_id }],
    });
    if (table) formattedOrder.table_number = table.table_number;
  }

  // FR-5.2: Auto-print Customer Receipt
  hardwareBridge.printCustomerReceipt(formattedOrder, {
    ...formattedPayment,
    shop_name: shop.shopName,
    shop_address: shop.address,
    shop_phone: shop.phone,
  }).catch(() => {});

  // FR-5.3: Trigger Cash Drawer Kick on Cash Payment
  if (method === 'cash') {
    hardwareBridge.kickCashDrawer('CASH_PAYMENT').catch(() => {});
  }

  // Record outbox event & audit log
  await recordOutboxEvent({
    branchId: formattedOrder.branch_id,
    eventType: 'payment.created',
    entityType: 'payments',
    entityId: paymentId,
    payload: formattedPayment,
  });

  await recordAuditLog({
    branchId: formattedOrder.branch_id,
    user,
    action: 'PAYMENT_COMPLETED',
    entityType: 'payments',
    entityId: paymentId,
    details: { orderId: order_id, amount, method, idempotencyKey: idempotency_key },
  });

  broadcast(formattedOrder.branch_id, { type: 'order.updated', order: formattedOrder });
  broadcast(formattedOrder.branch_id, { type: 'payment.created', payment: formattedPayment, order: formattedOrder });
  syncEngine.replayPending().catch(() => {});

  return formattedPayment;
});

// ---------------------------------------------------------------------------
// HARDWARE BRIDGING & SPOOLER ENDPOINTS (Phase 3)
// ---------------------------------------------------------------------------

fastify.get('/api/hardware/status', async () => {
  return hardwareBridge.getSpoolerStatus();
});

fastify.post('/api/hardware/print-test', async (req) => {
  const { type = 'RECEIPT' } = req.body || {};
  if (type === 'KITCHEN') {
    const demoOrder = {
      id: nanoid(),
      order_type: 'dine_in',
      table_id: '1',
      created_at: new Date().toISOString(),
      items: [
        { item_name: 'Espresso', quantity: 2, price: 45, modifiers: ['Double Shot'] },
        { item_name: 'Margherita Pizza', quantity: 1, price: 190, modifiers: ['Extra Basil'] },
      ],
      total: 280,
    };
    return hardwareBridge.printKitchenTicket(demoOrder);
  } else {
    const db = getDb();
    const shop = await getShopProfile(DEMO_BRANCH_ID);
    const recent = await db.collection('orders').find({}).sort({ created_at: -1 }).limit(1).toArray();
    let orderDoc = recent[0] ? formatDoc(recent[0]) : null;
    let payment = { method: 'cash' };

    if (orderDoc) {
      const payDocs = await db.collection('payments').find({
        $or: [{ order_id: orderDoc.id }, { order_id: orderDoc._id }],
      }).sort({ created_at: -1 }).limit(1).toArray();
      if (payDocs[0]) payment = formatDoc(payDocs[0]);
      else payment.cash_tendered = Number(orderDoc.total) || 0;
      if (orderDoc.table_id) {
        const table = await db.collection('tables').findOne({
          $or: [{ id: orderDoc.table_id }, { _id: orderDoc.table_id }],
        });
        if (table) orderDoc.table_number = table.table_number;
      }
    } else {
      const menu = await db.collection('menu_items').find({ is_available: 1 }).limit(5).toArray();
      const items = (menu || []).map((m) => ({
        item_name: m.name,
        quantity: 1,
        price: m.price,
      }));
      const total = items.reduce((sum, item) => sum + Number(item.price || 0), 0);
      orderDoc = {
        id: nanoid(),
        order_type: 'dine_in',
        table_number: '1',
        items,
        total,
      };
      payment.cash_tendered = total;
    }

    return hardwareBridge.printCustomerReceipt(orderDoc, {
      ...payment,
      shop_name: shop.shopName,
      shop_address: shop.address,
      shop_phone: shop.phone,
    });
  }
});

fastify.post('/api/hardware/kick-drawer', async (req, reply) => {
  const user = await extractUserFromRequest(req);
  const event = await hardwareBridge.kickCashDrawer(`MANUAL_BY_${user.name}`);
  await recordAuditLog({
    branchId: DEMO_BRANCH_ID,
    user,
    action: 'MANUAL_DRAWER_KICK',
    entityType: 'hardware',
    details: { user: user.name },
  });
  return event;
});

// ---------------------------------------------------------------------------
// INVENTORY & RECIPES & EOD REPORT ENDPOINTS (Phase 4)
// ---------------------------------------------------------------------------

fastify.get('/api/inventory', async (req) => {
  const branchId = req.query.branch_id || DEMO_BRANCH_ID;
  return inventoryEngine.getInventory(branchId);
});

fastify.patch('/api/inventory/:id', async (req, reply) => {
  const user = await extractUserFromRequest(req);
  const { id } = req.params;
  const { stock_qty } = req.body || {};
  if (stock_qty == null) return reply.code(400).send({ error: 'stock_qty is required' });

  return inventoryEngine.updateStock(id, stock_qty, user);
});

fastify.get('/api/recipes', async (req) => {
  const branchId = req.query.branch_id || DEMO_BRANCH_ID;
  return inventoryEngine.getRecipes(branchId);
});

fastify.get('/api/reports/eod', async (req) => {
  const scope = req.query.scope || 'all';
  const branchId = scope === 'branch' ? (req.query.branch_id || DEMO_BRANCH_ID) : null;
  const date = req.query.date;
  return inventoryEngine.generateEODReport(branchId, date);
});

// ---------------------------------------------------------------------------
// QR-CODE GUEST SELF-ORDERING ENDPOINTS (FR-6.5)
// ---------------------------------------------------------------------------

fastify.get('/api/public/menu', async (req) => {
  const branchId = req.query.branch_id || DEMO_BRANCH_ID;
  const db = getDb();
  const items = await db.collection('menu_items')
    .find({ branch_id: branchId, is_available: 1 })
    .sort({ category: 1, name: 1 })
    .toArray();
  return (items || []).map(formatDoc);
});

fastify.post('/api/public/orders', async (req, reply) => {
  const { branch_id = DEMO_BRANCH_ID, table_id, items, guest_name = 'Table Guest' } = req.body || {};
  if (!table_id || !items?.length) {
    return reply.code(400).send({ error: 'table_id and items are required for table self-order' });
  }

  const guestUser = {
    id: `guest-${nanoid(6)}`,
    name: `${guest_name} (Table ${table_id})`,
    role: 'guest',
  };

  const db = getDb();
  const orderId = nanoid();
  let total = 0;

  const embeddedItems = [];
  for (const line of items) {
    const menuItem = await db.collection('menu_items').findOne({
      $or: [{ id: line.item_id }, { _id: line.item_id }],
    });
    if (!menuItem) continue;

    const qty = line.quantity || 1;
    const lineId = nanoid();
    total += menuItem.price * qty;

    embeddedItems.push({
      _id: lineId,
      id: lineId,
      order_id: orderId,
      item_id: menuItem.id || String(menuItem._id),
      item_name: menuItem.name,
      price: menuItem.price,
      quantity: qty,
      modifiers: line.modifiers || [],
      modifiers_json: JSON.stringify(line.modifiers || []),
      status: 'placed',
      fired_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  }

  const orderDoc = {
    _id: orderId,
    id: orderId,
    branch_id,
    table_id: String(table_id),
    order_type: 'dine_in',
    status: 'open',
    total,
    version: 1,
    items: embeddedItems,
    created_by: 'guest_self_order',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  await db.collection('orders').insertOne(orderDoc);

  await db.collection('tables').updateOne(
    { $or: [{ id: String(table_id) }, { _id: String(table_id) }, { table_number: String(table_id) }] },
    { $set: { status: 'occupied' } }
  );

  const formattedOrder = formatDoc(orderDoc);

  // Auto-print kitchen ticket & deduct inventory
  hardwareBridge.printKitchenTicket(formattedOrder).catch(() => {});
  inventoryEngine.deductIngredientsForOrder(formattedOrder, guestUser).catch(() => {});

  await recordOutboxEvent({
    branchId: branch_id,
    eventType: 'order.created',
    entityType: 'orders',
    entityId: orderId,
    payload: formattedOrder,
  });

  await recordAuditLog({
    branchId: branch_id,
    user: guestUser,
    action: 'GUEST_SELF_ORDER_PLACED',
    entityType: 'orders',
    entityId: orderId,
    details: { tableId: table_id, itemCount: items.length, total },
  });

  broadcast(branch_id, { type: 'order.created', order: formattedOrder });
  syncEngine.replayPending().catch(() => {});

  return formattedOrder;
});

fastify.get('/api/branch', async (req) => {
  const branchId = req.query.branch_id || DEMO_BRANCH_ID;
  const shop = await getShopProfile(branchId);
  return { branch_id: shop.branchId || branchId, ...shop };
});

// ---------------------------------------------------------------------------
// SYNC ENGINE & OUTBOX MANAGEMENT API (Restricted to Manager)
// ---------------------------------------------------------------------------
fastify.get('/api/sync/status', async () => {
  return syncEngine.getStatus();
});

fastify.post('/api/sync/simulate-wan', async (req, reply) => {
  const user = await extractUserFromRequest(req);
  if (user.role !== 'manager') {
    return reply.code(403).send({ error: 'Forbidden: Only General Managers can modify WAN network simulations.' });
  }

  const { online } = req.body || {};
  const status = await syncEngine.setWanOnline(Boolean(online));

  await recordAuditLog({
    branchId: DEMO_BRANCH_ID,
    user,
    action: 'WAN_SIMULATION_CHANGED',
    entityType: 'system',
    details: { wanOnline: Boolean(online) },
  });

  return status;
});

fastify.post('/api/sync/replay', async (req, reply) => {
  const user = await extractUserFromRequest(req);
  if (user.role !== 'manager') {
    return reply.code(403).send({ error: 'Forbidden: Only General Managers can trigger manual cloud sync replay.' });
  }
  return syncEngine.replayPending();
});

fastify.get('/api/sync/cloud-records', async () => {
  return syncEngine.getCloudRecords();
});

const address = await fastify.listen({ port: PORT, host: '0.0.0.0' });
console.log(`Edge server REST API listening on ${address}`);

// Start background replay queue worker (Phase 2 completion)
syncEngine.startWorker(3000);

// Attach the WS hub to the same HTTP server Fastify created
const wss = new WebSocketServer({ server: fastify.server, path: '/ws' });
wss.on('connection', async (ws, req) => {
  const url = new URL(req.url, 'http://localhost');
  const branchId = url.searchParams.get('branch_id') || DEMO_BRANCH_ID;
  const role = url.searchParams.get('role') || 'unknown';
  const client = { ws, role, branchId };
  clients.add(client);
  console.log(`[ws] ${role} connected (branch ${branchId}), total clients: ${clients.size}`);

  const status = await syncEngine.getStatus();
  ws.send(JSON.stringify({ type: 'sync.status', sync: status }));

  ws.on('close', () => {
    clients.delete(client);
    console.log(`[ws] ${role} disconnected, total clients: ${clients.size}`);
  });
});
