import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { notify } from './Toast';
import { Printer, Receipt, ChefHat, Zap, X, Cpu, FileText } from 'lucide-react';

export default function HardwareModal({ isOpen, onClose }) {
  const { hardwareJobs, drawerKickCount, fetchHardwareStatus, kickDrawer, printTestReceipt } = useStore();
  const [selectedJob, setSelectedJob] = useState(null);
  const [acting, setActing] = useState(false);

  useEffect(() => {
    if (isOpen) {
      fetchHardwareStatus();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleKick = async () => {
    setActing(true);
    try {
      await kickDrawer();
      notify.success('Drawer Kick Dispatched', 'ESC/POS Solenoid pulse sent to TCP port 9100');
    } catch (e) {
      notify.error('Kick Failed', e.message);
    } finally {
      setActing(false);
    }
  };

  const handlePrintTest = async (type) => {
    setActing(true);
    try {
      await printTestReceipt(type);
      notify.success('Test Spooled', `Dispatched test ${type} to thermal ESC/POS spooler`);
    } catch (e) {
      notify.error('Print Test Failed', e.message);
    } finally {
      setActing(false);
    }
  };

  const activeJob = selectedJob || hardwareJobs[0];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card hardware-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="flex items-center gap-2" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{
              width: '36px',
              height: '36px',
              borderRadius: '8px',
              background: 'rgba(59, 130, 246, 0.15)',
              color: '#3b82f6',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              <Printer size={20} />
            </div>
            <div>
              <h3>Hardware Bridge & ESC/POS Thermal Spooler</h3>
              <p style={{ fontSize: '11px', color: 'var(--text-dim)', margin: 0 }}>TCP Port 9100 Raw Socket Bridge & Solenoid Kick (FR-5.1 – FR-5.5)</p>
            </div>
          </div>
          <button className="btn-close" onClick={onClose}><X size={18} /></button>
        </div>

        {/* Hardware Status & Quick Controls */}
        <div className="hardware-quick-stats">
          <div className="hw-stat-badge">
            <span className="dot online" />
            <span>TCP Printer Bridge: <strong>127.0.0.1:9100</strong></span>
          </div>
          <div className="hw-stat-badge">
            <span>Drawer Solenoid Kicks: <strong>{drawerKickCount}</strong></span>
          </div>
          <div className="hw-stat-badge">
            <span>Total Spooled Jobs: <strong>{hardwareJobs.length}</strong></span>
          </div>
        </div>

        <div className="hardware-actions-bar">
          <button className="btn-hw-action" onClick={() => handlePrintTest('RECEIPT')} disabled={acting}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              <Receipt size={14} /> Spool Test Receipt
            </span>
          </button>
          <button className="btn-hw-action" onClick={() => handlePrintTest('KITCHEN')} disabled={acting}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              <ChefHat size={14} /> Spool Kitchen Ticket
            </span>
          </button>
          <button className="btn-hw-action drawer-btn" onClick={handleKick} disabled={acting}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              <Zap size={14} /> Kick Cash Drawer (Pulse)
            </span>
          </button>
        </div>

        {/* Two-Pane Spooler: Job list on left, rendered ESC/POS thermal preview on right */}
        <div className="hardware-spooler-layout">
          <div className="spooler-list-col">
            <div className="spooler-col-title">Recent Print Jobs & Events</div>
            {hardwareJobs.length === 0 ? (
              <div className="spooler-empty">No print jobs spooled yet. Place an order or process a payment to see live printouts.</div>
            ) : (
              <div className="spooler-job-list">
                {hardwareJobs.map((job) => (
                  <div
                    key={job.id}
                    className={`spooler-job-card ${activeJob?.id === job.id ? 'selected' : ''}`}
                    onClick={() => setSelectedJob(job)}
                  >
                    <div className="job-title-row">
                      <span className={`job-type-badge ${job.type}`}>{job.type}</span>
                      <span className="job-time">{new Date(job.timestamp).toLocaleTimeString()}</span>
                    </div>
                    <div className="job-desc">
                      {job.type === 'DRAWER_KICK' ? (
                        <span>Pulse: <code>1B 70 00 19 FA</code> ({job.source})</span>
                      ) : (
                        <span>Order #{job.orderId?.slice(0, 6)} ({job.rawLength || 0} bytes)</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="spooler-preview-col">
            <div className="spooler-col-title">Thermal Printer Monospace Output</div>
            {activeJob && activeJob.type !== 'DRAWER_KICK' ? (
              <div className="thermal-receipt-paper">
                <pre className="escpos-preview">{activeJob.previewText || 'No preview text available'}</pre>
              </div>
            ) : activeJob?.type === 'DRAWER_KICK' ? (
              <div className="thermal-receipt-paper drawer-paper">
                <div style={{ textAlign: 'center', padding: '30px 10px' }}>
                  <div style={{ color: '#f59e0b', marginBottom: '8px' }}><Zap size={40} /></div>
                  <div style={{ fontWeight: 'bold', fontSize: '14px' }}>CASH DRAWER SOLENOID PULSE TRIGGERED</div>
                  <div style={{ fontSize: '11px', opacity: 0.7, marginTop: '4px' }}>Command: <code>ESC p 0 25 250</code> sent to port 9100</div>
                  <div style={{ fontSize: '12px', marginTop: '12px' }}>Event Source: <strong>{activeJob.source}</strong></div>
                  <div style={{ fontSize: '11px', opacity: 0.6, marginTop: '4px' }}>Timestamp: {new Date(activeJob.timestamp).toLocaleString()}</div>
                </div>
              </div>
            ) : (
              <div className="spooler-empty">Select a print job from the left to view the thermal receipt preview.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

