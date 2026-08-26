import { useState } from 'react';

export default function QRModal({ isOpen, onClose, table, branchId, onOpenGuestApp }) {
  const [copied, setCopied] = useState(false);

  if (!isOpen || !table) return null;

  const tableNum = table.table_number || table.id;
  const guestOrderUrl = `${window.location.origin}/order/${branchId || 'default'}/${tableNum}`;
  // Standard SVG QR placeholder pattern for table order
  const qrApiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(guestOrderUrl)}&color=0f172a`;

  const handleCopy = () => {
    navigator.clipboard.writeText(guestOrderUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card qr-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="flex items-center gap-2">
            <span style={{ fontSize: '20px' }}>📱</span>
            <div>
              <h3>Table {tableNum} QR Self-Order Code</h3>
              <p style={{ fontSize: '11px', opacity: 0.7 }}>Customer mobile self-ordering without cashier assistance (FR-6.5)</p>
            </div>
          </div>
          <button className="btn-close" onClick={onClose}>×</button>
        </div>

        <div className="qr-modal-body">
          <div className="qr-code-frame">
            <img src={qrApiUrl} alt={`QR Code for Table ${tableNum}`} className="qr-image" />
            <div className="qr-stand-label">TABLE {tableNum} • SCAN TO ORDER</div>
          </div>

          <div className="qr-info-box">
            <label style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Direct Guest Order URL:
            </label>
            <div className="copy-url-row">
              <input type="text" readOnly value={guestOrderUrl} className="input-readonly-url" />
              <button className="btn-copy-url" onClick={handleCopy}>
                {copied ? '✓ Copied' : 'Copy'}
              </button>
            </div>
          </div>

          <div className="qr-modal-actions">
            <button
              className="btn-open-guest-app"
              onClick={() => {
                onClose();
                onOpenGuestApp(tableNum);
              }}
            >
              🚀 Launch Guest Self-Order App for Table {tableNum}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
