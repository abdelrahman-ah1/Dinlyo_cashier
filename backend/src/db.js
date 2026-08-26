import { MongoClient } from 'mongodb';
import { nanoid } from 'nanoid';
import 'dotenv/config';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/pos_kds_db';
const DB_NAME = process.env.DB_NAME || 'pos_kds_db';

let client = null;
let db = null;
let isInMemoryFallback = false;

class InMemoryCursor {
  constructor(docs) {
    this._docs = [...docs];
  }

  sort(sortObj = {}) {
    const [field, dir] = Object.entries(sortObj)[0] || [];
    if (field) {
      this._docs.sort((a, b) => {
        const valA = a[field] ?? '';
        const valB = b[field] ?? '';
        return dir === -1 ? (valB > valA ? 1 : -1) : (valA > valB ? 1 : -1);
      });
    }
    return this;
  }

  limit(n) {
    this._docs = this._docs.slice(0, n);
    return this;
  }

  async toArray() {
    return [...this._docs];
  }
}

// Embedded In-Memory MongoDB-compatible collection for zero-setup local dev fallback
class InMemoryCollection {
  constructor(name) {
    this.name = name;
    this.docs = [];
  }

  async createIndex() {
    return true;
  }

  async countDocuments(query = {}) {
    return this.docs.filter(doc => this._match(doc, query)).length;
  }

  find(query = {}) {
    const results = this.docs.filter(doc => this._match(doc, query));
    return new InMemoryCursor(results);
  }

  async findOne(query = {}) {
    return this.docs.find(doc => this._match(doc, query)) || null;
  }

  async insertOne(doc) {
    const newDoc = { ...doc, _id: doc._id || doc.id || nanoid() };
    if (!newDoc.id) newDoc.id = newDoc._id;
    this.docs.push(newDoc);
    return { insertedId: newDoc._id, acknowledged: true };
  }


  async insertMany(docs) {
    for (const doc of docs) {
      await this.insertOne(doc);
    }
    return { acknowledged: true, insertedCount: docs.length };
  }

  async updateOne(filter, update) {
    const doc = await this.findOne(filter);
    if (!doc) return { matchedCount: 0, modifiedCount: 0 };

    if (update.$set) {
      for (const [key, value] of Object.entries(update.$set)) {
        if (key.includes('.')) {
          // Handle positional/nested update like "items.$.status" or "items.0.status"
          const parts = key.split('.');
          if (parts[0] === 'items' && parts[1] === '$') {
            const itemField = parts[2];
            const filterItemId = filter['items._id'] || filter['items.id'];
            if (Array.isArray(doc.items)) {
              const item = doc.items.find(it => (it._id === filterItemId || it.id === filterItemId));
              if (item) item[itemField] = value;
            }
          } else {
            doc[key] = value;
          }
        } else {
          doc[key] = value;
        }
      }
    }
    if (update.$inc) {
      for (const [key, delta] of Object.entries(update.$inc)) {
        doc[key] = (doc[key] || 0) + delta;
      }
    }
    return { matchedCount: 1, modifiedCount: 1 };
  }

  async updateMany(filter, update) {
    let modifiedCount = 0;
    const matches = this.docs.filter(d => this._match(d, filter));
    for (const doc of matches) {
      await this.updateOne({ _id: doc._id }, update);
      modifiedCount++;
    }
    return { matchedCount: matches.length, modifiedCount };
  }

  _match(doc, query) {
    for (const [k, v] of Object.entries(query)) {
      if (k === '$or' && Array.isArray(v)) {
        if (!v.some(sub => this._match(doc, sub))) return false;
      } else if (k === 'status' && typeof v === 'object' && v.$in) {
        if (!v.$in.includes(doc.status)) return false;
      } else if (k === 'created_at' && typeof v === 'object' && v.$gte) {
        if ((doc.created_at || '') < v.$gte) return false;
      } else if (k === 'items._id' || k === 'items.id') {
        if (!Array.isArray(doc.items) || !doc.items.some(i => i._id === v || i.id === v)) return false;
      } else {
        if (doc[k] !== v && doc[k === 'id' ? '_id' : k === '_id' ? 'id' : k] !== v) return false;
      }
    }
    return true;
  }
}

class InMemoryDb {
  constructor() {
    this.collections = new Map();
  }
  collection(name) {
    if (!this.collections.has(name)) {
      this.collections.set(name, new InMemoryCollection(name));
    }
    return this.collections.get(name);
  }
}

export let DEMO_BRANCH_ID = 'fm6KpZukOWDAhzvZHgvfe';

export async function initDb() {
  if (db) return db;

  try {
    console.log(`[MongoDB] Attempting connection to ${MONGODB_URI}...`);
    client = new MongoClient(MONGODB_URI, {
      serverSelectionTimeoutMS: 2000,
      connectTimeoutMS: 2000,
    });
    await client.connect();
    db = client.db(DB_NAME);
    console.log(`[MongoDB] Connected successfully to database: ${DB_NAME}`);
  } catch (err) {
    console.warn(`[MongoDB] Direct connection failed (${err.message}). Using zero-setup In-Memory Document Store.`);
    db = new InMemoryDb();
    isInMemoryFallback = true;
  }

  await setupCollectionsAndSeed();
  return db;
}

