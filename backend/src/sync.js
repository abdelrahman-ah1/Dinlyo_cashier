import { getDb } from './db.js';

class SyncEngine {
  constructor() {
    this.wanOnline = true; // Simulated WAN connectivity state (default: online)
    this.isSyncing = false;
    this.lastSyncedAt = null;
    this.broadcastCallback = null;
    this.workerInterval = null;

    // Simulated Cloud PostgreSQL/MongoDB store (mirrors cloud backend)
    this.cloudStore = {
      orders: new Map(),
      order_items: new Map(),
      payments: new Map(),
      syncLog: [],
    };
  }

  setBroadcastCallback(fn) {
    this.broadcastCallback = fn;
  }

  async notifyStatus() {
    if (typeof this.broadcastCallback === 'function') {
      const status = await this.getStatus();
      this.broadcastCallback({
        type: 'sync.status',
        sync: status,
      });
    }
  }

  async setWanOnline(online) {
    this.wanOnline = Boolean(online);
    console.log(`[SyncEngine] WAN simulated status: ${this.wanOnline ? 'ONLINE' : 'OFFLINE'}`);
    await this.notifyStatus();

    if (this.wanOnline) {
      // Trigger immediate replay on reconnection
      this.replayPending().catch(() => {});
    }
    return this.getStatus();
  }

  async getOutboxStats() {
    try {
      const db = getDb();
      const col = db.collection('outbox_events');

      const allEvents = await col.find({}).sort({ created_at: -1 }).toArray();

      let pending = 0;
      let syncing = 0;
      let synced = 0;
      let failed = 0;

      for (const ev of allEvents) {
        if (ev.status === 'pending') pending++;
        else if (ev.status === 'syncing') syncing++;
        else if (ev.status === 'synced') synced++;
        else if (ev.status === 'failed') failed++;
      }

      return {
        pendingCount: pending,
        syncingCount: syncing,
        syncedCount: synced,
        failedCount: failed,
        totalCount: allEvents.length,
        recentEvents: allEvents.slice(0, 20),
      };
    } catch {
      return {
        pendingCount: 0,
        syncingCount: 0,
        syncedCount: 0,
        failedCount: 0,
        totalCount: 0,
        recentEvents: [],
      };
    }
  }

  async getStatus() {
    const stats = await this.getOutboxStats();
    return {
      wanOnline: this.wanOnline,
      isSyncing: this.isSyncing,
      lastSyncedAt: this.lastSyncedAt,
      ...stats,
    };
  }

  async replayPending() {
    if (!this.wanOnline || this.isSyncing) {
      return this.getStatus();
    }

    try {
      const db = getDb();
      const col = db.collection('outbox_events');

      const pending = await col.find({ status: { $in: ['pending', 'failed'] } })
        .sort({ created_at: 1 })
        .limit(50)
        .toArray();


      if (pending.length === 0) {
        return this.getStatus();
      }

      this.isSyncing = true;
      await this.notifyStatus();

      for (const event of pending) {
        await col.updateOne(
          { _id: event._id },
          { $set: { status: 'syncing' } }
        );

        try {
          const payload = typeof event.payload === 'string' ? JSON.parse(event.payload) : event.payload;
          
          // Push event into simulated Cloud Postgres backend
          this.processCloudReplication(event.event_type, event.entity_type, event.entity_id, payload);

          await col.updateOne(
            { _id: event._id },
            { $set: { status: 'synced', synced_at: new Date().toISOString() } }
          );

          this.cloudStore.syncLog.unshift({
            eventId: event.id || event._id,
            eventType: event.event_type,
            entityId: event.entity_id,
            timestamp: new Date().toISOString(),
          });
          if (this.cloudStore.syncLog.length > 50) this.cloudStore.syncLog.pop();
        } catch (err) {
          console.error(`[SyncEngine] Failed to sync event ${event.id || event._id}:`, err.message);
          await col.updateOne(
            { _id: event._id },
            { $set: { status: 'failed', last_error: err.message }, $inc: { retry_count: 1 } }
          );
        }
      }

      this.isSyncing = false;
      this.lastSyncedAt = new Date().toISOString();
      await this.notifyStatus();

      return this.getStatus();
    } catch (err) {
      this.isSyncing = false;
      console.error('[SyncEngine] Replay error:', err);
      return this.getStatus();
    }
  }

  processCloudReplication(eventType, entityType, entityId, payload) {
    switch (eventType) {
      case 'order.created': {
        this.cloudStore.orders.set(entityId, {
          ...payload,
          cloud_replicated_at: new Date().toISOString(),
        });
        if (Array.isArray(payload.items)) {
          for (const item of payload.items) {
            this.cloudStore.order_items.set(item.id || item._id, item);
          }
        }
        break;
      }
      case 'order_item.updated': {
        const existingOrder = this.cloudStore.orders.get(payload.orderId) || { id: payload.orderId };
        if (payload.order) {
          this.cloudStore.orders.set(payload.orderId, {
            ...existingOrder,
            ...payload.order,
            cloud_replicated_at: new Date().toISOString(),
          });
          if (Array.isArray(payload.order.items)) {
            for (const item of payload.order.items) {
              this.cloudStore.order_items.set(item.id || item._id, item);
            }
          }
        }
        break;
      }
      case 'order.updated': {
        const existingOrder = this.cloudStore.orders.get(entityId) || { id: entityId };
        this.cloudStore.orders.set(entityId, {
          ...existingOrder,
          ...payload.order,
          cloud_replicated_at: new Date().toISOString(),
        });
        break;
      }
      case 'payment.created': {
        this.cloudStore.payments.set(entityId, {
          ...payload,
          cloud_replicated_at: new Date().toISOString(),
        });
        break;
      }
      default: {
        console.log(`[SyncEngine] Replicated generic event ${eventType} (${entityType}:${entityId})`);
      }
    }
  }

  getCloudRecords() {
    return {
      orders: Array.from(this.cloudStore.orders.values()),
      orderItemsCount: this.cloudStore.order_items.size,
      paymentsCount: this.cloudStore.payments.size,
      recentSyncLog: this.cloudStore.syncLog,
    };
  }

  startWorker(intervalMs = 3000) {
    if (this.workerInterval) clearInterval(this.workerInterval);
    this.workerInterval = setInterval(() => {
      if (this.wanOnline) {
        this.replayPending().catch((err) => {
          console.error('[SyncEngine] Worker error during replay:', err);
        });
      }
    }, intervalMs);
    console.log(`[SyncEngine] Background sync replay worker started (interval: ${intervalMs}ms)`);
  }

  stopWorker() {
    if (this.workerInterval) {
      clearInterval(this.workerInterval);
      this.workerInterval = null;
    }
  }
}

export const syncEngine = new SyncEngine();
