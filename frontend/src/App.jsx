import './App.css'

const menuGroups = [
  {
    label: 'Dashboard',
    items: [
      { icon: 'DB', name: 'Default' },
      { icon: 'AN', name: 'Analytics' },
      { icon: 'FI', name: 'Finance', active: true },
    ],
  },
  {
    label: 'Workspace',
    items: [
      { icon: 'ST', name: 'Statistics' },
      { icon: 'DT', name: 'Data' },
      { icon: 'CH', name: 'Charts' },
      { icon: 'US', name: 'Users' },
    ],
  },
  {
    label: 'Support',
    items: [
      { icon: 'ML', name: 'Mail' },
      { icon: 'CL', name: 'Calendar' },
      { icon: 'TS', name: 'Tasks' },
    ],
  },
]

const cardTransactions = [
  { code: 'AI', company: 'Apple Inc.', ref: '#ABLE-PRO-T00232', amount: '$210,000', change: '+10.6%', tone: 'up' },
  { code: 'SM', company: 'Spotify Music', ref: '#ABLE-PRO-T10232', amount: '-$10,000', change: '-30.6%', tone: 'down' },
  { code: 'MD', company: 'Medium', ref: '06:30 pm', amount: '-$26', change: '-5.0%', tone: 'down' },
  { code: 'UB', company: 'Uber', ref: '08:40 pm', amount: '+$210,000', change: '+10.6%', tone: 'up' },
]

const summaryCards = [
  {
    title: 'Transactions',
    range: '2-31 July 2023',
    amount: '$650k',
    caption: 'Compare to last week',
    trend: 'up',
    values: [18, 24, 20, 32, 29, 39, 36],
  },
  {
    title: 'Transactions',
    range: '2-31 July 2023',
    amount: '$650k',
    caption: 'Auto-invest wallet',
    trend: 'down',
    values: [33, 29, 31, 24, 18, 22, 16],
  },
  {
    title: 'Transactions',
    range: '2-31 July 2023',
    amount: '$650k',
    caption: 'Recurring transfer flow',
    trend: 'up',
    values: [14, 18, 21, 19, 25, 31, 40],
  },
]

const cashflow = [
  { month: 'Jan', income: 62, expense: 34 },
  { month: 'Feb', income: 48, expense: 28 },
  { month: 'Mar', income: 76, expense: 44 },
  { month: 'Apr', income: 58, expense: 30 },
  { month: 'May', income: 88, expense: 52 },
  { month: 'Jun', income: 72, expense: 46 },
  { month: 'Jul', income: 94, expense: 58 },
]

const spending = [
  { title: 'Food & Drink', percent: 65, amount: '$1000', hue: 'violet' },
  { title: 'Travel', percent: 30, amount: '$400', hue: 'blue' },
  { title: 'Shopping', percent: 52, amount: '$900', hue: 'teal' },
  { title: 'Healthcare', percent: 26, amount: '$250', hue: 'amber' },
]

const accounts = [
  { name: 'Primary Account', state: 'Active', balance: '12,920.000', currency: 'US Dollar' },
  { name: 'Travel Account', state: 'Active', balance: '8,540.000', currency: 'US Dollar' },
]

const contacts = ['AS', 'JW', 'MK', 'RP', '+8']

const quickTransfer = [
  { merchant: 'Starbucks Cafe', date: '11th Sep 2020', amount: '-$26', tone: 'down' },
  { merchant: 'Adobe Inc.', date: '11th Sep 2020', amount: '-$750.00', tone: 'down' },
  { merchant: 'Freelance Payout', date: '11th Sep 2020', amount: '+$420.00', tone: 'up' },
]

const categoryBreakdown = [
  { label: 'Spend', value: 44, color: '#673ab7' },
  { label: 'Saving', value: 38, color: '#2196f3' },
  { label: 'Income', value: 18, color: '#2db87c' },
]

const historyRows = [
  { user: 'Airi Satou', category: 'Transfer', date: '12 Jan 2024, 08:32', amount: '$1,200.00', status: 'Completed' },
  { user: 'Ashton Cox', category: 'Shopping', date: '12 Jan 2024, 09:15', amount: '$280.00', status: 'Pending' },
  { user: 'Bradley Greer', category: 'Travel', date: '12 Jan 2024, 10:02', amount: '$860.00', status: 'In Progress' },
  { user: 'Brielle Williamson', category: 'Healthcare', date: '12 Jan 2024, 11:44', amount: '$120.00', status: 'Canceled' },
  { user: 'Dai Rios', category: 'Salary', date: '12 Jan 2024, 13:21', amount: '$3,400.00', status: 'Completed' },
]

function buildPolyline(values, width = 180, height = 64) {
  const max = Math.max(...values)
  const min = Math.min(...values)
  const span = max - min || 1

  return values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * width
      const y = height - ((value - min) / span) * (height - 10) - 5
      return `${x},${y}`
    })
    .join(' ')
}

