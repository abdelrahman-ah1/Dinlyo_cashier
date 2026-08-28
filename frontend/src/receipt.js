export function formatMoney(n) {
  return (Number(n) || 0).toFixed(1);
}

export function buildReceiptLayout({ shop = {}, order = {}, payment = {} } = {}) {
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

  const items = (Array.isArray(order.items) ? order.items : []).map((item) => {
    const qty = item.quantity || 1;
    const name = item.item_name || item.name || 'Item';
    return {
      description: qty > 1 ? `${qty}x ${name}` : name,
      price: formatMoney((item.price || 0) * qty),
    };
  });

  const tableLabel = order.table_number
    ? `Table ${order.table_number}`
    : (order.order_type === 'takeaway' ? 'Takeaway' : null);
  const subtitle = [tableLabel, orderNum ? `#${orderNum.slice(-6)}` : null].filter(Boolean).join(' - ');

  return {
    shopName: shop.shopName || shop.shop_name || 'DINLYO',
    address: shop.address || shop.shop_address || 'Address: Downtown Branch, Cairo',
    phone: shop.phone || shop.shop_phone || 'Telp. 11223344',
    title: 'CASH RECEIPT',
    subtitle,
    items,
    total: formatMoney(totalVal),
    cash: showCash && cashTendered != null ? formatMoney(cashTendered) : null,
    change: showCash && changeVal != null ? formatMoney(changeVal) : null,
    cardMasked: showCard && cardLast4 ? `--- --- --- ${cardLast4}` : null,
    approvalCode: showCard ? (payment.approval_code || `#${orderNum.slice(0, 6)}`) : null,
    barcodeValue: orderNum,
  };
}
