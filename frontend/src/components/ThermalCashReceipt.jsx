function ReceiptBarcode({ value = '' }) {
  const bars = [];
  const seed = `*${value}*`;
  for (let i = 0; i < seed.length; i++) {
    const code = seed.charCodeAt(i);
    bars.push(2 + (code % 3));
    bars.push(1);
    bars.push(1 + ((code >> 2) % 3));
    bars.push(1);
  }
  return (
    <div className="receipt-barcode" aria-hidden="true">
      {bars.map((w, i) => (
        <span
          key={i}
          className={i % 2 === 0 ? 'bar' : 'gap'}
          style={{ width: `${w * 2}px` }}
        />
      ))}
    </div>
  );
}

export default function ThermalCashReceipt({ layout, previewText, compact = false }) {
  if (!layout) {
    return (
      <div className="thermal-receipt-paper">
        <pre className="escpos-preview">{previewText || 'No preview text available'}</pre>
      </div>
    );
  }

  return (
    <div className={`thermal-receipt-paper cash-receipt${compact ? ' compact' : ''}`}>
      <header className="receipt-header">
        <div className="receipt-shop">{layout.shopName}</div>
        <div className="receipt-meta">{layout.address}</div>
        <div className="receipt-meta">{layout.phone}</div>
      </header>

      <div className="receipt-stars">****************************</div>
      <div className="receipt-title">{layout.title || 'CASH RECEIPT'}</div>
      {layout.subtitle && <div className="receipt-subtitle">{layout.subtitle}</div>}
      <div className="receipt-stars">****************************</div>

      <div className="receipt-row receipt-cols">
        <span>Description</span>
        <span>Price</span>
      </div>
      {(layout.items || []).map((item, i) => (
        <div className="receipt-row" key={`${item.description}-${i}`}>
          <span>{item.description}</span>
          <span>{item.price}</span>
        </div>
      ))}

      <div className="receipt-stars">****************************</div>
      <div className="receipt-row receipt-total">
        <span>Total</span>
        <span>{layout.total}</span>
      </div>
      {layout.cash != null && (
        <div className="receipt-row">
          <span>Cash</span>
          <span>{layout.cash}</span>
        </div>
      )}
      {layout.change != null && (
        <div className="receipt-row">
          <span>Change</span>
          <span>{layout.change}</span>
        </div>
      )}

      {(layout.cardMasked || layout.approvalCode) && (
        <>
          <div className="receipt-stars">****************************</div>
          {layout.cardMasked && (
            <div className="receipt-row">
              <span>Bank card</span>
              <span>{layout.cardMasked}</span>
            </div>
          )}
          {layout.approvalCode && (
            <div className="receipt-row">
              <span>Approval Code</span>
              <span>{layout.approvalCode}</span>
            </div>
          )}
        </>
      )}

      <div className="receipt-stars">****************************</div>
      <div className="receipt-thanks">THANK YOU!</div>
      <ReceiptBarcode value={layout.barcodeValue} />
    </div>
  );
}