export function getDb() {
  if (!db) {
    throw new Error('Database not initialized. Call initDb() first.');
  }
  return db;
}

async function setupCollectionsAndSeed() {
  const tenantsCol = db.collection('tenants');
  const branchesCol = db.collection('branches');
  const tablesCol = db.collection('tables');
  const menuCol = db.collection('menu_items');
  const usersCol = db.collection('users');
  const ordersCol = db.collection('orders');
  const paymentsCol = db.collection('payments');
  const inventoryCol = db.collection('inventory_items');
  const recipesCol = db.collection('recipe_items');
  const outboxCol = db.collection('outbox_events');
  const auditCol = db.collection('audit_logs');

  // Setup Indexes
  await ordersCol.createIndex({ branch_id: 1, status: 1, created_at: -1 });
  await tablesCol.createIndex({ branch_id: 1, table_number: 1 });
  await menuCol.createIndex({ branch_id: 1, category: 1 });
  await usersCol.createIndex({ branch_id: 1, pin: 1 });
  await paymentsCol.createIndex({ idempotency_key: 1 }, { unique: true, sparse: true });
  await inventoryCol.createIndex({ branch_id: 1, name: 1 });
  await recipesCol.createIndex({ menu_item_id: 1 });
  await outboxCol.createIndex({ branch_id: 1, status: 1, created_at: 1 });
  await auditCol.createIndex({ branch_id: 1, created_at: -1 });

  // Seed default data if empty
  const tenantCount = await tenantsCol.countDocuments();
  if (tenantCount === 0) {
    const tenantId = nanoid();
    const branchId = nanoid();
    DEMO_BRANCH_ID = branchId;

    await tenantsCol.insertOne({
      _id: tenantId,
      id: tenantId,
      name: 'Demo Restaurant Group',
      subscription_tier: 'enterprise',
      created_at: new Date().toISOString(),
    });

    await branchesCol.insertOne({
      _id: branchId,
      id: branchId,
      tenant_id: tenantId,
      name: 'Downtown Branch',
      currency: 'EGP',
      timezone: 'Africa/Cairo',
      created_at: new Date().toISOString(),
    });

    const zones = ['Indoor', 'Indoor', 'Indoor', 'Terrace', 'Terrace', 'Bar'];
    const tables = zones.map((zone, i) => {
      const id = nanoid();
      return {
        _id: id,
        id,
        branch_id: branchId,
        table_number: String(i + 1),
        zone,
        capacity: i < 4 ? 4 : 2,
        status: 'available',
      };
    });
    await tablesCol.insertMany(tables);

    const menuData = [
      ['Espresso', 'Coffee', 45],
      ['Cappuccino', 'Coffee', 60],
      ['Iced Latte', 'Coffee', 65],
      ['Croissant', 'Bakery', 55],
      ['Club Sandwich', 'Food', 140],
      ['Margherita Pizza', 'Food', 190],
      ['Caesar Salad', 'Food', 120],
      ['Cheesecake', 'Dessert', 85],
      ['Fresh Orange Juice', 'Beverage', 50],
      ['Sparkling Water', 'Beverage', 30],
    ];
    const menuMap = new Map();
    const menuItems = menuData.map(([name, category, price]) => {
      const id = nanoid();
      menuMap.set(name, id);
      return {
        _id: id,
        id,
        branch_id: branchId,
        name,
        category,
        price,
        tax_rate: 0.14,
        is_available: 1,
      };
    });
    await menuCol.insertMany(menuItems);

    const users = [
      { _id: nanoid(), id: nanoid(), branch_id: branchId, name: 'Sarah Chen (Manager)', pin: '1234', role: 'manager', is_active: 1 },
      { _id: nanoid(), id: nanoid(), branch_id: branchId, name: 'Ahmed Hassan (Shift Lead)', pin: '5678', role: 'shift_manager', is_active: 1 },
      { _id: nanoid(), id: nanoid(), branch_id: branchId, name: 'Omar Tarek (Cashier)', pin: '0000', role: 'cashier', is_active: 1 },
    ];
    await usersCol.insertMany(users);

    // Phase 4: Seed Inventory Items
    const rawIngredients = [
      { name: 'Espresso Coffee Beans', category: 'Coffee', unit: 'g', stock_qty: 5000, reorder_level: 1000, cost_per_unit: 0.8 },
      { name: 'Fresh Whole Milk', category: 'Dairy', unit: 'ml', stock_qty: 12000, reorder_level: 2500, cost_per_unit: 0.05 },
      { name: 'Pizza Dough Ball', category: 'Bakery', unit: 'pcs', stock_qty: 60, reorder_level: 15, cost_per_unit: 15 },
      { name: 'Mozzarella Cheese', category: 'Dairy', unit: 'g', stock_qty: 4500, reorder_level: 1000, cost_per_unit: 0.28 },
      { name: 'Pizza Tomato Sauce', category: 'Pantry', unit: 'g', stock_qty: 3500, reorder_level: 800, cost_per_unit: 0.12 },
      { name: 'Butter Croissant Dough', category: 'Bakery', unit: 'pcs', stock_qty: 35, reorder_level: 10, cost_per_unit: 20 },
      { name: 'Fresh Oranges', category: 'Produce', unit: 'g', stock_qty: 9000, reorder_level: 2000, cost_per_unit: 0.04 },
      { name: 'Sparkling Water 330ml', category: 'Beverage', unit: 'pcs', stock_qty: 48, reorder_level: 12, cost_per_unit: 12 },
    ];
    const ingMap = new Map();
    const inventoryDocs = rawIngredients.map((item) => {
      const id = nanoid();
      ingMap.set(item.name, id);
      return {
        _id: id,
        id,
        branch_id: branchId,
        ...item,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
    });
    await inventoryCol.insertMany(inventoryDocs);

    // Phase 4: Seed Recipes linking Menu Items to Ingredients
    const recipeDefinitions = [
      { menuName: 'Espresso', ingredients: [{ ingName: 'Espresso Coffee Beans', qty: 18 }] },
      { menuName: 'Cappuccino', ingredients: [{ ingName: 'Espresso Coffee Beans', qty: 18 }, { ingName: 'Fresh Whole Milk', qty: 150 }] },
      { menuName: 'Iced Latte', ingredients: [{ ingName: 'Espresso Coffee Beans', qty: 18 }, { ingName: 'Fresh Whole Milk', qty: 200 }] },
      { menuName: 'Croissant', ingredients: [{ ingName: 'Butter Croissant Dough', qty: 1 }] },
      { menuName: 'Margherita Pizza', ingredients: [{ ingName: 'Pizza Dough Ball', qty: 1 }, { ingName: 'Mozzarella Cheese', qty: 120 }, { ingName: 'Pizza Tomato Sauce', qty: 80 }] },
      { menuName: 'Fresh Orange Juice', ingredients: [{ ingName: 'Fresh Oranges', qty: 350 }] },
      { menuName: 'Sparkling Water', ingredients: [{ ingName: 'Sparkling Water 330ml', qty: 1 }] },
    ];

    const recipeDocs = [];
    for (const rec of recipeDefinitions) {
      const menuId = menuMap.get(rec.menuName);
      if (!menuId) continue;
      for (const item of rec.ingredients) {
        const ingId = ingMap.get(item.ingName);
        if (!ingId) continue;
        recipeDocs.push({
          _id: nanoid(),
          id: nanoid(),
          branch_id: branchId,
          menu_item_id: menuId,
          inventory_item_id: ingId,
          qty_used: item.qty,
        });
      }
    }
    if (recipeDocs.length > 0) {
      await recipesCol.insertMany(recipeDocs);
    }

    console.log(`[MongoDB] Seeded demo collections for tenant: ${tenantId}, branch: ${branchId} (with inventory & recipes)`);
  } else {
    const branch = await branchesCol.findOne({});
    if (branch) DEMO_BRANCH_ID = branch.id || branch._id;
  }

}

// Helper to record an outbox event
export async function recordOutboxEvent({
  tenantId = null,
  branchId = DEMO_BRANCH_ID,
  eventType,
  entityType,
  entityId,
  payload,
}) {
  const db = getDb();
  const eventId = nanoid();
  const doc = {
    _id: eventId,
    id: eventId,
    tenant_id: tenantId || 'demo-tenant',
    branch_id: branchId,
    event_type: eventType,
    entity_type: entityType,
    entity_id: entityId,
    payload,
    status: 'pending',
    retry_count: 0,
    last_error: null,
    created_at: new Date().toISOString(),
    synced_at: null,
  };
  await db.collection('outbox_events').insertOne(doc);
  return eventId;
}

// Helper to append an immutable audit log record
export async function recordAuditLog({
  branchId = DEMO_BRANCH_ID,
  user = { id: 'system', name: 'System Event', role: 'system' },
  action,
  entityType = null,
  entityId = null,
  details = {},
}) {
  const db = getDb();
  const logId = nanoid();
  const doc = {
    _id: logId,
    id: logId,
    branch_id: branchId,
    user_id: user.id || null,
    user_name: user.name || 'Unknown Staff',
    user_role: user.role || 'cashier',
    action,
    entity_type: entityType,
    entity_id: entityId,
    details,
    details_json: JSON.stringify(details),
    created_at: new Date().toISOString(),
  };
  await db.collection('audit_logs').insertOne(doc);
  return logId;
}

export default {
  initDb,
  getDb,
  recordOutboxEvent,
  recordAuditLog,
  DEMO_BRANCH_ID,
};
