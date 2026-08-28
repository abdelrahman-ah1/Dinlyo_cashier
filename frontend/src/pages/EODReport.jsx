import { useEffect, useMemo, useState, Fragment } from 'react';
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
  TrendingDown,
  LayoutGrid,
  MapPin,
  Clock,
} from 'lucide-react';

function egp(n) {
  return `EGP ${(Number(n) || 0).toFixed(2)}`;
}

function fmtTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function StatusPill({ status }) {
  const label = status || 'available';
  return <span className={`eod-status-pill ${label}`}>{label.replace('_', ' ')}</span>;
}

function TableRoster({ branch }) {
  return (
    <div className="eod-table-scroll">
      <table className="eod-table eod-roster-table">
        <thead>
          <tr>
            <th>Table</th>
            <th>Zone</th>
            <th>Cap.</th>
            <th>Floor</th>
            <th>Orders</th>
            <th>Covers</th>
            <th>Items</th>
            <th>Gross</th>
            <th>Cash</th>
            <th>Card</th>
            <th>Unpaid</th>
            <th>Avg ticket</th>
            <th>Last activity</th>
          </tr>
        </thead>
        <tbody>
          {(branch.tables || []).map((row) => (
            <Fragment key={row.id}>
              <tr className={row.unpaidTotal > 0 ? 'eod-row-unpaid' : row.utilized ? '' : 'eod-row-idle'}>
                <td className="font-medium">
                  {row.isTakeaway ? 'Takeaway' : `Table ${row.tableNumber}`}
                </td>
                <td>{row.zone}</td>
                <td>{row.capacity ?? '—'}</td>
                <td><StatusPill status={row.floorStatus} /></td>
                <td>{row.orderCount}</td>
                <td>{row.covers}</td>
                <td>{row.itemCount}</td>
                <td className="font-bold">{egp(row.grossSales)}</td>
                <td>{egp(row.cashTotal)}</td>
                <td>{egp(row.cardTotal)}</td>
                <td className={row.unpaidTotal > 0 ? 'text-danger font-bold' : ''}>{egp(row.unpaidTotal)}</td>
                <td>{egp(row.avgTicket)}</td>
                <td>{fmtTime(row.lastOrderAt)}</td>
              </tr>
              {row.orders?.length > 0 && (
                <tr className="eod-nested-row">
                  <td colSpan={13}>
                    <table className="eod-table eod-nested-table">
                      <thead>
                        <tr>
                          <th>Ticket</th>
                          <th>Time</th>
                          <th>Type</th>
                          <th>Status</th>
                          <th>Items</th>
                          <th>Tender</th>
                          <th>Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {row.orders.map((order) => (
                          <tr key={order.id}>
                            <td className="font-mono">#{String(order.id).slice(0, 6).toUpperCase()}</td>
                            <td>{fmtTime(order.createdAt)}</td>
                            <td>{order.orderType === 'takeaway' ? 'Takeaway' : 'Dine-in'}</td>
                            <td><StatusPill status={order.status} /></td>
                            <td>
                              {(order.items || []).map((it) => `${it.qty}× ${it.name}`).join(', ') || '—'}
                            </td>
                            <td>{order.paymentMethod}</td>
                            <td className="font-bold">{egp(order.total)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function EODReport() {
  const { eodReport, eodLoading, fetchEODReport, currentUser } = useStore();
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [branchFilter, setBranchFilter] = useState('all');

  useEffect(() => {
    fetchEODReport(selectedDate);
    setBranchFilter('all');
  }, [selectedDate]);

  const handlePrint = () => {
    notify.info('Print Dispatched', 'Generating printable reconciliation summary...');
    setTimeout(() => window.print(), 300);
  };

  const isManager = currentUser?.role === 'manager';
  const allBranches = eodReport?.branches || [];
  const visibleBranches = useMemo(
    () => (branchFilter === 'all' ? allBranches : allBranches.filter((b) => b.id === branchFilter)),
    [allBranches, branchFilter],
  );

  const display = useMemo(() => {
    if (branchFilter === 'all' || !eodReport) {
      return {
        fin: eodReport?.financialSummary || {},
        pay: eodReport?.paymentSummary || {},
        metrics: eodReport?.orderMetrics || {},
      };
    }
    const b = visibleBranches[0];
    if (!b) return { fin: {}, pay: {}, metrics: {} };
    return { fin: b.financialSummary, pay: b.paymentSummary, metrics: b.orderMetrics };
  }, [branchFilter, eodReport, visibleBranches]);

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

  const fin = display.fin;
  const pay = display.pay;
  const metrics = display.metrics;
  const depletions = branchFilter === 'all'
    ? (eodReport?.ingredientDepletions || [])
    : (visibleBranches[0]?.ingredientDepletions || []);
  const topItems = eodReport?.topItems || [];
  const hourly = eodReport?.hourlySales || [];

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
            <p className="eod-subtitle">All branches, every table, payments, tickets, and stock consumption</p>
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
            <div className="brand-title">{eodReport?.tenantName || 'DINLYO RESTAURANT GROUP'}</div>
            <div className="branch-sub">
              {branchFilter === 'all'
                ? `${allBranches.length} branches • ${metrics.tableCount || 0} tables • Daily X/Z reconciliation`
                : `${visibleBranches[0]?.name || ''} • ${visibleBranches[0]?.address || ''}`}
            </div>
            <div className="date-badge">
              Report Date: {selectedDate} | Generated: {eodReport?.generatedAt ? new Date(eodReport.generatedAt).toLocaleTimeString() : new Date().toLocaleTimeString()}
            </div>
          </div>

          <div className="eod-branch-filters no-print">
            <button
              className={`eod-branch-chip ${branchFilter === 'all' ? 'active' : ''}`}
              onClick={() => setBranchFilter('all')}
            >
              All branches ({allBranches.length})
            </button>
            {allBranches.map((b) => (
              <button
                key={b.id}
                className={`eod-branch-chip ${branchFilter === b.id ? 'active' : ''}`}
                onClick={() => setBranchFilter(b.id)}
              >
                {b.name} ({b.tableCount} tables)
              </button>
            ))}
          </div>

          <div className="eod-kpi-grid">
            <div className="eod-card highlight">
              <div className="kpi-label">Gross Revenue</div>
              <div className="kpi-amount">{egp(fin.grossSales)}</div>
              <div className="kpi-foot">{fin.totalOrders || 0} orders • {metrics.covers || 0} covers</div>
            </div>
            <div className="eod-card">
              <div className="kpi-label">Net Sales (Excl. Tax)</div>
              <div className="kpi-amount">{egp(fin.netSales)}</div>
              <div className="kpi-foot">VAT {egp(fin.taxAmount)} (14%)</div>
            </div>
            <div className="eod-card">
              <div className="kpi-label">Cash + Card Collected</div>
              <div className="kpi-amount">{egp(pay.totalCollected)}</div>
              <div className="kpi-foot">{(pay.cashTxCount || 0) + (pay.cardTxCount || 0)} tenders</div>
            </div>
            <div className="eod-card">
              <div className="kpi-label">Unpaid / Open</div>
              <div className="kpi-amount">{egp(fin.unpaidTotal)}</div>
              <div className="kpi-foot">{metrics.openCount || 0} open • {metrics.servedCount || 0} served unpaid</div>
            </div>
            <div className="eod-card">
              <div className="kpi-label">Tables Utilized</div>
              <div className="kpi-amount">{metrics.tablesUtilized || 0}/{metrics.tableCount || 0}</div>
              <div className="kpi-foot">{metrics.occupiedNow || 0} occupied on floor now</div>
            </div>
            <div className="eod-card">
              <div className="kpi-label">Items Sold</div>
              <div className="kpi-amount">{metrics.itemCount || 0}</div>
              <div className="kpi-foot">{metrics.dineInCount || 0} dine-in • {metrics.takeawayCount || 0} takeaway</div>
            </div>
          </div>

          <div className="eod-section-card" style={{ marginBottom: '20px' }}>
            <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <LayoutGrid size={16} style={{ color: 'var(--accent)' }} />
              <span>Branch comparison</span>
            </h3>
            <div className="eod-table-scroll">
              <table className="eod-table">
                <thead>
                  <tr>
                    <th>Branch</th>
                    <th>Address</th>
                    <th>Tables</th>
                    <th>Used today</th>
                    <th>On floor now</th>
                    <th>Orders</th>
                    <th>Covers</th>
                    <th>Gross</th>
                    <th>Collected</th>
                    <th>Unpaid</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleBranches.map((b) => (
                    <tr key={b.id}>
                      <td className="font-medium">{b.name}</td>
                      <td>{b.address || '—'}</td>
                      <td>{b.tableCount}</td>
                      <td>{b.tablesUtilized}</td>
                      <td>{b.occupiedNow} occ / {b.dirtyNow} dirty / {b.availableNow} free</td>
                      <td>{b.financialSummary.totalOrders}</td>
                      <td>{b.orderMetrics.covers}</td>
                      <td className="font-bold">{egp(b.financialSummary.grossSales)}</td>
                      <td>{egp(b.paymentSummary.totalCollected)}</td>
                      <td className={b.financialSummary.unpaidTotal > 0 ? 'text-danger' : ''}>{egp(b.financialSummary.unpaidTotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {visibleBranches.map((branch) => (
            <div key={branch.id} className="eod-branch-block">
              <div className="eod-branch-head">
                <div>
                  <h3>{branch.name}</h3>
                  <p>
                    <MapPin size={12} /> {branch.address || 'No address'} • Telp. {branch.phone || '—'} • {branch.tableCount} tables
                  </p>
                </div>
                <div className="eod-branch-kpis">
                  <span>{egp(branch.financialSummary.grossSales)} gross</span>
                  <span>{branch.tablesUtilized}/{branch.tableCount} tables used</span>
                  <span>{branch.occupancyPct}% occupied now</span>
                </div>
              </div>
              <TableRoster branch={branch} />
            </div>
          ))}

          <div className="eod-two-col">
            <div className="eod-section-card">
              <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <CreditCard size={16} style={{ color: 'var(--accent)' }} />
                <span>Tender reconciliation</span>
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
                    <td className="font-bold">{egp(pay.cashTotal)}</td>
                  </tr>
                  <tr>
                    <td>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                        <CreditCard size={14} style={{ color: '#3b82f6' }} /> Card / Terminal
                      </span>
                    </td>
                    <td>{pay.cardTxCount || 0}</td>
                    <td className="font-bold">{egp(pay.cardTotal)}</td>
                  </tr>
                  <tr className="summary-row">
                    <td><strong>Total Payments Captured</strong></td>
                    <td><strong>{(pay.cashTxCount || 0) + (pay.cardTxCount || 0)}</strong></td>
                    <td className="font-bold text-accent">{egp(pay.totalCollected)}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="eod-section-card">
              <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <UtensilsCrossed size={16} style={{ color: '#3b82f6' }} />
                <span>Order operations</span>
              </h3>
              <div className="metrics-list">
                <div className="metric-row"><span>Dine-in orders</span><strong>{metrics.dineInCount || 0}</strong></div>
                <div className="metric-row"><span>Takeaway orders</span><strong>{metrics.takeawayCount || 0}</strong></div>
                <div className="metric-row"><span>Fully paid & closed</span><strong className="text-success">{metrics.paidCount || 0}</strong></div>
                <div className="metric-row"><span>Served (unpaid)</span><strong>{metrics.servedCount || 0}</strong></div>
                <div className="metric-row"><span>Open tickets</span><strong>{metrics.openCount || 0}</strong></div>
                <div className="metric-row"><span>Voided orders</span><strong className="text-danger">{metrics.voidCount || 0}</strong></div>
                <div className="metric-row"><span>Covers</span><strong>{metrics.covers || 0}</strong></div>
              </div>
            </div>
          </div>

          <div className="eod-two-col" style={{ marginTop: '16px' }}>
            <div className="eod-section-card">
              <h3>Top items sold</h3>
              {topItems.length === 0 ? (
                <p className="text-muted" style={{ padding: '12px 0', color: 'var(--text-faint)' }}>No items sold on this date.</p>
              ) : (
                <table className="eod-table">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>Qty</th>
                      <th>Revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topItems.map((item) => (
                      <tr key={item.name}>
                        <td>{item.name}</td>
                        <td>{item.qty}</td>
                        <td className="font-bold">{egp(item.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="eod-section-card">
              <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Clock size={16} />
                <span>Hourly sales</span>
              </h3>
              {hourly.length === 0 ? (
                <p className="text-muted" style={{ padding: '12px 0', color: 'var(--text-faint)' }}>No hourly activity.</p>
              ) : (
                <table className="eod-table">
                  <thead>
                    <tr>
                      <th>Hour</th>
                      <th>Orders</th>
                      <th>Sales</th>
                    </tr>
                  </thead>
                  <tbody>
                    {hourly.map((slot) => (
                      <tr key={slot.hour}>
                        <td>{slot.hour}:00</td>
                        <td>{slot.orders}</td>
                        <td className="font-bold">{egp(slot.sales)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          <div className="eod-section-card" style={{ marginTop: '20px' }}>
            <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <TrendingDown size={16} style={{ color: '#f87171' }} />
              <span>Theoretical inventory consumption</span>
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
                    <tr key={dep.id || dep.name}>
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
