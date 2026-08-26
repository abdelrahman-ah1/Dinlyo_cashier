import { useState } from 'react';
import { useStore } from '../store';
import { notify } from './Toast';
import { Lock, Delete, X, ShieldCheck, UserCheck, KeyRound } from 'lucide-react';

const DEMO_STAFF = [
  { name: 'Sarah Chen', role: 'manager', pin: '1234', label: 'General Manager (Full Access)' },
  { name: 'Ahmed Hassan', role: 'shift_manager', pin: '5678', label: 'Shift Lead (Today Audit Log)' },
  { name: 'Omar Tarek', role: 'cashier', pin: '0000', label: 'Cashier (POS + KDS Only)' },
];

export default function PinModal({ isOpen, onClose }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { loginWithPin } = useStore();

  if (!isOpen) return null;

  const handleDigit = (digit) => {
    if (pin.length < 6) {
      setPin((prev) => prev + digit);
      setError('');
    }
  };

  const handleBackspace = () => {
    setPin((prev) => prev.slice(0, -1));
    setError('');
  };

  const handleClear = () => {
    setPin('');
    setError('');
  };

  const handleLogin = async (pinToSubmit = pin) => {
    if (!pinToSubmit) {
      setError('Please enter a PIN');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const user = await loginWithPin(pinToSubmit);
      setPin('');
      notify.success('Authenticated', `Active staff switched to ${user.name} (${user.role.toUpperCase()})`);
      onClose();
    } catch (err) {
      setError(err.message || 'Invalid PIN');
      notify.error('Auth Failed', err.message || 'Invalid PIN provided');
    } finally {
      setLoading(false);
    }
  };

  const handleQuickSelect = (staff) => {
    setPin(staff.pin);
    handleLogin(staff.pin);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card pin-modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{
              width: '34px',
              height: '34px',
              borderRadius: '8px',
              background: 'rgba(249, 115, 22, 0.15)',
              color: 'var(--accent)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              <KeyRound size={18} />
            </div>
            <div>
              <h3>Staff Authentication & Fast Switch</h3>
              <p className="modal-sub">Enter security PIN or switch role quickly</p>
            </div>
          </div>
          <button className="close-btn" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="pin-body">
          {/* Quick Demo Staff Pick */}
          <div className="demo-staff-list">
            <span className="demo-staff-title">Quick Demo Staff Switch:</span>
            <div className="demo-staff-buttons">
              {DEMO_STAFF.map((staff) => (
                <button
                  key={staff.pin}
                  className={`demo-staff-chip ${staff.role}`}
                  onClick={() => handleQuickSelect(staff)}
                  disabled={loading}
                >
                  <div className="staff-chip-name">{staff.name}</div>
                  <div className="staff-chip-sub">{staff.label} • PIN: {staff.pin}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="pin-divider"><span>OR ENTER PIN</span></div>

          {/* PIN Input Display */}
          <div className="pin-display-box">
            <div className="pin-dots">
              {[0, 1, 2, 3].map((idx) => (
                <span
                  key={idx}
                  className={`pin-dot ${idx < pin.length ? 'filled' : ''}`}
                />
              ))}
            </div>
            {error && <div className="pin-error-msg">{error}</div>}
          </div>

          {/* Number Keypad */}
          <div className="pin-keypad">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', 'DEL'].map((k) => (
              <button
                key={k}
                className={`keypad-key ${k === 'C' ? 'clear' : k === 'DEL' ? 'backspace' : 'digit'}`}
                onClick={() => {
                  if (k === 'C') handleClear();
                  else if (k === 'DEL') handleBackspace();
                  else handleDigit(k);
                }}
                disabled={loading}
              >
                {k === 'DEL' ? <Delete size={18} style={{ verticalAlign: 'middle' }} /> : k}
              </button>
            ))}
          </div>

          <button
            className="pin-submit-btn"
            disabled={pin.length === 0 || loading}
            onClick={() => handleLogin()}
          >
            {loading ? 'Authenticating…' : 'Unlock & Switch Session'}
          </button>
        </div>
      </div>
    </div>
  );
}

