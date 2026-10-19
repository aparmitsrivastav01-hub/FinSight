
import { useEffect, useRef } from 'react'
import './WhoWeAre.css'

const headlineWords =
  'We help accounting and finance professionals see the full picture behind every company.'.split(' ')

const tickerText =
  'ACCOUNTING · COMPANY DATA · FINANCIAL ANALYSIS · RISK FLAGS · LIVE SIGNALS · CLEAR DECISIONS'
const tickerCopies = [0, 1, 2]

export default function WhoWeAre() {
  const sectionRef = useRef(null)

  useEffect(() => {
    const section = sectionRef.current
    if (!section) return

    let frame = 0
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const words = section.querySelectorAll('.about-headline-word')

    const update = () => {
      if (reducedMotion.matches || frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        const rect = section.getBoundingClientRect()
        const sectionStart = rect.top + window.scrollY
        const animationDistance = Math.max(1, window.innerHeight * 0.18)
        const progress = Math.max(0, Math.min(
          1,
          (window.scrollY - sectionStart) / animationDistance
        ))

        const smooth = (value) => {
          const bounded = Math.max(0, Math.min(1, value))
          return bounded * bounded * (3 - 2 * bounded)
        }

        words.forEach((word, index) => {
          const reverseWordIndex = words.length - 1 - index
          const wordStart = (reverseWordIndex / Math.max(1, words.length - 1)) * 0.8
          const wordProgress = smooth((progress - wordStart) / 0.2)
          word.style.setProperty('--word-tone', `${wordProgress * 100}%`)
        })
      })
    }

    const handleMotionPreference = () => {
      if (reducedMotion.matches) {
        cancelAnimationFrame(frame)
        frame = 0
        words.forEach((word) => word.style.setProperty('--word-tone', '0%'))
      } else {
        update()
      }
    }

    update()
    window.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    reducedMotion.addEventListener('change', handleMotionPreference)

    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
      reducedMotion.removeEventListener('change', handleMotionPreference)
    }
  }, [])

  const closeVideo = () => {
    document.getElementById('about-video-player')?.close()
  }

  return (
    <section className="who-we-are" id="about" ref={sectionRef}>
      <div className="about-intro">
        <p className="about-eyebrow">
          <span>001</span>
          <i />
          WHO WE ARE
        </p>

        <h2
          className="about-headline"
          aria-label="We help accounting and finance professionals see the full picture behind every company."
        >
          {headlineWords.map((word, index) => (
            <span className="about-headline-word" key={`${word}-${index}`}>
              {word}{index < headlineWords.length - 1 ? ' ' : ''}
            </span>
          ))}
        </h2>

      </div>

      <div className="about-visual">
        <div className="about-typography" aria-hidden="true">
          <div className="about-ticker-track">
            {tickerCopies.map((copy) => (
              <span className="about-ticker-copy" key={copy}>
                {tickerText}
              </span>
            ))}
          </div>
        </div>

        <button
          className="about-video"
          type="button"
          aria-label="See how FinSight works"
          onClick={() =>
            document.getElementById('about-video-player')?.showModal()
          }
        >
          <div className="video-art">
            <div className="video-window">
              <div className="video-topbar">
                <span className="video-brand">FinSight</span>
                <span>FINANCIAL INTELLIGENCE</span>
                <span className="video-status">
                  <i /> LIVE
                </span>
              </div>

              <div className="video-dashboard">
                <div className="video-report">
                  <span className="video-label">COMPANY OVERVIEW</span>
                  <strong>Financial signals.</strong>
                  <p>Data · Context · Research</p>

                  <div className="video-mini-stats">
                    <div>
                      <span>ANALYSIS</span>
                      <b>01</b>
                    </div>
                    <div>
                      <span>RISK FLAGS</span>
                      <b>02</b>
                    </div>
                  </div>
                </div>

                <div className="video-chart-area">
                  <span className="video-label">FINANCIAL TRENDS</span>
                  <div className="video-chart">
                    {[25, 39, 32, 48, 42, 62, 50, 75, 63, 88, 71].map(
                      (height, index) => (
                        <span
                          key={index}
                          style={{ height: `${height}%` }}
                        />
                      )
                    )}
                  </div>
                  <div className="video-chart-footer">
                    <span>PAST</span>
                    <span>PRESENT</span>
                    <span>SIGNAL</span>
                  </div>
                </div>
              </div>

              <div className="video-bottomline">
                CONNECTING DATA TO DECISIONS
              </div>
            </div>
          </div>

          <span className="about-play">
            <span className="play-triangle" />
          </span>
        </button>

        <p className="about-video-caption">
          See how FinSight works <span>(60 sec)</span>
        </p>
      </div>

      <dialog
        id="about-video-player"
        className="about-video-dialog"
        onClick={(event) => {
          if (event.target === event.currentTarget) closeVideo()
        }}
      >
        <button
          type="button"
          className="about-dialog-close"
          onClick={closeVideo}
          aria-label="Close dialog"
        >
          ×
        </button>

        <div className="about-video-placeholder">
          <span>FINSIGHT / PRODUCT DEMO</span>
          <h3>See the signal behind every financial decision.</h3>
          <p>
            Replace this placeholder with your actual product
            walkthrough when your recording is ready.
          </p>
        </div>
      </dialog>

      <p className="about-footnote">
        FINANCIAL CLARITY. BETTER-INFORMED DECISIONS.
      </p>
    </section>
  )
}
