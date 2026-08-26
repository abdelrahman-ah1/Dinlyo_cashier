import { useEffect, useState } from 'react';
import { useStore } from './store';
import POS from './pages/POS';
import KDS from './pages/KDS';
import Inventory from './pages/Inventory';
import EODReport from './pages/EODReport';
import AuditLog from './pages/AuditLog';
import SelfOrder from './pages/SelfOrder';
import PinModal from './components/PinModal';
import HardwareModal from './components/HardwareModal';
import QRModal from './components/QRModal';
import ToastContainer, { notify } from './components/Toast';
import {
  Printer,
  User,
  RefreshCw,
  UtensilsCrossed,
  ChefHat,
  Boxes,
  BarChart3,
  ShieldAlert,
  Smartphone,
  X,
  Zap,
  ArrowRightLeft,
  Wifi,
  WifiOff
} from 'lucide-react';

export default function App() {
  const [activeTab, setActiveTab] = useState('pos'); // 'pos' | 'kds' | 'inventory' | 'eod' | 'audit' | 'guest_order'
  const [showSyncModal, setShowSyncModal] = useState(false);
  const [showPinModal, setShowPinModal] = useState(false);
  const [showHwModal, setShowHwModal] = useState(false);
  const [selectedQrTable, setSelectedQrTable] = useState(null);
  const [guestAppTable, setGuestAppTable] = useState('1');

  const { init, wsConnected, menu, syncStatus, toggleWan, triggerReplay, currentUser, lowStockAlerts, branchId } = useStore();

  useEffect(() => {
    init();
  }, []);

  const { wanOnline, isSyncing, pendingCount, syncedCount, failedCount, recentEvents = [] } = syncStatus;
  const isManager = currentUser?.role === 'manager';
  const isShiftManager = currentUser?.role === 'shift_manager';
  const isCashier = currentUser?.role === 'cashier';

  // Automatically adjust activeTab if role changes and current tab is restricted
  useEffect(() => {
    if (isCashier && (activeTab === 'audit' || activeTab === 'inventory' || activeTab === 'eod')) {
      setActiveTab('pos');
    }
    if (isShiftManager && activeTab === 'eod') {
      setActiveTab('pos');
    }
  }, [currentUser?.role, activeTab, isCashier, isShiftManager]);

  const handleOpenGuestApp = (tableNum) => {
    setGuestAppTable(tableNum);
    setActiveTab('guest_order');
  };

  return (
    <div className="app-shell">
      <div className="topbar">
        <div className="brand">
          <span className="brand-mark">D</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: '13.5px', lineHeight: 1.2 }}>Downtown Branch</div>
            <div style={{ fontSize: '10.5px', color: 'var(--text-faint)' }}>Dinlyo POS & KDS Engine</div>
          </div>
        </div>

        {/* Role-Guarded Navigation Tabs */}
        <div className="nav-tabs">
          <button
            className={`nav-tab ${activeTab === 'pos' ? 'active' : ''}`}
            onClick={() => setActiveTab('pos')}
          >
            <UtensilsCrossed size={15} />
            <span>Cashier (POS)</span>
          </button>
          <button
            className={`nav-tab ${activeTab === 'kds' ? 'active' : ''}`}
            onClick={() => setActiveTab('kds')}
          >
            <ChefHat size={15} />
            <span>Kitchen (KDS)</span>
          </button>

          {!isCashier && (
            <button
              className={`nav-tab ${activeTab === 'inventory' ? 'active' : ''}`}
              onClick={() => setActiveTab('inventory')}
            >
              <Boxes size={15} />
              <span>Inventory</span>
              {lowStockAlerts.length > 0 && (
                <span className="tab-warning-dot">!</span>
              )}
            </button>
          )}

          {isManager && (
            <button
              className={`nav-tab ${activeTab === 'eod' ? 'active' : ''}`}
              onClick={() => setActiveTab('eod')}
            >
              <BarChart3 size={15} />
              <span>EOD Report</span>
            </button>
          )}

          {!isCashier && (
            <button
              className={`nav-tab ${activeTab === 'audit' ? 'active' : ''}`}
              onClick={() => setActiveTab('audit')}
            >
              <ShieldAlert size={15} />
              <span>{isShiftManager ? "Today's Audit" : 'Audit Trail'}</span>
            </button>
          )}

          <button
            className={`nav-tab guest-mode-tab ${activeTab === 'guest_order' ? 'active' : ''}`}
            onClick={() => handleOpenGuestApp('3')}
            title="Preview customer mobile self-ordering interface (FR-6.5)"
          >
            <Smartphone size={15} />
            <span>QR Self-Order</span>
          </button>
        </div>

        <div className="topbar-right">
          {/* Hardware & Spooler Monitor Trigger */}
          <button
            className="btn-hardware-topbar"
            onClick={() => setShowHwModal(true)}
            title="Open ESC/POS Thermal Spooler & Hardware Bridge (Port 9100)"
          >
            <Printer size={15} />
            <span>Hardware</span>
          </button>

          {/* Active Staff User Badge & Switch Button */}
          <button className="user-badge" onClick={() => setShowPinModal(true)} title="Click to switch staff role / enter PIN">
            <span className="user-avatar"><User size={15} /></span>
            <div className="user-details">
              <span className="user-name">{currentUser?.name || 'Staff User'}</span>
              <span className={`user-role-tag ${currentUser?.role}`}>
                {currentUser?.role?.replace('_', ' ').toUpperCase()}
              </span>
            </div>
            <ArrowRightLeft size={13} className="switch-icon" />
          </button>

          {/* Cloud Sync & Outbox Status Widget */}
          <button
            className={`sync-badge ${!wanOnline ? 'wan-offline' : pendingCount > 0 ? 'wan-pending' : 'wan-online'} ${!isManager ? 'read-only' : ''}`}
            onClick={() => {
              if (isManager) setShowSyncModal(true);
              else notify.warning('Manager Access Required', `Cloud sync management is restricted to General Managers. Current role: ${currentUser?.role}`);
            }}
            title={isManager ? 'Click to manage Cloud Sync & Outbox Queue' : 'Cloud Sync (Manager Restricted)'}
          >
            <span className={`sync-dot ${!wanOnline ? 'offline' : isSyncing ? 'syncing' : 'online'}`} />
            <div className="sync-text">
              <span className="sync-title">
                {!wanOnline ? 'WAN Offline' : isSyncing ? 'Syncing…' : 'Cloud Sync'}
              </span>
              <span className="sync-sub">
                {pendingCount > 0 ? `${pendingCount} pending` : `${syncedCount} synced`}
              </span>
            </div>
          </button>

          {/* Local LAN Edge Server Connection Indicator */}
          <div className="conn-status" title={wsConnected ? 'Connected to local Edge Server via WebSocket' : 'Reconnecting to Edge Server...'}>
            <span className={`conn-dot ${wsConnected ? 'online' : ''}`} />
            {wsConnected ? 'LAN Online' : 'Reconnecting…'}
          </div>
        </div>
      </div>

      <div className="page">
        {menu.length === 0 ? null : activeTab === 'pos' ? (
          <POS onOpenQrModal={(table) => setSelectedQrTable(table)} />
        ) : activeTab === 'kds' ? (
          <KDS />
        ) : activeTab === 'inventory' ? (
          <Inventory />
        ) : activeTab === 'eod' ? (
          <EODReport />
        ) : activeTab === 'audit' ? (
          <AuditLog />
        ) : (
          <SelfOrder
            tableNumber={guestAppTable}
            branchId={branchId}
            onBackToPos={() => setActiveTab('pos')}
          />
        )}
      </div>

      {/* PIN Authentication Modal */}
      <PinModal isOpen={showPinModal} onClose={() => setShowPinModal(false)} />

      {/* Hardware & ESC/POS Spooler Modal */}
      <HardwareModal isOpen={showHwModal} onClose={() => setShowHwModal(false)} />

      {/* Table QR Code Modal */}
      <QRModal
        isOpen={Boolean(selectedQrTable)}
        table={selectedQrTable}
        branchId={branchId}
        onClose={() => setSelectedQrTable(null)}
        onOpenGuestApp={(tNum) => handleOpenGuestApp(tNum)}
      />

      {/* Outbox & Cloud Sync Modal (Manager Only) */}
      {showSyncModal && isManager && (
        <div className="modal-backdrop" onClick={() => setShowSyncModal(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h3>Offline Outbox & Cloud Sync Engine</h3>
                <p className="modal-sub">Phase 2 Cloud Reconciliation & WAN Resilience (Manager Access)</p>
              </div>
              <button className="close-btn" onClick={() => setShowSyncModal(false)}><X size={18} /></button>
            </div>

            <div className="sync-controls">
              <div className="wan-switch-box">
                <span className="control-label">WAN Link Status:</span>
                <button
                  className={`toggle-btn ${wanOnline ? 'active-online' : 'active-offline'}`}
                  onClick={() => toggleWan(!wanOnline)}
                >
                  {wanOnline ? (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                      <Wifi size={14} /> WAN Online
                    </span>
                  ) : (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                      <WifiOff size={14} /> WAN Outage (Simulated)
                    </span>
                  )}
                </button>
              </div>

              <button
                className="replay-btn"
                disabled={!wanOnline || isSyncing || pendingCount === 0}
                onClick={() => triggerReplay()}
              >
                {isSyncing ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                    <RefreshCw size={14} className="animate-spin" /> Replaying…
                  </span>
                ) : (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                    <Zap size={14} /> Trigger Replay
                  </span>
                )}
              </button>
            </div>

            <div className="stats-row">
              <div className="stat-card">
                <span className="stat-val pending">{pendingCount}</span>
                <span className="stat-lbl">Pending in Outbox</span>
              </div>
              <div className="stat-card">
                <span className="stat-val synced">{syncedCount}</span>
                <span className="stat-lbl">Reconciled to Cloud</span>
              </div>
              <div className="stat-card">
                <span className="stat-val failed">{failedCount}</span>
                <span className="stat-lbl">Failed Retries</span>
              </div>
            </div>

            <div className="events-section">
              <h4>Recent Outbox Write Events</h4>
              <div className="events-list">
                {recentEvents.length === 0 ? (
                  <div className="empty-events">No outbox events recorded yet. Place an order to see it buffer.</div>
                ) : (
                  recentEvents.map((evt) => (
                    <div key={evt.id} className="event-item">
                      <div className="event-main">
                        <span className="event-type">{evt.event_type}</span>
                        <span className="event-target">{evt.entity_type} #{evt.entity_id?.slice(0, 6)}</span>
                      </div>
                      <div className="event-meta">
                        <span className="event-time">{new Date(evt.created_at + (evt.created_at.endsWith('Z') ? '' : 'Z')).toLocaleTimeString()}</span>
                        <span className={`event-status-pill ${evt.status}`}>{evt.status}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="modal-footer">
              <span className="footer-note">
                Logged in as <strong>{currentUser.name}</strong> • Operator actions are attributed in the immutable audit log.
              </span>
              <button className="done-btn" onClick={() => setShowSyncModal(false)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Global Toast Notification Container */}
      <ToastContainer />
    </div>
  );
}

