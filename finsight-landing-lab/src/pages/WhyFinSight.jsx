import './WhyFinSight.css'

const valueCards = [
  {
    number: '01',
    title: 'Everything in One Place',
    lines: ['Financials, filings and company', 'news, without switching tabs.'],
    icon: 'layers',
  },
  {
    number: '02',
    title: 'Live Company Signals',
    lines: ['Real-world updates and risk flags,', 'not just last quarter’s numbers.'],
    icon: 'pulse',
  },
  {
    number: '03',
    title: 'Answers You Can Verify',
    lines: ['Every insight comes with its source,', 'so you can trust and check it.'],
    icon: 'shield',
  },
]

function ValueIcon({ type }) {
  if (type === 'layers') {
    return (
      <svg viewBox="0 0 48 48" aria-hidden="true">
        <path d="m8 16 16-9 16 9-16 9-16-9Z" />
        <path d="m8 24 16 9 16-9M8 32l16 9 16-9" />
      </svg>
    )
  }

  if (type === 'pulse') {
    return (
      <svg viewBox="0 0 48 48" aria-hidden="true">
        <path d="M5 25h8l5-12 8 24 7-18 4 6h6" />
      </svg>
    )
  }

  return (
    <svg viewBox="0 0 48 48" aria-hidden="true">
      <path d="M24 5 39 11v11c0 10-6.5 17-15 21-8.5-4-15-11-15-21V11l15-6Z" />
      <path d="m17 24 5 5 10-11" />
    </svg>
  )
}

export default function WhyFinSight() {
  return (
    <section className="why-finsight" id="why-us" aria-labelledby="why-finsight-title">
      <div className="why-finsight-inner">
        <header className="why-finsight-header">
          <p className="why-finsight-eyebrow">
            <span>002</span>
            <i aria-hidden="true" />
            <span>VALUE</span>
          </p>

          <h2 id="why-finsight-title">Why FinSight?</h2>

          <p className="why-finsight-subtitle">
            <span>We combine financial data, accounting knowledge and live company research,</span>
            <span>so you spend less time searching and more time deciding.</span>
          </p>
        </header>

        <div className="why-finsight-grid">
          {valueCards.map((card) => (
            <article className="why-finsight-card" key={card.number}>
              <div className="why-finsight-panel">
                <div className="why-finsight-icon-halo">
                  <div className="why-finsight-icon">
                    <ValueIcon type={card.icon} />
                  </div>
                </div>
                <span className="why-finsight-number">{card.number}</span>
              </div>

              <div className="why-finsight-card-copy">
                <h3>{card.title}</h3>
                <p>
                  {card.lines.map((line) => (
                    <span key={line}>{line}</span>
                  ))}
                </p>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}
