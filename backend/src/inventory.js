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

  // FR-6.4: End-of-Day (EOD) Reconciliation Report — all tables in all branches
  _rollupTableDay(table, orders, paymentsByOrder) {
    let grossSales = 0;
    let cashTotal = 0;
    let cardTotal = 0;
    let unpaidTotal = 0;
    let itemCount = 0;
    let covers = 0;
    let paidCount = 0;
    let openCount = 0;
    let voidCount = 0;
    let servedCount = 0;
    let lastOrderAt = null;

    const orderRows = orders.map((order) => {
      const pays = paymentsByOrder.get(order.id) || paymentsByOrder.get(order._id) || [];
      const cash = pays.filter((p) => p.method === 'cash').reduce((s, p) => s + (p.amount || 0), 0);
      const card = pays.filter((p) => p.method !== 'cash').reduce((s, p) => s + (p.amount || 0), 0);
      const collected = cash + card;
      const items = (order.items || []).map((it) => ({
        name: it.item_name || it.name || 'Item',
        qty: it.quantity || 1,
        price: it.price || 0,
        lineTotal: (it.price || 0) * (it.quantity || 1),
        status: it.status || 'placed',
      }));
      const qty = items.reduce((s, it) => s + it.qty, 0);
      const partySize = order.guest_count || (order.order_type === 'takeaway' || table.isTakeaway ? 1 : (table.capacity || 1));
      const stamp = order.updated_at || order.created_at;

      grossSales += order.total || 0;
      cashTotal += cash;
      cardTotal += card;
      itemCount += qty;
      covers += partySize;
      if (stamp && (!lastOrderAt || stamp > lastOrderAt)) lastOrderAt = stamp;

      if (order.status === 'paid') paidCount++;
      else if (order.status === 'void') voidCount++;
      else if (order.status === 'served') servedCount++;
      else openCount++;

      if (order.status !== 'paid' && order.status !== 'void') {
        unpaidTotal += Math.max(0, (order.total || 0) - collected);
      }

      return {
        id: order.id || order._id,
        createdAt: order.created_at,
        orderType: order.order_type,
        status: order.status,
        total: order.total || 0,
        cash,
        card,
        covers: partySize,
        itemCount: qty,
        items,
        paymentMethod: cash && card ? 'split' : card ? 'card' : cash ? 'cash' : (order.status === 'paid' ? 'unknown' : 'unpaid'),
      };
    });

    const orderCount = orders.length;
    return {
      id: table.id || table._id,
      tableNumber: String(table.table_number ?? '—'),
      zone: table.zone || (table.isTakeaway ? 'Counter' : '—'),
      capacity: table.capacity ?? null,
      floorStatus: table.status || 'available',
      isTakeaway: Boolean(table.isTakeaway),
      orderCount,
      paidCount,
      openCount,
      servedCount,
      voidCount,
      covers,
      itemCount,
      grossSales,
      cashTotal,
      cardTotal,
      unpaidTotal,
      avgTicket: orderCount ? grossSales / orderCount : 0,
      lastOrderAt,
      utilized: orderCount > 0,
      orders: orderRows.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))),
    };
  }

  async generateEODReport(branchId = null, dateStr = null) {
    const db = getDb();
    const targetDate = dateStr || new Date().toISOString().split('T')[0];

    const allBranches = await db.collection('branches').find({}).toArray();
    const scopedBranches = (branchId
      ? allBranches.filter((b) => (b.id || b._id) === branchId)
      : allBranches
    ).sort((a, b) => String(a.name).localeCompare(String(b.name)));

    const allTables = await db.collection('tables').find({}).toArray();
    const allOrders = await db.collection('orders').find({}).toArray();
    const allPayments = await db.collection('payments').find({}).toArray();
    const recipes = await db.collection('recipe_items').find({}).toArray();
    const inventory = await db.collection('inventory_items').find({}).toArray();

    const dayOrders = allOrders.filter((o) => (o.created_at || '').startsWith(targetDate));
    const dayPayments = allPayments.filter((p) => (p.created_at || '').startsWith(targetDate));

    const paymentsByOrder = new Map();
    for (const pay of dayPayments) {
      const key = pay.order_id;
      if (!key) continue;
      if (!paymentsByOrder.has(key)) paymentsByOrder.set(key, []);
      paymentsByOrder.get(key).push(pay);
    }

    const hourlyMap = new Map();
    const itemSalesMap = new Map();

    const branches = [];
    for (const branch of scopedBranches) {
      const bid = branch.id || branch._id;
      const tables = allTables
        .filter((t) => t.branch_id === bid)
        .sort((a, b) => {
          const na = Number(a.table_number);
          const nb = Number(b.table_number);
          if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
          return String(a.table_number).localeCompare(String(b.table_number));
        });

      const branchOrders = dayOrders.filter((o) => o.branch_id === bid);
      const tableReports = tables.map((table) => {
        const tid = table.id || table._id;
        const tOrders = branchOrders.filter((o) => o.table_id === tid);
        return this._rollupTableDay(table, tOrders, paymentsByOrder);
      });

      const takeawayOrders = branchOrders.filter((o) => o.order_type === 'takeaway' || !o.table_id);
      const takeawayRow = this._rollupTableDay(
        {
          id: `${bid}-takeaway`,
          table_number: 'Takeaway',
          zone: 'Counter',
          capacity: null,
          status: takeawayOrders.some((o) => o.status === 'open') ? 'occupied' : 'available',
          isTakeaway: true,
        },
        takeawayOrders,
        paymentsByOrder,
      );

      const roster = [...tableReports, takeawayRow];
      const occupiedNow = tables.filter((t) => t.status === 'occupied').length;
      const dirtyNow = tables.filter((t) => t.status === 'dirty').length;
      const availableNow = tables.filter((t) => t.status === 'available' || !t.status).length;

      let grossSales = 0;
      let cashTotal = 0;
      let cardTotal = 0;
      let unpaidTotal = 0;
      let dineInCount = 0;
      let takeawayCount = 0;
      let paidCount = 0;
      let openCount = 0;
      let servedCount = 0;
      let voidCount = 0;
      let covers = 0;
      let itemCount = 0;

      for (const order of branchOrders) {
        grossSales += order.total || 0;
        covers += order.guest_count || (order.order_type === 'takeaway' ? 1 : 0);
        itemCount += (order.items || []).reduce((s, it) => s + (it.quantity || 1), 0);
        if (order.order_type === 'takeaway' || !order.table_id) takeawayCount++;
        else dineInCount++;
        if (order.status === 'paid') paidCount++;
        else if (order.status === 'void') voidCount++;
        else if (order.status === 'served') servedCount++;
        else openCount++;

        const hour = (order.created_at || '').slice(11, 13) || '00';
        const slot = hourlyMap.get(hour) || { hour, orders: 0, sales: 0 };
        slot.orders += 1;
        slot.sales += order.total || 0;
        hourlyMap.set(hour, slot);

        if (order.status !== 'void') {
          for (const it of order.items || []) {
            const name = it.item_name || it.name || 'Item';
            const qty = it.quantity || 1;
            const rec = itemSalesMap.get(name) || { name, qty: 0, revenue: 0 };
            rec.qty += qty;
            rec.revenue += (it.price || 0) * qty;
            itemSalesMap.set(name, rec);
          }
        }
      }

      for (const row of roster) {
        cashTotal += row.cashTotal;
        cardTotal += row.cardTotal;
        unpaidTotal += row.unpaidTotal;
      }
      if (!covers) covers = roster.reduce((s, r) => s + (r.covers || 0), 0);

      const recipesForBranch = recipes.filter((r) => r.branch_id === bid);
      const inventoryForBranch = inventory.filter((i) => i.branch_id === bid);
      const ingMap = new Map(inventoryForBranch.map((i) => [i.id || String(i._id), i]));
      const usageMap = new Map();
      for (const order of branchOrders) {
        if (order.status === 'void') continue;
        for (const item of order.items || []) {
          const qty = item.quantity || 1;
          const itemRecipes = recipesForBranch.filter(
            (r) => r.menu_item_id === item.item_id || r.menu_item_id === item.id,
          );
          for (const r of itemRecipes) {
            usageMap.set(r.inventory_item_id, (usageMap.get(r.inventory_item_id) || 0) + (r.qty_used || 0) * qty);
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

      branches.push({
        id: bid,
        name: branch.name,
        receiptName: branch.receipt_name || branch.name,
        address: branch.address || '',
        phone: branch.phone || '',
        currency: branch.currency || 'EGP',
        tableCount: tables.length,
        occupiedNow,
        dirtyNow,
        availableNow,
        occupancyPct: tables.length ? Math.round((occupiedNow / tables.length) * 100) : 0,
        tablesUtilized: tableReports.filter((t) => t.utilized).length,
        financialSummary: {
          totalOrders: branchOrders.length,
          grossSales,
          netSales: grossSales - grossSales * 0.14,
          taxAmount: grossSales * 0.14,
          unpaidTotal,
          currency: branch.currency || 'EGP',
        },
        paymentSummary: {
          cashTotal,
          cardTotal,
          totalCollected: cashTotal + cardTotal,
          cashTxCount: roster.reduce((s, r) => s + r.orders.filter((o) => o.paymentMethod === 'cash' || o.paymentMethod === 'split').length, 0),
          cardTxCount: roster.reduce((s, r) => s + r.orders.filter((o) => o.paymentMethod === 'card' || o.paymentMethod === 'split').length, 0),
        },
        orderMetrics: {
          dineInCount,
          takeawayCount,
          paidCount,
          openCount,
          servedCount,
          voidCount,
          covers,
          itemCount,
        },
        tables: roster,
        ingredientDepletions,
      });
    }

    const company = branches.reduce(
      (acc, b) => {
        acc.totalOrders += b.financialSummary.totalOrders;
        acc.grossSales += b.financialSummary.grossSales;
        acc.cashTotal += b.paymentSummary.cashTotal;
        acc.cardTotal += b.paymentSummary.cardTotal;
        acc.unpaidTotal += b.financialSummary.unpaidTotal;
        acc.dineInCount += b.orderMetrics.dineInCount;
        acc.takeawayCount += b.orderMetrics.takeawayCount;
        acc.paidCount += b.orderMetrics.paidCount;
        acc.openCount += b.orderMetrics.openCount;
        acc.servedCount += b.orderMetrics.servedCount;
        acc.voidCount += b.orderMetrics.voidCount;
        acc.covers += b.orderMetrics.covers;
        acc.itemCount += b.orderMetrics.itemCount;
        acc.tableCount += b.tableCount;
        acc.tablesUtilized += b.tablesUtilized;
        acc.cashTxCount += b.paymentSummary.cashTxCount;
        acc.cardTxCount += b.paymentSummary.cardTxCount;
        acc.occupiedNow += b.occupiedNow;
        return acc;
      },
      {
        totalOrders: 0,
        grossSales: 0,
        cashTotal: 0,
        cardTotal: 0,
        unpaidTotal: 0,
        dineInCount: 0,
        takeawayCount: 0,
        paidCount: 0,
        openCount: 0,
        servedCount: 0,
        voidCount: 0,
        covers: 0,
        itemCount: 0,
        tableCount: 0,
        tablesUtilized: 0,
        cashTxCount: 0,
        cardTxCount: 0,
        occupiedNow: 0,
      },
    );

    const taxAmount = company.grossSales * 0.14;
    const ingredientDepletions = [];
    const depMap = new Map();
    for (const b of branches) {
      for (const dep of b.ingredientDepletions) {
        const cur = depMap.get(dep.name) || { ...dep, qtyDepleted: 0, currentStockRemaining: 0 };
        cur.qtyDepleted += dep.qtyDepleted;
        cur.currentStockRemaining += dep.currentStockRemaining;
        depMap.set(dep.name, cur);
      }
    }
    for (const dep of depMap.values()) ingredientDepletions.push(dep);

    return {
      reportDate: targetDate,
      generatedAt: new Date().toISOString(),
      tenantName: 'DINLYO Restaurant Group',
      branchCount: branches.length,
      scope: branchId ? 'branch' : 'all',
      financialSummary: {
        totalOrders: company.totalOrders,
        grossSales: company.grossSales,
        netSales: company.grossSales - taxAmount,
        taxAmount,
        unpaidTotal: company.unpaidTotal,
        currency: 'EGP',
      },
      paymentSummary: {
        cashTotal: company.cashTotal,
        cashTxCount: company.cashTxCount,
        cardTotal: company.cardTotal,
        cardTxCount: company.cardTxCount,
        totalCollected: company.cashTotal + company.cardTotal,
      },
      orderMetrics: {
        dineInCount: company.dineInCount,
        takeawayCount: company.takeawayCount,
        openCount: company.openCount,
        servedCount: company.servedCount,
        paidCount: company.paidCount,
        voidCount: company.voidCount,
        covers: company.covers,
        itemCount: company.itemCount,
        tableCount: company.tableCount,
        tablesUtilized: company.tablesUtilized,
        occupiedNow: company.occupiedNow,
      },
      hourlySales: [...hourlyMap.values()].sort((a, b) => a.hour.localeCompare(b.hour)),
      topItems: [...itemSalesMap.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 12),
      ingredientDepletions,
      branches,
    };
  }
}

export const inventoryEngine = new InventoryEngine();