function Sparkline({ values, tone }) {
  return (
    <svg className="sparkline" viewBox="0 0 180 64" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id={`gradient-${tone}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={tone === 'down' ? '#ef5350' : '#2db87c'} stopOpacity="0.3" />
          <stop offset="100%" stopColor={tone === 'down' ? '#ef5350' : '#2db87c'} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polyline points={buildPolyline(values)} className={`sparkline-stroke ${tone}`} />
    </svg>
  )
}

function StatusPill({ status }) {
  const tone = status.toLowerCase().replace(/\s+/g, '-')
  return <span className={`status-pill ${tone}`}>{status}</span>
}

function App() {
  const donutStyle = {
    background: `conic-gradient(${categoryBreakdown
      .map((item, index) => {
        const start = categoryBreakdown.slice(0, index).reduce((sum, entry) => sum + entry.value, 0)
        const end = start + item.value
        return `${item.color} ${start}% ${end}%`
      })
      .join(', ')})`,
  }

  return (
    <main className="berry-app">
      <aside className="sidebar">
        <div className="brand-row">
          <div className="brand-logo">B</div>
          <div>
            <p className="eyebrow">Berry Finance</p>
            <h1>Dashboard</h1>
          </div>
        </div>

        <nav className="sidebar-nav" aria-label="Sidebar">
          {menuGroups.map((group) => (
            <section key={group.label} className="menu-group">
              <p className="menu-label">{group.label}</p>
              {group.items.map((item) => (
                <button key={item.name} type="button" className={`menu-item ${item.active ? 'active' : ''}`}>
                  <span className="menu-icon">{item.icon}</span>
                  <span>{item.name}</span>
                </button>
              ))}
            </section>
          ))}
        </nav>

        <section className="sidebar-promo">
          <h2>Explore full code</h2>
          <p>Inspired by the Berry finance workspace, adapted into this React single-page build.</p>
          <button type="button" className="primary-button wide">
            Upgrade Workspace
          </button>
        </section>
      </aside>

      <div className="shell">
        <header className="topbar">
          <div className="topbar-left">
            <button type="button" className="icon-button" aria-label="Open menu">
              <span />
              <span />
              <span />
            </button>
            <label className="search-shell">
              <input type="search" placeholder="Search here..." />
              <button type="button" className="filter-button">
                FX
              </button>
            </label>
          </div>

          <div className="topbar-actions">
            <button type="button" className="round-button">EN</button>
            <button type="button" className="round-button">NT</button>
            <button type="button" className="round-button accent">PR</button>
            <button type="button" className="profile-button">
              <span className="avatar-dot">JD</span>
              <span className="profile-gear">ST</span>
            </button>
          </div>
        </header>

        <div className="content-shell">
          <section className="page-header">
            <div>
              <p className="eyebrow">Finance</p>
              <h2>Finance</h2>
            </div>
            <div className="breadcrumb-row">
              <span>Home</span>
              <span>Dashboard</span>
              <strong>Finance</strong>
            </div>
          </section>

          <section className="hero-grid">
            <article className="panel card-stack">
              <div className="panel-head">
                <h3>My Card</h3>
                <button type="button" className="ghost-button">
                  More
                </button>
              </div>

              <div className="credit-card">
                <div className="card-orb top" />
                <div className="card-orb bottom" />
                <p className="card-label">CARD NAME</p>
                <h4>Jonh Smith</h4>
                <p className="card-number">**** **** **** **** 8361</p>
                <div className="card-meta-row">
                  <div>
                    <span>EXP</span>
                    <strong>7/30</strong>
                  </div>
                  <div>
                    <span>CVV</span>
                    <strong>455</strong>
                  </div>
                </div>
                <div className="card-balance">
                  <strong>$1.480.000</strong>
                  <span>Total Balance</span>
                </div>
              </div>

              <div className="panel-head compact">
                <h3>Transactions</h3>
                <button type="button" className="ghost-button">
                  View all
                </button>
              </div>

              <div className="transaction-list">
                {cardTransactions.map((item) => (
                  <article key={item.company} className="transaction-item">
                    <span className={`code-badge ${item.tone}`}>{item.code}</span>
                    <div className="transaction-copy">
                      <strong>{item.company}</strong>
                      <span>{item.ref}</span>
                    </div>
                    <div className="transaction-metrics">
                      <strong>{item.amount}</strong>
                      <span className={item.tone === 'up' ? 'positive' : 'negative'}>{item.change}</span>
                    </div>
                  </article>
                ))}
              </div>
            </article>

            <div className="hero-main">
              <div className="summary-grid">
                {summaryCards.map((card, index) => (
                  <article key={`${card.title}-${index}`} className="panel summary-card">
                    <div className="summary-copy">
                      <p>{card.title}</p>
                      <span>{card.range}</span>
                      <h3>{card.amount}</h3>
                      <small>{card.caption}</small>
                    </div>
                    <Sparkline values={card.values} tone={card.trend} />
                  </article>
                ))}
              </div>

              <article className="panel cashflow-card">
                <div className="panel-head">
                  <div>
                    <p className="eyebrow">Overview</p>
                    <h3>Cashflow</h3>
                  </div>
                  <div className="cashflow-meta">
                    <span className="delta-pill">5.44%</span>
                    <button type="button" className="ghost-button">
                      Monthly
                    </button>
                  </div>
                </div>

                <div className="chart-legend">
                  <span><i className="legend income" />Income</span>
                  <span><i className="legend expense" />Expends</span>
                </div>

                <div className="cashflow-chart" aria-hidden="true">
                  {cashflow.map((item) => (
                    <div key={item.month} className="bar-cluster">
                      <div className="bar-track">
                        <span className="bar income" style={{ height: `${item.income}%` }} />
                        <span className="bar expense" style={{ height: `${item.expense}%` }} />
                      </div>
                      <small>{item.month}</small>
                    </div>
                  ))}
                </div>
              </article>
            </div>
          </section>

          <section className="dual-grid">
            <article className="panel">
              <div className="panel-head">
                <h3>Where your money go ?</h3>
                <button type="button" className="ghost-button">
                  This month
                </button>
              </div>

              <div className="spend-grid">
                {spending.map((item) => (
                  <article key={item.title} className="spend-card">
                    <div className={`spend-icon ${item.hue}`}>{item.title.slice(0, 2).toUpperCase()}</div>
                    <div className="spend-copy">
                      <strong>{item.title}</strong>
                      <span>{item.percent}%</span>
                    </div>
                    <div className="progress-track">
                      <span className={`progress-fill ${item.hue}`} style={{ width: `${item.percent}%` }} />
                    </div>
                    <strong className="spend-amount">{item.amount}</strong>
                  </article>
                ))}
              </div>
            </article>

            <article className="panel">
              <div className="panel-head">
                <h3>Accounts</h3>
                <button type="button" className="primary-button">
                  + Add New
                </button>
              </div>

              <div className="account-list">
                {accounts.map((account) => (
                  <article key={account.name} className="account-card">
                    <div>
                      <p>{account.name}</p>
                      <span>{account.state}</span>
                    </div>
                    <div className="account-metrics">
                      <strong>{account.balance}</strong>
                      <small>{account.currency}</small>
                    </div>
                  </article>
                ))}
              </div>

              <button type="button" className="secondary-button wide large-cta">
                + Add to Account
              </button>
            </article>
          </section>

          <section className="dual-grid lower-grid">
            <article className="panel">
              <div className="panel-head">
                <h3>Quick Transfer</h3>
                <button type="button" className="ghost-button">
                  Send
                </button>
              </div>

              <div className="contact-row">
                {contacts.map((item) => (
                  <span key={item} className="contact-pill">{item}</span>
                ))}
              </div>

              <div className="transfer-list">
                {quickTransfer.map((item) => (
                  <article key={`${item.merchant}-${item.amount}`} className="transfer-item">
                    <div>
                      <strong>{item.merchant}</strong>
                      <span>{item.date}</span>
                    </div>
                    <strong className={item.tone === 'up' ? 'positive' : 'negative'}>{item.amount}</strong>
                  </article>
                ))}
              </div>
            </article>

            <article className="panel category-panel">
              <div className="panel-head">
                <h3>Category</h3>
                <button type="button" className="ghost-button">
                  Details
                </button>
              </div>

              <div className="category-body">
                <div className="donut-chart" style={donutStyle}>
                  <div className="donut-hole">
                    <strong>100%</strong>
                    <span>Flow Mix</span>
                  </div>
                </div>

                <div className="category-legend">
                  {categoryBreakdown.map((item) => (
                    <article key={item.label} className="legend-row">
                      <span className="legend-copy">
                        <i style={{ backgroundColor: item.color }} />
                        {item.label}
                      </span>
                      <strong>{item.value}%</strong>
                    </article>
                  ))}
                </div>
              </div>
            </article>
          </section>

          <section className="panel history-panel">
            <div className="panel-head">
              <h3>Transaction History</h3>
              <button type="button" className="ghost-button">
                Export CSV
              </button>
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>User Name</th>
                    <th>Category</th>
                    <th>Date/Time</th>
                    <th>Amount</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {historyRows.map((row) => (
                    <tr key={`${row.user}-${row.date}`}>
                      <td>
                        <div className="user-cell">
                          <span className="user-avatar">{row.user.slice(0, 2).toUpperCase()}</span>
                          <strong>{row.user}</strong>
                        </div>
                      </td>
                      <td>{row.category}</td>
                      <td>{row.date}</td>
                      <td>{row.amount}</td>
                      <td><StatusPill status={row.status} /></td>
                      <td>
                        <div className="table-actions">
                          <button type="button">VW</button>
                          <button type="button">ED</button>
                          <button type="button">DL</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </div>
    </main>
  )
}

export default App
