import { useState } from 'react';
import { notify } from './Toast';
import { QrCode, Copy, Check, ExternalLink, X, Smartphone } from 'lucide-react';

export default function QRModal({ isOpen, onClose, table, branchId, onOpenGuestApp }) {
  const [copied, setCopied] = useState(false);

  if (!isOpen || !table) return null;

  const tableNum = table.table_number || table.id;
  const guestOrderUrl = `${window.location.origin}/order/${branchId || 'default'}/${tableNum}`;
  const qrApiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(guestOrderUrl)}&color=0f172a`;

  const handleCopy = () => {
    navigator.clipboard.writeText(guestOrderUrl);
    setCopied(true);
    notify.success('URL Copied', 'Customer ordering link copied to clipboard.');
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card qr-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{
              width: '36px',
              height: '36px',
              borderRadius: '8px',
              background: 'rgba(168, 85, 247, 0.15)',
              color: '#a855f7',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              <QrCode size={20} />
            </div>
            <div>
              <h3>Table {tableNum} QR Self-Order Code</h3>
              <p style={{ fontSize: '11px', color: 'var(--text-dim)', margin: 0 }}>Customer mobile self-ordering without cashier assistance (FR-6.5)</p>
            </div>
          </div>
          <button className="btn-close" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="qr-modal-body">
          <div className="qr-code-frame">
            <img src={qrApiUrl} alt={`QR Code for Table ${tableNum}`} className="qr-image" />
            <div className="qr-stand-label">TABLE {tableNum} • SCAN TO ORDER</div>
          </div>

          <div className="qr-info-box">
            <label style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-faint)' }}>
              Direct Guest Order URL:
            </label>
            <div className="copy-url-row">
              <input type="text" readOnly value={guestOrderUrl} className="input-readonly-url" />
              <button className="btn-copy-url" onClick={handleCopy}>
                {copied ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: '#10b981' }}>
                    <Check size={13} /> Copied
                  </span>
                ) : (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                    <Copy size={13} /> Copy
                  </span>
                )}
              </button>
            </div>
          </div>

          <div className="qr-modal-actions" style={{ width: '100%' }}>
            <button
              className="btn-open-guest-app"
              onClick={() => {
                onClose();
                onOpenGuestApp(tableNum);
              }}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
            >
              <Smartphone size={16} />
              <span>Launch Guest App for Table {tableNum}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

