import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowDownToLine, ArrowUpRight, BarChart3, Bookmark, ChevronDown,
  CircleAlert, FileText, LayoutDashboard, LoaderCircle, MessageSquare,
  RefreshCw, Settings, Upload,
} from 'lucide-react'
import fsLogo from '../assets/fs-logo.png'
import { useAuth } from '../context/AuthContext'
import './FinGPT.css'
import './Analytics.css'

const API_URL = (import.meta.env.VITE_FINANCIAL_API_URL || 'http://localhost:8000').replace(/\/$/, '')
const RATIO_GROUPS = [
  { title: 'Profitability', description: 'Returns and margins generated from reported activity.', ratios: [
    ['gross_profit_margin', 'Gross profit margin', 'Gross profit as a share of revenue', '%'],
    ['operating_margin', 'Operating margin', 'Operating income as a share of revenue', '%'],
    ['net_profit_margin', 'Net profit margin', 'Net income as a share of revenue', '%'],
    ['return_on_assets', 'Return on assets', 'Net income relative to average assets', '%'],
    ['return_on_equity', 'Return on equity', 'Net income relative to average equity', '%'],
  ] },
  { title: 'Liquidity', description: 'Capacity to meet near-term obligations.', ratios: [
    ['current_ratio', 'Current ratio', 'Current assets divided by current liabilities', 'x'],
    ['quick_ratio', 'Quick ratio', 'Liquid assets relative to current liabilities', 'x'],
    ['cash_ratio', 'Cash ratio', 'Cash and equivalents relative to current liabilities', 'x'],
  ] },
  { title: 'Leverage', description: 'Capital structure and debt burden.', ratios: [
    ['debt_to_equity', 'Debt-to-equity', 'Total debt relative to reported equity', 'x'],
    ['debt_to_assets', 'Debt-to-assets', 'Total debt relative to total assets', 'x'],
    ['interest_coverage', 'Interest coverage', 'Operating earnings relative to interest expense', 'x'],
  ] },
  { title: 'Efficiency', description: 'How effectively reported resources are used.', ratios: [
    ['asset_turnover', 'Asset turnover', 'Revenue relative to average assets', 'x'],
    ['inventory_turnover', 'Inventory turnover', 'Cost of goods sold relative to average inventory', 'x'],
    ['receivables_turnover', 'Receivables turnover', 'Revenue relative to average receivables', 'x'],
  ] },
]

const number = (value) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value))
const formatNumber = (value, maximumFractionDigits = 2) => number(value)
  ? new Intl.NumberFormat(undefined, { maximumFractionDigits }).format(Number(value))
  : 'Not available'
const formatDate = (value) => {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date)
}
const safeDetailMessage = (payload, fallback) => typeof payload?.detail === 'string' ? payload.detail : fallback

function Sidebar() {
  const item = (label, icon, active, href, disabled = false) => {
    const Icon = icon
    return disabled ? (
      <button type="button" className="sidebar-item" disabled aria-label={`${label}, coming soon`} title="Coming soon">
        <Icon size={17} strokeWidth={1.8} /><span>{label}</span>
      </button>
    ) : (
      <a className={`sidebar-item${active ? ' active' : ''}`} href={href} aria-current={active ? 'page' : undefined}>
        <Icon size={17} strokeWidth={1.8} /><span>{label}</span>{active && <span className="nav-indicator" />}
      </a>
    )
  }
  return <aside className="fingpt-sidebar analytics-sidebar">
    <a className="fingpt-brand analytics-brand" href="/fingpt" aria-label="FinSight FinGPT">
      <img src={fsLogo} alt="" className="fingpt-logo" /><span>FinGPT</span>
    </a>
    <nav className="fingpt-navigation" aria-label="Workspace">
      {item('Research Chat', MessageSquare, false, '/fingpt')}
      {item('Dashboard', LayoutDashboard, false, '', true)}
      {item('Saved Reports', Bookmark, false, '', true)}
      {item('Analytics', BarChart3, true, '/analytics')}
      {item('Settings', Settings, false, '', true)}
    </nav>
    <div className="analytics-sidebar-note"><span className="analytics-live-dot" />Financial workspace</div>
  </aside>
}

function EmptyBlock({ title, detail, compact = false }) {
  return <div className={`analytics-empty${compact ? ' is-compact' : ''}`}>
    <span className="analytics-empty-icon"><BarChart3 size={18} strokeWidth={1.6} /></span>
    <strong>{title}</strong><p>{detail}</p>
  </div>
}

