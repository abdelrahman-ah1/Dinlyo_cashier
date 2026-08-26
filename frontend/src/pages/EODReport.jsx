import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { notify } from '../components/Toast';
import {
  BarChart3,
  Printer,
  Lock,
  Banknote,
  CreditCard,
  Calendar,
  UtensilsCrossed,
  TrendingDown
} from 'lucide-react';

export default function EODReport() {
  const { eodReport, eodLoading, fetchEODReport, currentUser } = useStore();
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);

  useEffect(() => {
    fetchEODReport(selectedDate);
  }, [selectedDate]);

  const handlePrint = () => {
    notify.info('Print Dispatched', 'Generating printable reconciliation summary...');
    setTimeout(() => window.print(), 300);
  };

  const isManager = currentUser?.role === 'manager';

  if (!isManager) {
    return (
      <div className="audit-denied-card">
        <div style={{
          width: '64px',
          height: '64px',
          borderRadius: '16px',
          background: 'rgba(239, 68, 68, 0.15)',
          color: '#ef4444',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          margin: '0 auto 16px'
        }}>
          <Lock size={32} />
        </div>
        <h3>Access Restricted</h3>
        <p>End-of-Day Reconciliation Reports are restricted to General Managers.</p>
      </div>
    );
  }

  const fin = eodReport?.financialSummary || {};
  const pay = eodReport?.paymentSummary || {};
  const metrics = eodReport?.orderMetrics || {};
  const depletions = eodReport?.ingredientDepletions || [];

  return (
    <div className="eod-page">
      <div className="eod-header no-print">
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{
            width: '42px',
            height: '42px',
            borderRadius: '10px',
            background: 'rgba(59, 130, 246, 0.15)',
            color: '#3b82f6',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <BarChart3 size={24} />
          </div>
          <div>
            <h2>End-of-Day (EOD) Reconciliation Report</h2>
            <p className="eod-subtitle">Financial audit, payment method breakdown, and stock consumption (FR-6.4)</p>
          </div>
        </div>
        <div className="eod-actions" style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Calendar size={15} style={{ color: 'var(--text-faint)' }} />
            <input
              type="date"
              className="input-date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
            />
          </div>
          <button className="btn-print" onClick={handlePrint} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            <Printer size={14} />
            <span>Print / Save PDF</span>
          </button>
        </div>
      </div>

      {eodLoading ? (
        <div className="loading-state">Loading reconciliation report...</div>
      ) : (
        <div className="eod-content printable-area">
          <div className="eod-paper-header">
            <div className="brand-title">DINLYO RESTAURANT GROUP</div>
            <div className="branch-sub">Downtown Branch • Daily Operations X/Z Reconciliation Report</div>
            <div className="date-badge">Report Date: {selectedDate} | Generated: {new Date().toLocaleTimeString()}</div>
          </div>

          {/* Financial Summary Cards */}
          <div className="eod-kpi-grid">
            <div className="eod-card highlight">
              <div className="kpi-label">Gross Revenue</div>
              <div className="kpi-amount">EGP {(fin.grossSales || 0).toFixed(2)}</div>
              <div className="kpi-foot">{fin.totalOrders || 0} Total Orders Placed</div>
            </div>
            <div className="eod-card">
              <div className="kpi-label">Net Sales (Excl. Tax)</div>
              <div className="kpi-amount">EGP {(fin.netSales || 0).toFixed(2)}</div>
              <div className="kpi-foot">Before VAT</div>
            </div>
            <div className="eod-card">
              <div className="kpi-label">VAT Collected (14%)</div>
              <div className="kpi-amount">EGP {(fin.taxAmount || 0).toFixed(2)}</div>
              <div className="kpi-foot">Government Tax Authority</div>
            </div>
            <div className="eod-card">
              <div className="kpi-label">Total Cash Collected</div>
              <div className="kpi-amount">EGP {(pay.cashTotal || 0).toFixed(2)}</div>
              <div className="kpi-foot">{pay.cashTxCount || 0} Cash Drawer Transactions</div>
            </div>
          </div>

          {/* Payment Method Split & Order Flow Breakdown */}
          <div className="eod-two-col">
            <div className="eod-section-card">
              <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <CreditCard size={16} style={{ color: 'var(--accent)' }} />
                <span>Tender Reconciliation</span>
              </h3>
              <table className="eod-table">
                <thead>
                  <tr>
                    <th>Payment Method</th>
                    <th>Transactions</th>
                    <th>Total Amount</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                        <Banknote size={14} style={{ color: '#10b981' }} /> Cash in Drawer
                      </span>
                    </td>
                    <td>{pay.cashTxCount || 0}</td>
                    <td className="font-bold">EGP {(pay.cashTotal || 0).toFixed(2)}</td>
                  </tr>
                  <tr>
                    <td>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                        <CreditCard size={14} style={{ color: '#3b82f6' }} /> Card / Terminal
                      </span>
                    </td>
                    <td>{pay.cardTxCount || 0}</td>
                    <td className="font-bold">EGP {(pay.cardTotal || 0).toFixed(2)}</td>
                  </tr>
                  <tr className="summary-row">
                    <td><strong>Total Payments Captured</strong></td>
                    <td><strong>{(pay.cashTxCount || 0) + (pay.cardTxCount || 0)}</strong></td>
                    <td className="font-bold text-accent">EGP {(pay.totalCollected || 0).toFixed(2)}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="eod-section-card">
              <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <UtensilsCrossed size={16} style={{ color: '#3b82f6' }} />
                <span>Order Operations Breakdown</span>
              </h3>
              <div className="metrics-list">
                <div className="metric-row">
                  <span>Dine-In Orders:</span>
                  <strong>{metrics.dineInCount || 0}</strong>
                </div>
                <div className="metric-row">
                  <span>Takeaway Orders:</span>
                  <strong>{metrics.takeawayCount || 0}</strong>
                </div>
                <div className="metric-row">
                  <span>Fully Paid & Closed:</span>
                  <strong className="text-success">{metrics.paidCount || 0}</strong>
                </div>
                <div className="metric-row">
                  <span>Served (Unpaid):</span>
                  <strong>{metrics.servedCount || 0}</strong>
                </div>
                <div className="metric-row">
                  <span>Open Tickets:</span>
                  <strong>{metrics.openCount || 0}</strong>
                </div>
                <div className="metric-row">
                  <span>Voided Orders:</span>
                  <strong className="text-danger">{metrics.voidCount || 0}</strong>
                </div>
              </div>
            </div>
          </div>

          {/* Theoretical Ingredient Consumption */}
          <div className="eod-section-card" style={{ marginTop: '20px' }}>
            <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <TrendingDown size={16} style={{ color: '#f87171' }} />
              <span>Theoretical Inventory Consumption (Recipes Depleted)</span>
            </h3>
            {depletions.length === 0 ? (
              <p className="text-muted" style={{ padding: '12px 0', color: 'var(--text-faint)' }}>No recipes depleted for the selected date.</p>
            ) : (
              <table className="eod-table">
                <thead>
                  <tr>
                    <th>Ingredient Name</th>
                    <th>Theoretical Depletion Today</th>
                    <th>Remaining Stock on Hand</th>
                  </tr>
                </thead>
                <tbody>
                  {depletions.map((dep) => (
                    <tr key={dep.id}>
                      <td className="font-medium">{dep.name}</td>
                      <td>
                        <span className="depletion-tag">-{dep.qtyDepleted} {dep.unit}</span>
                      </td>
                      <td>{dep.currentStockRemaining} {dep.unit}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="manager-sign-box">
            <div>
              <div className="sign-line" />
              <div className="sign-label">Duty Manager Signature ({currentUser?.name})</div>
            </div>
            <div>
              <div className="sign-line" />
              <div className="sign-label">Shift Lead Verification</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

