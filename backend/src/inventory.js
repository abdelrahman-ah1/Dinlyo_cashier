import { getDb, DEMO_BRANCH_ID, recordAuditLog } from './db.js';
import { nanoid } from 'nanoid';

export class InventoryEngine {
  constructor() {
    this.broadcastCallback = null;
  }

  setBroadcastCallback(fn) {
    this.broadcastCallback = fn;
  }

  notify(event) {
    if (typeof this.broadcastCallback === 'function') {
      this.broadcastCallback(event);
    }
  }

  // FR-6.2: Deduct ingredients automatically when an order is placed
  async deductIngredientsForOrder(order, user = null) {
    if (!order || !Array.isArray(order.items) || order.items.length === 0) return { deductedCount: 0, alerts: [] };

    const db = getDb();
    const inventoryCol = db.collection('inventory_items');
    const recipesCol = db.collection('recipe_items');

    const lowStockAlerts = [];
    let totalDeductions = 0;

    for (const item of order.items) {
      const orderQty = item.quantity || 1;
      const itemId = item.item_id || item.id;

      // Find recipe entries for this menu item
      const recipes = await recipesCol.find({
        $or: [{ menu_item_id: itemId }, { menu_item_id: item.id }],
      }).toArray();

      for (const rec of recipes) {
        const consumedQty = (rec.qty_used || 0) * orderQty;
        if (consumedQty <= 0) continue;

        const ingredient = await inventoryCol.findOne({
          $or: [{ id: rec.inventory_item_id }, { _id: rec.inventory_item_id }],
        });

        if (ingredient) {
          const newStock = Math.max(0, (ingredient.stock_qty || 0) - consumedQty);
          await inventoryCol.updateOne(
            { _id: ingredient._id },
            { $set: { stock_qty: newStock, updated_at: new Date().toISOString() } }
          );

          totalDeductions++;

          // FR-6.3: Check low-stock threshold
          if (newStock <= (ingredient.reorder_level || 0)) {
            const alert = {
              ingredientId: ingredient.id || ingredient._id,
              name: ingredient.name,
              currentStock: newStock,
              reorderLevel: ingredient.reorder_level,
              unit: ingredient.unit,
              timestamp: new Date().toISOString(),
            };
            lowStockAlerts.push(alert);
            this.notify({ type: 'inventory.low_stock_alert', alert });
          }
        }
      }
    }

    if (lowStockAlerts.length > 0) {
      await recordAuditLog({
        branchId: order.branch_id || DEMO_BRANCH_ID,
        user: user || { id: 'system', name: 'Inventory Auto-Deduction', role: 'system' },
        action: 'LOW_STOCK_ALERT',
        entityType: 'inventory_items',
        details: { alerts: lowStockAlerts, orderId: order.id || order._id },
      });
    }

    this.notify({ type: 'inventory.updated', branchId: order.branch_id || DEMO_BRANCH_ID });
    return { deductedCount: totalDeductions, alerts: lowStockAlerts };
  }

  // List inventory stock with health flags
  async getInventory(branchId = DEMO_BRANCH_ID) {
    const db = getDb();
    const items = await db.collection('inventory_items')
      .find({ branch_id: branchId })
      .sort({ category: 1, name: 1 })
      .toArray();

    return items.map((it) => {
      const stock = it.stock_qty || 0;
      const reorder = it.reorder_level || 0;
      let status = 'in_stock';
      if (stock === 0) status = 'out_of_stock';
      else if (stock <= reorder) status = 'low_stock';

      return {
        id: it.id || String(it._id),
        _id: it.id || String(it._id),
        name: it.name,
        category: it.category || 'General',
        unit: it.unit || 'pcs',
        stock_qty: stock,
        reorder_level: reorder,
        cost_per_unit: it.cost_per_unit || 0,
        status,
        updated_at: it.updated_at || it.created_at,
      };
    });
  }

  // Adjust or restock inventory item
  async updateStock(ingredientId, newStockQty, user = null) {
    const db = getDb();
    const inventoryCol = db.collection('inventory_items');

    const item = await inventoryCol.findOne({
      $or: [{ id: ingredientId }, { _id: ingredientId }],
    });
    if (!item) throw new Error('Ingredient not found');

    const oldQty = item.stock_qty;
    await inventoryCol.updateOne(
      { _id: item._id },
      { $set: { stock_qty: Number(newStockQty), updated_at: new Date().toISOString() } }
    );

    await recordAuditLog({
      branchId: item.branch_id || DEMO_BRANCH_ID,
      user: user || { id: 'manager', name: 'Manager', role: 'manager' },
      action: 'INVENTORY_STOCK_ADJUSTED',
      entityType: 'inventory_items',
      entityId: item.id || item._id,
      details: { name: item.name, previousStock: oldQty, newStock: Number(newStockQty) },
    });

    this.notify({ type: 'inventory.updated', branchId: item.branch_id });
    return { success: true, item: { ...item, stock_qty: Number(newStockQty) } };
  }

