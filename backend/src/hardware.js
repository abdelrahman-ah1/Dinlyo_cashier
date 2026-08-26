import net from 'net';
import { nanoid } from 'nanoid';
import { recordAuditLog } from './db.js';

// ESC/POS Constants
const ESC = '\x1B';
const GS = '\x1D';

export class HardwareBridge {
  constructor() {
    this.printerHost = process.env.PRINTER_HOST || '127.0.0.1';
    this.printerPort = parseInt(process.env.PRINTER_PORT || '9100', 10);
    this.spoolerLogs = [];
    this.drawerKickCount = 0;
    this.broadcastCallback = null;
  }

  setBroadcastCallback(fn) {
    this.broadcastCallback = fn;
  }

  notifyHardwareEvent(event) {
    if (typeof this.broadcastCallback === 'function') {
      this.broadcastCallback(event);
    }
  }

  // -------------------------------------------------------------------------
  // ESC/POS Text & Binary Formatting Helpers
  // -------------------------------------------------------------------------
  buildKitchenTicketEscPos(order) {
    const lines = [];
    const dateStr = new Date(order.created_at || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const orderNum = (order.id || order._id || '').slice(-6).toUpperCase();

    // ESC @ (Initialize)
    lines.push(`${ESC}@`);
    // ESC a 1 (Center)
    lines.push(`${ESC}a\x01`);
    // Double width & height bold
    lines.push(`${ESC}!\x38*** KITCHEN ORDER ***\n`);
    lines.push(`${ESC}!\x18#${orderNum} — ${order.order_type === 'dine_in' ? `TABLE ${order.table_id || 'N/A'}` : 'TAKEAWAY'}\n`);
    lines.push(`${ESC}!\x00Time: ${dateStr}\n`);
    lines.push('--------------------------------\n');

    // Left align items
    lines.push(`${ESC}a\x00`);
    if (Array.isArray(order.items)) {
      for (const item of order.items) {
        lines.push(`${ESC}!\x20${item.quantity}x ${item.item_name}\n`);
        if (item.modifiers && item.modifiers.length > 0) {
          const modText = typeof item.modifiers === 'string' ? item.modifiers : item.modifiers.map(m => m.name || m).join(', ');
          lines.push(`${ESC}!\x00   + [${modText}]\n`);
        }
      }
    }

    lines.push('--------------------------------\n');
    lines.push(`${ESC}a\x01`);
    lines.push(`${ESC}!\x00* RUSH ORDER *\n\n\n`);
    // GS V 0 (Cut paper)
    lines.push(`${GS}V\x00`);

    return lines.join('');
  }

  buildCustomerReceiptEscPos(order, payment = {}) {
    const lines = [];
    const dateStr = new Date().toLocaleString();
    const orderNum = (order.id || order._id || '').slice(-6).toUpperCase();

    lines.push(`${ESC}@`);
    lines.push(`${ESC}a\x01`);
    lines.push(`${ESC}!\x38DEMO RESTAURANT\n`);
    lines.push(`${ESC}!\x00Downtown Branch • Cairo, Egypt\n`);
    lines.push(`TAX ID: 492-819-301\n`);
    lines.push(`Date: ${dateStr}\n`);
    lines.push(`Receipt #: REC-${orderNum}\n`);
    lines.push(`Order: #${orderNum} (${order.order_type.toUpperCase()})\n`);
    lines.push('--------------------------------\n');

    lines.push(`${ESC}a\x00`);
    if (Array.isArray(order.items)) {
      for (const item of order.items) {
        const lineTotal = (item.price || 0) * (item.quantity || 1);
        const namePart = `${item.quantity}x ${item.item_name}`.padEnd(22).slice(0, 22);
        const pricePart = `${lineTotal.toFixed(2)}`.padStart(10);
        lines.push(`${namePart}${pricePart}\n`);
      }
    }

    lines.push('--------------------------------\n');
    const total = (order.total || 0).toFixed(2);
    const tax = (order.total ? order.total * 0.14 : 0).toFixed(2);
    lines.push(`${'Subtotal (Excl Tax):'.padEnd(20)}${((order.total || 0) * 0.86).toFixed(2).padStart(12)}\n`);
    lines.push(`${'VAT (14%):'.padEnd(20)}${tax.padStart(12)}\n`);
    lines.push(`${ESC}!\x20${'TOTAL:'.padEnd(16)}${total.padStart(16)}\n`);
    lines.push(`${ESC}!\x00`);
    lines.push('--------------------------------\n');
    lines.push(`Paid via: ${(payment.method || 'CASH').toUpperCase()}\n`);
    if (payment.idempotency_key) {
      lines.push(`Auth Ref: ${payment.idempotency_key.slice(0, 12)}...\n`);
    }
    lines.push(`${ESC}a\x01`);
    lines.push('\nThank you for dining with us!\nPlease come again.\n\n\n');
    lines.push(`${GS}V\x00`);

    return lines.join('');
  }

  // -------------------------------------------------------------------------
  // Hardware Action Handlers
  // -------------------------------------------------------------------------

  // FR-5.1: Print Kitchen Ticket
  async printKitchenTicket(order) {
    const rawEscPos = this.buildKitchenTicketEscPos(order);
    const job = {
      id: nanoid(),
      type: 'KITCHEN_TICKET',
      orderId: order.id || order._id,
      tableNumber: order.table_id || 'TAKEAWAY',
      itemCount: order.items?.length || 0,
      timestamp: new Date().toISOString(),
      rawLength: rawEscPos.length,
      previewText: this.escPosToPlainText(rawEscPos),
    };

    this.spoolerLogs.unshift(job);
    if (this.spoolerLogs.length > 50) this.spoolerLogs.pop();

    console.log(`[Hardware] Dispatched KITCHEN TICKET for order #${order.id || order._id}`);
    this.sendToNetworkPrinter(rawEscPos).catch(() => {});
    this.notifyHardwareEvent({ type: 'hardware.print_spooled', job });
    return job;
  }

  // FR-5.2: Print Customer Receipt
  async printCustomerReceipt(order, payment = {}) {
    const rawEscPos = this.buildCustomerReceiptEscPos(order, payment);
    const job = {
      id: nanoid(),
      type: 'CUSTOMER_RECEIPT',
      orderId: order.id || order._id,
      total: order.total,
      paymentMethod: payment.method || 'cash',
      timestamp: new Date().toISOString(),
      rawLength: rawEscPos.length,
      previewText: this.escPosToPlainText(rawEscPos),
    };

    this.spoolerLogs.unshift(job);
    if (this.spoolerLogs.length > 50) this.spoolerLogs.pop();

    console.log(`[Hardware] Dispatched CUSTOMER RECEIPT for order #${order.id || order._id}`);
    this.sendToNetworkPrinter(rawEscPos).catch(() => {});
    this.notifyHardwareEvent({ type: 'hardware.print_spooled', job });
    return job;
  }

  // FR-5.3: Kick Cash Drawer on Cash Payment
  async kickCashDrawer(source = 'CASH_PAYMENT') {
    this.drawerKickCount++;
    const kickCommand = `${ESC}p\x00\x19\xFA`; // Standard 50ms drawer solenoid pulse
    const event = {
      id: nanoid(),
      type: 'DRAWER_KICK',
      source,
      kickCount: this.drawerKickCount,
      timestamp: new Date().toISOString(),
      commandHex: '1B 70 00 19 FA',
    };

    this.spoolerLogs.unshift(event);
    if (this.spoolerLogs.length > 50) this.spoolerLogs.pop();

    console.log(`[Hardware] Triggered CASH DRAWER KICK (${source})`);
    this.sendToNetworkPrinter(kickCommand).catch(() => {});
    this.notifyHardwareEvent({ type: 'hardware.drawer_kicked', event });
    return event;
  }

  // Raw TCP socket transmission to thermal printer (Port 9100)
  async sendToNetworkPrinter(data) {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      socket.setTimeout(800);

      socket.connect(this.printerPort, this.printerHost, () => {
        socket.write(data, 'binary', () => {
          socket.end();
          resolve(true);
        });
      });

      socket.on('error', (err) => {
        // Expected when no physical hardware is plugged into port 9100 on localhost
        socket.destroy();
        resolve(false);
      });

      socket.on('timeout', () => {
        socket.destroy();
        resolve(false);
      });
    });
  }

  // Convert ESC/POS control characters to human-readable monospace preview for UI
  escPosToPlainText(escStr) {
    return escStr
      .replace(/\x1B@/g, '')
      .replace(/\x1Ba[\x00-\x02]/g, '')
      .replace(/\x1B![\s\S]/g, '')
      .replace(/\x1Dp[\s\S]{3}/g, '')
      .replace(/\x1DV\x00/g, '\n[=== PAPER CUT ===]\n');
  }

  getSpoolerStatus() {
    return {
      printerHost: this.printerHost,
      printerPort: this.printerPort,
      totalJobs: this.spoolerLogs.length,
      drawerKickCount: this.drawerKickCount,
      recentJobs: this.spoolerLogs.slice(0, 30),
    };
  }
}

export const hardwareBridge = new HardwareBridge();
