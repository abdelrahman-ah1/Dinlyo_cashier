import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { notify } from '../components/Toast';
import {
  ShieldAlert,
  Lock,
  Search,
  RefreshCw,
  Activity,
  AlertTriangle,
  FileText
} from 'lucide-react';

export default function AuditLog() {
  const { currentUser, auditLogs, auditLogLoading, auditLogError, auditLogScope, fetchAuditLogs } = useStore();
  const [filterAction, setFilterAction] = useState('ALL');
  const [searchActor, setSearchActor] = useState('');

  useEffect(() => {
    fetchAuditLogs(currentUser.role === 'shift_manager' ? 'today' : auditLogScope);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser.role]);

  if (currentUser.role === 'cashier') {
    return (
      <div className="audit-restricted-card">
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
        <h2>Access Restricted (403 Forbidden)</h2>
        <p>Cashier operators do not have permission to inspect system audit logs.</p>
        <div className="restricted-badge">Required Scope: Shift Manager or General Manager</div>
      </div>
    );
  }

  const isShiftManager = currentUser.role === 'shift_manager';

  const filteredLogs = auditLogs.filter((log) => {
    if (filterAction !== 'ALL' && log.action !== filterAction) return false;
    if (searchActor && !log.user_name.toLowerCase().includes(searchActor.toLowerCase())) return false;
    return true;
  });

  const orderEventsCount = auditLogs.filter((l) => l.action.startsWith('ORDER')).length;
  const statusEventsCount = auditLogs.filter((l) => l.action.startsWith('ITEM')).length;
  const systemEventsCount = auditLogs.filter((l) => l.action.startsWith('WAN') || l.action.startsWith('USER')).length;

  return (
    <div className="audit-page">
      <div className="audit-header-bar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{
            width: '42px',
            height: '42px',
            borderRadius: '10px',
            background: 'rgba(168, 85, 247, 0.15)',
            color: '#a855f7',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <ShieldAlert size={24} />
          </div>
          <div>
            <h2>System Audit Trail</h2>
            <div className="audit-scope-info">
              <span className={`role-badge ${currentUser.role}`}>{currentUser.role.replace('_', ' ').toUpperCase()}</span>
              <span>
                {isShiftManager
                  ? "Today's Shift Scope (Current Day Activity Only)"
                  : 'Full System Audit Access (All Historical Events)'}
              </span>
            </div>
          </div>
        </div>

        <div className="audit-actions-bar">
          {!isShiftManager && (
            <div className="scope-toggle-group">
              <button
                className={`scope-pill ${auditLogScope === 'today' ? 'active' : ''}`}
                onClick={() => fetchAuditLogs('today')}
              >
                Today's Shift
              </button>
              <button
                className={`scope-pill ${auditLogScope === 'all' ? 'active' : ''}`}
                onClick={() => fetchAuditLogs('all')}
              >
                All History
              </button>
            </div>
          )}

          <button
            className="refresh-btn"
            onClick={() => {
              fetchAuditLogs(auditLogScope);
              notify.info('Audit Log', 'Audit records updated');
            }}
            disabled={auditLogLoading}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
          >
            <RefreshCw size={13} className={auditLogLoading ? 'animate-spin' : ''} />
            <span>{auditLogLoading ? 'Refreshing…' : 'Refresh Logs'}</span>
          </button>
        </div>
      </div>

      {/* Summary KPI Cards */}
      <div className="audit-stats-grid">
        <div className="audit-stat-card">
          <span className="stat-title">Total Logged Actions</span>
          <span className="stat-value">{auditLogs.length}</span>
        </div>
        <div className="audit-stat-card">
          <span className="stat-title">Order Lifecycle Events</span>
          <span className="stat-value order">{orderEventsCount}</span>
        </div>
        <div className="audit-stat-card">
          <span className="stat-title">KDS Status Updates</span>
          <span className="stat-value kds">{statusEventsCount}</span>
        </div>
        <div className="audit-stat-card">
          <span className="stat-title">System & Auth Events</span>
          <span className="stat-value system">{systemEventsCount}</span>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="audit-filter-bar">
        <div className="filter-input-box" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Search size={14} style={{ color: 'var(--text-faint)' }} />
          <input
            type="text"
            placeholder="Search by staff actor name…"
            value={searchActor}
            onChange={(e) => setSearchActor(e.target.value)}
          />
        </div>

        <div className="action-filter-pills">
          {['ALL', 'ORDER_CREATED', 'ITEM_STATUS_UPDATED', 'ORDER_STATUS_UPDATED', 'WAN_SIMULATION_CHANGED', 'USER_LOGIN'].map((act) => (
            <button
              key={act}
              className={`action-pill ${filterAction === act ? 'active' : ''}`}
              onClick={() => setFilterAction(act)}
            >
              {act.replace(/_/g, ' ')}
            </button>
          ))}
        </div>
      </div>

      {/* Error display */}
      {auditLogError && (
        <div className="audit-error-banner" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <AlertTriangle size={15} style={{ color: '#ef4444' }} />
          <span>{auditLogError}</span>
        </div>
      )}

      {/* Logs Table */}
      <div className="audit-table-container">
        <table className="audit-table">
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>Staff Actor</th>
              <th>Role</th>
              <th>Action</th>
              <th>Entity</th>
              <th>Details Breakdown</th>
            </tr>
          </thead>
          <tbody>
            {filteredLogs.length === 0 ? (
              <tr>
                <td colSpan={6} className="empty-audit-row">
                  {auditLogLoading ? 'Loading audit trail…' : 'No audit records match your current filter.'}
                </td>
              </tr>
            ) : (
              filteredLogs.map((log) => {
                let parsedDetails = {};
                try {
                  parsedDetails = JSON.parse(log.details_json || '{}');
                } catch {
                  parsedDetails = {};
                }

                return (
                  <tr key={log.id} className="audit-row">
                    <td className="time-cell">
                      {new Date(log.created_at + (log.created_at.endsWith('Z') ? '' : 'Z')).toLocaleString()}
                    </td>
                    <td className="actor-cell">
                      <strong>{log.user_name}</strong>
                    </td>
                    <td>
                      <span className={`role-pill ${log.user_role}`}>
                        {log.user_role?.replace('_', ' ')}
                      </span>
                    </td>
                    <td>
                      <span className={`action-badge ${log.action}`}>
                        {log.action}
                      </span>
                    </td>
                    <td className="entity-cell">
                      {log.entity_type ? `${log.entity_type} #${log.entity_id?.slice(0, 6)}` : '—'}
                    </td>
                    <td className="details-cell">
                      <code>{JSON.stringify(parsedDetails)}</code>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