  // List all recipes
  async getRecipes(branchId = DEMO_BRANCH_ID) {
    const db = getDb();
    const recipes = await db.collection('recipe_items').find({ branch_id: branchId }).toArray();
    const menuItems = await db.collection('menu_items').find({ branch_id: branchId }).toArray();
    const ingredients = await db.collection('inventory_items').find({ branch_id: branchId }).toArray();

    const menuMap = new Map(menuItems.map(m => [m.id || String(m._id), m.name]));
    const ingMap = new Map(ingredients.map(i => [i.id || String(i._id), i]));

    return recipes.map(r => ({
      id: r.id || String(r._id),
      menu_item_id: r.menu_item_id,
      menu_item_name: menuMap.get(r.menu_item_id) || 'Unknown Item',
      inventory_item_id: r.inventory_item_id,
      ingredient_name: ingMap.get(r.inventory_item_id)?.name || 'Unknown Ingredient',
      unit: ingMap.get(r.inventory_item_id)?.unit || 'pcs',
      qty_used: r.qty_used,
    }));
  }

  // FR-6.4: End-of-Day (EOD) Reconciliation Report
  async generateEODReport(branchId = DEMO_BRANCH_ID, dateStr = null) {
    const db = getDb();
    const targetDate = dateStr || new Date().toISOString().split('T')[0];

    // Fetch all orders for the branch
    const allOrders = await db.collection('orders')
      .find({ branch_id: branchId })
      .toArray();

    const dayOrders = allOrders.filter(o => (o.created_at || '').startsWith(targetDate));

    // Fetch all payments
    const paymentsCol = db.collection('payments');
    const payments = await paymentsCol.find({}).toArray();
    const dayPayments = payments.filter(p => (p.created_at || '').startsWith(targetDate));

    let grossSales = 0;
    let dineInCount = 0;
    let takeawayCount = 0;
    let servedCount = 0;
    let paidCount = 0;
    let openCount = 0;
    let voidCount = 0;

    for (const order of dayOrders) {
      grossSales += (order.total || 0);
      if (order.order_type === 'dine_in') dineInCount++;
      else takeawayCount++;

      if (order.status === 'paid') paidCount++;
      else if (order.status === 'served') servedCount++;
      else if (order.status === 'void') voidCount++;
      else openCount++;
    }

    let cashTotal = 0;
    let cardTotal = 0;
    let cashTxCount = 0;
    let cardTxCount = 0;

    for (const pay of dayPayments) {
      if (pay.method === 'cash') {
        cashTotal += pay.amount || 0;
        cashTxCount++;
      } else {
        cardTotal += pay.amount || 0;
        cardTxCount++;
      }
    }

    // Theoretical inventory consumption
    const recipes = await db.collection('recipe_items').find({ branch_id: branchId }).toArray();
    const inventory = await db.collection('inventory_items').find({ branch_id: branchId }).toArray();
    const ingMap = new Map(inventory.map(i => [i.id || String(i._id), i]));

    const usageMap = new Map();
    for (const order of dayOrders) {
      if (order.status === 'void') continue;
      for (const item of (order.items || [])) {
        const qty = item.quantity || 1;
        const itemRecipes = recipes.filter(r => r.menu_item_id === item.item_id || r.menu_item_id === item.id);
        for (const r of itemRecipes) {
          const used = (r.qty_used || 0) * qty;
          usageMap.set(r.inventory_item_id, (usageMap.get(r.inventory_item_id) || 0) + used);
        }
      }
    }

    const ingredientDepletions = [];
    for (const [ingId, usedQty] of usageMap.entries()) {
      const ing = ingMap.get(ingId);
      if (ing) {
        ingredientDepletions.push({
          id: ingId,
          name: ing.name,
          unit: ing.unit,
          qtyDepleted: usedQty,
          currentStockRemaining: ing.stock_qty,
        });
      }
    }

    const taxAmount = grossSales * 0.14;
    const netSales = grossSales - taxAmount;

    return {
      reportDate: targetDate,
      branchId,
      generatedAt: new Date().toISOString(),
      financialSummary: {
        totalOrders: dayOrders.length,
        grossSales,
        netSales,
        taxAmount,
        currency: 'EGP',
      },
      paymentSummary: {
        cashTotal,
        cashTxCount,
        cardTotal,
        cardTxCount,
        totalCollected: cashTotal + cardTotal,
      },
      orderMetrics: {
        dineInCount,
        takeawayCount,
        openCount,
        servedCount,
        paidCount,
        voidCount,
      },
      ingredientDepletions,
      recentOrders: dayOrders.slice(0, 15),
    };
  }
}

export const inventoryEngine = new InventoryEngine();