function TrendChart({ ratios, period }) {
  const series = useMemo(() => {
    const pointsByPeriod = new Map()
    for (const row of ratios) {
      if (!row.period) continue
      const existing = pointsByPeriod.get(row.period) || { period: row.period }
      for (const fieldName of ['revenue', 'net_income']) {
        const inputs = (row.input_values || []).filter((item) => item.field_name === fieldName && number(item.value))
        const unique = [...new Set(inputs.map((item) => `${item.value}|${item.currency || ''}|${item.unit || ''}`))]
        if (unique.length === 1) {
          const [value, currency, unit] = unique[0].split('|')
          if (existing[fieldName] === undefined || existing[fieldName] === Number(value)) {
            existing[fieldName] = Number(value)
            existing[`${fieldName}Unit`] = `${currency || ''} ${unit || ''}`.trim()
          } else {
            delete existing[fieldName]
          }
        }
      }
      pointsByPeriod.set(row.period, existing)
    }
    const points = [...pointsByPeriod.values()].sort((a, b) => String(a.period).localeCompare(String(b.period)))
    const revenue = points.filter((point) => number(point.revenue))
    const profit = points.filter((point) => number(point.net_income))
    return { points, revenue, profit }
  }, [ratios])

  if (!series.points.length) return <EmptyBlock title="Awaiting financial data" detail="Revenue and profitability trends will appear when the uploaded statement contains mapped, period-aligned values." />
  const currencies = new Set(series.points.flatMap((point) => [point.revenueUnit, point.net_incomeUnit]).filter(Boolean))
  const incompatibleUnits = currencies.size > 1
  const visibleSeries = incompatibleUnits ? series.revenue.length ? [['Revenue', series.revenue, '#252626']] : [['Net profit', series.profit, '#b6383e']] : [
    ['Revenue', series.revenue, '#252626'], ['Net profit', series.profit, '#b6383e'],
  ].filter(([, points]) => points.length)
  const allValues = visibleSeries.flatMap(([label, values]) => values.map((point) => point[label === 'Revenue' ? 'revenue' : 'net_income'])).filter(number)
  const min = Math.min(0, ...allValues)
  const max = Math.max(1, ...allValues)
  const x = (index, count) => count <= 1 ? 54 : 54 + index * (650 / (count - 1))
  const y = (value) => 204 - ((value - min) / (max - min || 1)) * 174
  const createPath = (name, data) => data.map((point, index) => `${index ? 'L' : 'M'} ${x(series.points.indexOf(point), series.points.length)} ${y(point[name])}`).join(' ')

  return <div className="analytics-chart-wrap">
    <div className="analytics-chart-legend">{visibleSeries.map(([label, , color]) => <span key={label}><i style={{ background: color }} />{label}</span>)}
      {incompatibleUnits && <small>Series use different currencies; displaying one series at a time.</small>}
    </div>
    <div className="analytics-chart-scroll">
      <svg className="analytics-chart" viewBox="0 0 720 250" role="img" aria-label={`Financial performance trend${period ? ` for ${period}` : ''}`}>
        {[30, 88, 146, 204].map((lineY) => <line key={lineY} x1="54" x2="704" y1={lineY} y2={lineY} className="analytics-gridline" />)}
        <text x="4" y="34">{formatNumber(max, 0)}</text><text x="4" y="208">{formatNumber(min, 0)}</text>
        {visibleSeries.map(([label]) => {
          const key = label === 'Revenue' ? 'revenue' : 'net_income'
          const data = label === 'Revenue' ? series.revenue : series.profit
          return <g key={key}><path className={`analytics-series ${key}`} d={createPath(key, data)} />{data.map((point) => <circle key={`${key}-${point.period}`} cx={x(series.points.indexOf(point), series.points.length)} cy={y(point[key])} r="3.5" className={`analytics-point ${key}`} />)}</g>
        })}
        {series.points.map((point, index) => <text className="analytics-axis-label" key={point.period} x={x(index, series.points.length)} y="235" textAnchor="middle">{point.period}</text>)}
      </svg>
    </div>
    <p className="analytics-chart-footnote">Reported values · {series.points.length} period{series.points.length === 1 ? '' : 's'} · {visibleSeries.map(([label]) => label).join(' and ')}</p>
  </div>
}

