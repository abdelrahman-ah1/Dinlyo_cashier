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
    const W = 32;
    const stars = '*'.repeat(W);
    const money = (n) => (Number(n) || 0).toFixed(1);
    const row = (left, right) => {
      const l = String(left);
      const r = String(right);
      const gap = Math.max(1, W - l.length - r.length);
      return `${l}${' '.repeat(gap)}${r}`;
    };

    const shopName = payment.shop_name || order.shop_name || 'DINLYO';
    const address = payment.shop_address || order.shop_address || 'Address: Downtown Branch, Cairo';
    const phone = payment.shop_phone || order.shop_phone || 'Telp. 11223344';
    const method = String(payment.method || 'cash').toLowerCase();
    const totalVal = Number(order.total) || 0;
    const cashTendered = payment.cash_tendered != null && payment.cash_tendered !== ''
      ? Number(payment.cash_tendered)
      : (method === 'cash' ? totalVal : null);
    const changeVal = cashTendered != null ? Math.max(0, cashTendered - totalVal) : null;
    const orderNum = String(order.id || order._id || '000000').slice(-8).toUpperCase();
    const showCard = method === 'card';
    const showCash = method === 'cash';
    const cardLast4 = payment.card_last4 || (showCard ? orderNum.slice(-4) : null);
    const approval = payment.approval_code
      || (showCard && payment.idempotency_key ? `#${String(payment.idempotency_key).replace(/[^a-z0-9]/gi, '').slice(0, 6).toUpperCase()}` : null);
    const tableLabel = order.table_number
      ? `Table ${order.table_number}`
      : (order.order_type === 'takeaway' ? 'Takeaway' : null);
    const subtitle = [tableLabel, `#${orderNum.slice(-6)}`].filter(Boolean).join(' - ');

    const items = (Array.isArray(order.items) ? order.items : []).map((item) => {
      const qty = item.quantity || 1;
      const name = item.item_name || item.name || 'Item';
      const description = qty > 1 ? `${qty}x ${name}` : name;
      const price = (item.price || 0) * qty;
      return { description, price };
    });

    const layout = {
      shopName,
      address,
      phone,
      title: 'CASH RECEIPT',
      subtitle,
      items: items.map((it) => ({ description: it.description, price: money(it.price) })),
      total: money(totalVal),
      cash: showCash && cashTendered != null ? money(cashTendered) : null,
      change: showCash && changeVal != null ? money(changeVal) : null,
      cardMasked: showCard && cardLast4 ? `--- --- --- ${cardLast4}` : null,
      approvalCode: showCard ? approval : null,
      barcodeValue: orderNum,
    };

    const lines = [];
    lines.push(`${ESC}@`);

    // Header — centered shop identity
    lines.push(`${ESC}a\x01`);
    lines.push(`${ESC}!\x18${shopName}\n`);
    lines.push(`${ESC}!\x00${address}\n`);
    lines.push(`${phone}\n`);
    lines.push(`${stars}\n`);
    lines.push('CASH RECEIPT\n');
    if (subtitle) lines.push(`${ESC}!\x00${subtitle}\n`);
    lines.push(`${stars}\n`);

    // Items — left/right columns
    lines.push(`${ESC}a\x00`);
    lines.push(`${ESC}E\x01${row('Description', 'Price')}\n${ESC}E\x00`);
    for (const item of items) {
      lines.push(`${row(item.description.slice(0, 20), money(item.price))}\n`);
    }
    lines.push(`${stars}\n`);

    // Totals
    lines.push(`${ESC}E\x01${row('Total', money(totalVal))}\n${ESC}E\x00`);
    if (layout.cash != null) lines.push(`${row('Cash', layout.cash)}\n`);
    if (layout.change != null) lines.push(`${row('Change', layout.change)}\n`);
    lines.push(`${stars}\n`);

    // Card / approval (when tendered by card, or shown on the template)
    if (layout.cardMasked) {
      lines.push(`${row('Bank card', layout.cardMasked)}\n`);
      lines.push(`${row('Approval Code', layout.approvalCode)}\n`);
      lines.push(`${stars}\n`);
    }

    // Footer + barcode
    lines.push(`${ESC}a\x01`);
    lines.push(`${ESC}E\x01THANK YOU!\n${ESC}E\x00`);
    lines.push(`${GS}h${String.fromCharCode(60)}`);
    lines.push(`${GS}w${String.fromCharCode(2)}`);
    lines.push(`${GS}H${String.fromCharCode(2)}`);
    lines.push(`${GS}k\x04${orderNum}\x00`);
    lines.push('\n\n');
    lines.push(`${GS}V\x00`);

    return { raw: lines.join(''), layout };
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
    const { raw: rawEscPos, layout } = this.buildCustomerReceiptEscPos(order, payment);
    const job = {
      id: nanoid(),
      type: 'CUSTOMER_RECEIPT',
      orderId: order.id || order._id,
      total: order.total,
      paymentMethod: payment.method || 'cash',
      timestamp: new Date().toISOString(),
      rawLength: rawEscPos.length,
      previewText: this.escPosToPlainText(rawEscPos),
      layout,
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
      .replace(/\x1BE[\x00-\x01]/g, '')
      .replace(/\x1Dh[\s\S]/g, '')
      .replace(/\x1Dw[\s\S]/g, '')
      .replace(/\x1DH[\s\S]/g, '')
      .replace(/\x1Dk[\s\S][\s\S]*?\x00/g, '\n')
      .replace(/\x1Dp[\s\S]{3}/g, '')
      .replace(/\x1DV\x00/g, '\n');
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