function Analytics() {
  const { session } = useAuth()
  const [uploads, setUploads] = useState([])
  const [details, setDetails] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refreshCount, setRefreshCount] = useState(0)
  const [selectedUploadId, setSelectedUploadId] = useState('')
  const [selectedPeriod, setSelectedPeriod] = useState('')
  const [selectedCompany, setSelectedCompany] = useState('')

  const accessToken = session?.access_token
  const loadData = useCallback(async (signal) => {
    const response = await fetch(`${API_URL}/uploads`, { headers: { Authorization: `Bearer ${accessToken}` }, signal })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(safeDetailMessage(payload, 'Unable to load uploaded statements.'))
    const rows = Array.isArray(payload) ? payload : Array.isArray(payload?.uploads) ? payload.uploads : []
    setUploads(rows)
    setError('')
    const nextDetails = {}
    await Promise.all(rows.slice(0, 20).map(async (upload) => {
      try {
        const detailResponse = await fetch(`${API_URL}/uploads/${encodeURIComponent(upload.id)}`, { headers: { Authorization: `Bearer ${accessToken}` }, signal })
        const detailPayload = await detailResponse.json().catch(() => ({}))
        if (detailResponse.ok) nextDetails[upload.id] = detailPayload
      } catch (detailError) {
        if (detailError.name === 'AbortError') throw detailError
      }
    }))
    setDetails(nextDetails)
    setSelectedUploadId((current) => rows.some((row) => row.id === current) ? current : rows[0]?.id || '')
  }, [accessToken])

  useEffect(() => {
    const controller = new AbortController()
    Promise.resolve().then(() => loadData(controller.signal)).catch((loadError) => {
      if (loadError.name !== 'AbortError') setError(loadError.message || 'Could not reach the financial data service.')
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false)
    })
    return () => controller.abort()
  }, [loadData, refreshCount])

  const selectedUpload = uploads.find((upload) => upload.id === selectedUploadId)
  const selectedDetail = details[selectedUploadId]
  const allRatios = selectedDetail?.ratios || []
  const periods = [...new Set(allRatios.map((item) => item.period).filter(Boolean))]
  const companies = [...new Set([...allRatios.map((item) => item.company_name), selectedUpload?.company_name].filter(Boolean))]
  const effectivePeriod = periods.includes(selectedPeriod) ? selectedPeriod : periods.at(-1) || ''
  const effectiveCompany = companies.includes(selectedCompany) ? selectedCompany : companies[0] || ''
  const ratios = allRatios.filter((item) => (!effectivePeriod || item.period === effectivePeriod) && (!effectiveCompany || item.company_name === effectiveCompany))
  const ratioLookup = (identifier) => ratios.find((item) => item.ratio_identifier === identifier)
  const ratioMetric = (identifier, unit) => {
    const row = ratioLookup(identifier)
    return row?.calculation_status === 'calculated' && number(row.calculated_value)
      ? `${formatNumber(row.calculated_value)}${unit === '%' ? '%' : unit === 'x' ? '×' : ` ${unit}`}`
      : 'Not available'
  }
  const financialInput = (fieldName) => {
    const candidates = ratios.flatMap((row) => (row.input_values || []).filter((item) => item.field_name === fieldName && number(item.value)))
    const distinct = [...new Set(candidates.map((item) => `${item.value}|${item.currency || ''}|${item.unit || ''}`))]
    if (distinct.length !== 1) return null
    const [value, currency, unit] = distinct[0].split('|')
    const pretty = `${currency ? `${currency} ` : ''}${formatNumber(value)}${unit ? ` ${unit}` : ''}`
    return pretty.trim()
  }
  const periodRatios = allRatios.filter((row) => (!effectiveCompany || row.company_name === effectiveCompany))
  const qualityCount = selectedUpload?.mapping_review_count || 0
  const calculatedCount = ratios.filter((row) => row.calculation_status === 'calculated' && number(row.calculated_value)).length

  const uploadStatement = () => { window.location.assign('/fingpt?upload=1') }
  const retry = () => { setLoading(true); setError(''); setRefreshCount((count) => count + 1) }

  return <div className="fingpt-app analytics-app">
    <Sidebar />
    <main className="analytics-workspace">
      <header className="analytics-header">
        <div className="analytics-header-copy">
          <span className="analytics-eyebrow">FINSIGHT INTELLIGENCE 2.0 <i /></span>
          <h1>Financial Analytics</h1>
          <p>Understand performance, liquidity, leverage, and financial risk.</p>
        </div>
        <div className="analytics-header-actions">
          <a href="/fingpt" className="analytics-back-link"><MessageSquare size={15} /> Research chat</a>
          <button className="analytics-primary-button" type="button" onClick={uploadStatement}><Upload size={15} /> Upload financial statement</button>
        </div>
      </header>

      {error && <div className="analytics-alert" role="alert"><CircleAlert size={17} /><div><strong>Financial data could not be loaded</strong><span>{error}</span></div><button type="button" onClick={retry}><RefreshCw size={14} /> Retry</button></div>}

      <section className="analytics-toolbar" aria-label="Analytics filters">
        <div className="analytics-selection">
          <span className="analytics-select-label">STATEMENT</span>
          <label className="analytics-select-wrap"><FileText size={15} /><select aria-label="Select uploaded statement" value={selectedUploadId} onChange={(event) => { setSelectedUploadId(event.target.value); setSelectedPeriod(''); setSelectedCompany('') }} disabled={!uploads.length}>
            {uploads.length ? uploads.map((upload) => <option key={upload.id} value={upload.id}>{upload.filename}</option>) : <option value="">No statements uploaded</option>}
          </select><ChevronDown size={14} /></label>
        </div>
        <div className="analytics-selection">
          <span className="analytics-select-label">REPORTING PERIOD</span>
          <label className="analytics-select-wrap"><select aria-label="Select reporting period" value={effectivePeriod} onChange={(event) => setSelectedPeriod(event.target.value)} disabled={!periods.length}>
            {periods.length ? periods.map((period) => <option key={period} value={period}>{period}</option>) : <option value="">Not available</option>}
          </select><ChevronDown size={14} /></label>
        </div>
        <div className="analytics-selection">
          <span className="analytics-select-label">COMPANY</span>
          <label className="analytics-select-wrap"><select aria-label="Select company" value={effectiveCompany} onChange={(event) => setSelectedCompany(event.target.value)} disabled={!companies.length}>
            {companies.length ? companies.map((company) => <option key={company} value={company}>{company}</option>) : <option value="">Not available</option>}
          </select><ChevronDown size={14} /></label>
        </div>
        <button className="analytics-icon-button" type="button" aria-label="Refresh statements" onClick={retry} disabled={loading}><RefreshCw size={15} className={loading ? 'is-spinning' : ''} /></button>
      </section>

      <section className="analytics-kpis" aria-label="Key financial metrics">
        {[
          ['Revenue', financialInput('revenue'), 'Reported income statement value', 'R'],
          ['Net Profit', financialInput('net_income'), 'Reported net income value', 'NP'],
          ['Current Ratio', ratioMetric('current_ratio', 'x'), 'Current assets / current liabilities', 'CR'],
          ['Debt-to-Equity', ratioMetric('debt_to_equity', 'x'), 'Total debt / total equity', 'D/E'],
        ].map(([title, value, note, mark]) => <article className="analytics-kpi" key={title}>
          <div className="analytics-kpi-top"><span>{title}</span><i>{mark}</i></div>
          <strong className={value === 'Not available' ? 'is-unavailable' : ''}>{loading ? <span className="analytics-skeleton" /> : error ? 'Not available' : value || 'Not available'}</strong>
          <small>{note}</small>
        </article>)}
      </section>

      <section className="analytics-main-grid">
        <article className="analytics-panel analytics-performance-panel">
          <div className="analytics-panel-heading"><div><span className="analytics-section-index">01 / PERFORMANCE</span><h2>Financial performance</h2><p>Revenue and profitability across reported periods.</p></div><span className="analytics-unit-tag">Reported values</span></div>
          {loading ? <div className="analytics-loading"><LoaderCircle size={18} /> Loading statement data</div> : error ? <EmptyBlock title="Trend unavailable" detail="Retry the data request to load performance values." /> : <TrendChart ratios={periodRatios} period={effectivePeriod} />}
        </article>
        <article className="analytics-panel analytics-insights-panel">
          <div className="analytics-panel-heading"><div><span className="analytics-section-index">02 / INTELLIGENCE</span><h2>Key financial insights</h2><p>Evidence-led observations from this statement.</p></div><ArrowUpRight size={16} /></div>
          {loading ? <div className="analytics-loading"><LoaderCircle size={18} /> Reviewing available results</div> : error ? <EmptyBlock compact title="Insights unavailable" detail="Data could not be retrieved from the financial service." /> : calculatedCount > 0 ? <div className="analytics-insight-ready"><span className="analytics-insight-mark">{calculatedCount.toString().padStart(2, '0')}</span><div><strong>Calculated metrics available</strong><p>{calculatedCount} ratio result{calculatedCount === 1 ? '' : 's'} are available for {effectivePeriod || 'this statement'}. Review the source-linked ratio values below.</p></div></div> : <EmptyBlock compact title="Awaiting financial data" detail="Insights will appear after a statement is processed and supported financial inputs are mapped." />}
          <div className="analytics-insight-foot"><span>ANALYSIS STATUS</span><strong>{loading ? 'Loading' : error ? 'Unavailable' : calculatedCount ? 'Results available' : 'Awaiting data'}</strong></div>
        </article>
      </section>

      <section className="analytics-panel analytics-ratios-panel">
        <div className="analytics-panel-heading"><div><span className="analytics-section-index">03 / FINANCIAL RATIOS</span><h2>Financial ratios</h2><p>Formula-driven results only. Availability depends on mapped source line items and comparable periods.</p></div><span className="analytics-result-count">{loading ? 'Loading' : `${calculatedCount} available`}</span></div>
        {loading ? <div className="analytics-loading"><LoaderCircle size={18} /> Loading ratio results</div> : error ? <EmptyBlock compact title="Ratios unavailable" detail="Retry after the financial data service is available." /> : <div className="analytics-ratio-grid">{RATIO_GROUPS.map((group) => <section className="analytics-ratio-group" key={group.title}>
          <div className="analytics-ratio-group-title"><h3>{group.title}</h3><p>{group.description}</p></div>
          <ul>{group.ratios.map(([identifier, label, explanation, unit]) => {
            const row = ratioLookup(identifier)
            const available = row?.calculation_status === 'calculated' && number(row.calculated_value)
            return <li key={identifier}><div><strong>{label}</strong><small>{explanation}</small></div><div className="analytics-ratio-value"><strong className={available ? '' : 'is-unavailable'}>{available ? `${formatNumber(row.calculated_value)}${unit === '%' ? '%' : unit === 'x' ? '×' : ` ${unit}`}` : 'Not available'}</strong><small>{available ? unit : row?.reason || 'Awaiting mapped inputs'}</small></div></li>
          })}</ul>
        </section>)}</div>}
      </section>

      <section className="analytics-quality-grid">
        <article className="analytics-panel analytics-quality-panel"><div className="analytics-panel-heading"><div><span className="analytics-section-index">04 / VALIDATION</span><h2>Data quality &amp; mapping review</h2><p>Source mapping status from statement processing.</p></div><ArrowDownToLine size={16} /></div>
          {loading ? <div className="analytics-loading"><LoaderCircle size={18} /> Checking validation status</div> : error ? <EmptyBlock compact title="Validation unavailable" detail="Data quality details could not be loaded." /> : selectedUpload ? <div className="analytics-quality-status"><span className={`analytics-status-mark${qualityCount ? ' needs-review' : ''}`}>{qualityCount ? <CircleAlert size={17} /> : '✓'}</span><div><strong>{qualityCount ? `${qualityCount} item${qualityCount === 1 ? '' : 's'} need mapping review` : 'No mapping review items reported'}</strong><p>{selectedUpload.error_message || (qualityCount ? 'Review flagged line items before relying on derived ratios.' : 'Validation reflects the processing status returned by the upload service.')}</p></div><span className={`analytics-status-pill status-${selectedUpload.status || 'unknown'}`}>{(selectedUpload.status || 'unknown').replace('_', ' ')}</span></div> : <EmptyBlock compact title="Awaiting financial data" detail="Validation results will appear after a financial statement is processed." />}
        </article>
        <article className="analytics-panel analytics-data-context"><span className="analytics-section-index">DATA CONTEXT</span><h2>{selectedUpload?.filename || 'No selected statement'}</h2><dl><div><dt>Reporting period</dt><dd>{effectivePeriod || 'Not available'}</dd></div><div><dt>Uploaded</dt><dd>{formatDate(selectedUpload?.created_at)}</dd></div><div><dt>Rows processed</dt><dd>{selectedUpload?.row_count ?? 'Not available'}</dd></div><div><dt>Source</dt><dd>Uploaded statement</dd></div></dl></article>
      </section>

      <section className="analytics-panel analytics-fields-panel">
        <div className="analytics-panel-heading"><div><span className="analytics-section-index">DISCOVERED SOURCE SCHEMA</span><h2>Fields found in this statement</h2><p>Original headers remain available alongside candidate names and conservative type inference.</p></div><span className="analytics-result-count">{selectedDetail?.discovered_fields?.length ?? 0} fields</span></div>
        {loading ? <div className="analytics-loading"><LoaderCircle size={18} /> Loading discovered fields</div> : error ? <EmptyBlock compact title="Field catalog unavailable" detail="Retry to load the source field catalog." /> : selectedDetail?.discovered_fields?.length ? <div className="analytics-fields-table-wrap"><table><thead><tr><th>Original source header</th><th>Candidate identifier</th><th>Inferred type</th><th>Interpretation</th></tr></thead><tbody>{selectedDetail.discovered_fields.map((field) => <tr key={`${field.ordinal}-${field.source_header}`}><td><strong title={field.source_header}>{field.source_header}</strong></td><td><code>{field.candidate_identifier}</code></td><td>{field.inferred_type}</td><td>{field.mapping_status === 'metadata' ? 'Context metadata' : field.mapping_status === 'mapped' ? `Mapped: ${field.canonical_identifier}` : field.mapping_status === 'unmapped' ? 'Stored as custom field' : `${field.mapping_status} · review required`}</td></tr>)}</tbody></table></div> : <EmptyBlock title="No discovered fields yet" detail="Field names and types will appear after a statement is uploaded and processed." />}
      </section>

      <section className="analytics-panel analytics-statements-panel">
        <div className="analytics-panel-heading"><div><span className="analytics-section-index">05 / SOURCE FILES</span><h2>Uploaded statements</h2><p>Recent statements associated with your account.</p></div><button type="button" className="analytics-text-button" onClick={uploadStatement}><Upload size={14} /> Upload statement</button></div>
        {loading ? <div className="analytics-loading"><LoaderCircle size={18} /> Loading uploaded statements</div> : error ? <EmptyBlock compact title="Statements unavailable" detail="Retry to refresh your uploaded statement list." /> : uploads.length ? <div className="analytics-table-wrap"><table><thead><tr><th>Filename</th><th>Upload date</th><th>Reporting period</th><th>Processing status</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{uploads.slice(0, 20).map((upload) => {
          const uploadDetail = details[upload.id]
          const uploadPeriods = [...new Set((uploadDetail?.ratios || []).map((row) => row.period).filter(Boolean))]
          return <tr key={upload.id}><td><span className="analytics-file-cell"><FileText size={16} /><strong title={upload.filename}>{upload.filename}</strong></span></td><td>{formatDate(upload.created_at)}</td><td>{uploadPeriods.length ? uploadPeriods.join(', ') : 'Not available'}</td><td><span className={`analytics-status-pill status-${upload.status || 'unknown'}`}>{(upload.status || 'unknown').replace('_', ' ')}</span></td><td><button type="button" className="analytics-view-button" onClick={() => { setSelectedUploadId(upload.id); setSelectedPeriod(''); setSelectedCompany('') }} aria-label={`View ${upload.filename}`}>View</button></td></tr>
        })}</tbody></table></div> : <EmptyBlock title="No statements uploaded" detail="Upload a financial statement through Research Chat to see processing status and supported metrics here." />}
        {uploads.length > 20 && <p className="analytics-table-footnote">Showing the 20 most recent statements.</p>}
      </section>

      <section className="analytics-future-section"><div className="analytics-future-heading"><div><span className="analytics-section-index">06 / ROADMAP</span><h2>Future intelligence modules</h2></div><span>Planned capabilities</span></div><div className="analytics-future-grid">{[
        ['Financial Distress & Risk Models', 'Risk model coverage and transparent model documentation.'],
        ['Valuation & Investment Analysis', 'Valuation methods grounded in reported financials.'],
        ['Accounting Standards & Research', 'Reference material for accounting and disclosure review.'],
        ['Historical Events & News Intelligence', 'Company events and news in historical context.'],
      ].map(([title, description], index) => <article className="analytics-future-card" key={title}><span>0{index + 1}</span><div><h3>{title}</h3><p>{description}</p></div><small>PLANNED</small></article>)}</div></section>
      <footer className="analytics-footer"><span>FinSight Intelligence</span><span>Metrics reflect processed statement data; unavailable values are not inferred.</span></footer>
    </main>
  </div>
}

export default Analytics
