
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import './FinGPT.css'
import {
  MessageSquare,
  LayoutDashboard,
  Bookmark,
  ChartNoAxesColumn,
  Settings,
  ArrowRight,
  Upload,
  FileText,
  X,
  UserRound,
  LogOut,
} from 'lucide-react'
import { motion } from 'motion/react'
import fsLogo from '../assets/fs-logo.png'
import FinancialTerrain from '../components/FinancialTerrain'
import { useAuth } from '../context/AuthContext'

const FINANCIAL_API_URL = (import.meta.env.VITE_FINANCIAL_API_URL || 'http://localhost:8000').replace(/\/$/, '')

function getProfile(user) {
  const metadata = [
    user?.user_metadata,
    ...(user?.identities ?? []).map((identity) => identity.identity_data),
  ].filter(Boolean)
  const readMetadata = (keys) =>
    metadata
      .flatMap((item) => keys.map((key) => item?.[key]))
      .find((value) => typeof value === 'string' && value.trim())
      ?.trim()

  const email = user?.email ?? ''
  const metadataName = readMetadata(['full_name', 'name', 'display_name'])
  const name = metadataName || email.split('@')[0] || 'Account'
  const nameParts = metadataName?.split(/\s+/).filter(Boolean) ?? []
  const initials = nameParts.length > 1
    ? `${nameParts[0][0]}${nameParts[nameParts.length - 1][0]}`.toUpperCase()
    : (nameParts[0]?.[0] || 'A').toUpperCase()

  return {
    name,
    email,
    initials,
    avatarUrl: readMetadata(['avatar_url', 'picture', 'profile_image_url']),
    provider: user?.app_metadata?.provider || user?.identities?.[0]?.provider || 'email',
  }
}

function ProfileImage({ src, initials, alt = '' }) {
  const [failedSrc, setFailedSrc] = useState(null)
  const failed = failedSrc === src

  if (src && !failed) {
    return (
      <img
        className="profile-image"
        src={src}
        alt={alt}
        referrerPolicy="no-referrer"
        onError={() => setFailedSrc(src)}
      />
    )
  }

  return <span className="profile-image-fallback" aria-hidden="true">{initials}</span>
}

function FinGPT() {
  const { user, session, signOut } = useAuth()
  const [origin, setOrigin] = useState({ x: 20, y: 20 })
  const [originHovered, setOriginHovered] = useState(false)
  const [uploadOpen, setUploadOpen] = useState(() => new URLSearchParams(window.location.search).get('upload') === '1')
  const [selectedFiles, setSelectedFiles] = useState([])
  const [uploadError, setUploadError] = useState('')
  const [isDragging, setIsDragging] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const [signOutError, setSignOutError] = useState('')
  const fileInputRef = useRef(null)
  const profileControlRef = useRef(null)
  const profileButtonRef = useRef(null)
  const accountCloseRef = useRef(null)
  const profile = getProfile(user)

  useEffect(() => {
    if (!profileOpen) return undefined
    const closeOnOutsideClick = (event) => {
      if (!profileControlRef.current?.contains(event.target)) {
        setProfileOpen(false)
      }
    }
    document.addEventListener('pointerdown', closeOnOutsideClick)
    return () => document.removeEventListener('pointerdown', closeOnOutsideClick)
  }, [profileOpen])

  useEffect(() => {
    if (!profileOpen && !accountOpen) return undefined
    const closeOnEscape = (event) => {
      if (event.key !== 'Escape') return
      setProfileOpen(false)
      setAccountOpen(false)
      profileButtonRef.current?.focus()
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [profileOpen, accountOpen])

  useEffect(() => {
    if (accountOpen) accountCloseRef.current?.focus()
  }, [accountOpen])

  async function handleSignOut() {
    setSignOutError('')
    try {
      await signOut()
      setProfileOpen(false)
      window.location.assign('/login')
    } catch (error) {
      setSignOutError(error.message || 'Unable to sign out. Please try again.')
    }
  }

  function updateSelectedFile(id, changes) {
    setSelectedFiles((currentFiles) =>
      currentFiles.map((item) => item.id === id ? { ...item, ...changes } : item),
    )
  }

  function uploadCsv(file, id) {
    if (!session?.access_token) {
      updateSelectedFile(id, {
        status: 'failed',
        error: 'Your session has expired. Sign in again before uploading.',
      })
      return
    }

    const formData = new FormData()
    formData.append('file', file)
    const request = new XMLHttpRequest()
    request.open('POST', `${FINANCIAL_API_URL}/uploads`)
    request.setRequestHeader('Authorization', `Bearer ${session.access_token}`)
    updateSelectedFile(id, { status: 'uploading', progress: 0, error: '' })

    request.upload.addEventListener('progress', (event) => {
      if (!event.lengthComputable) return
      const progress = Math.min(100, Math.round((event.loaded / event.total) * 100))
      updateSelectedFile(id, {
        status: progress >= 100 ? 'processing' : 'uploading',
        progress,
      })
    })

    request.addEventListener('load', () => {
      let response
      try {
        response = JSON.parse(request.responseText)
      } catch { /* A non-JSON response is handled as a generic API error below. */ }
      if (request.status < 200 || request.status >= 300) {
        const message = typeof response?.detail === 'string'
          ? response.detail
          : 'The upload could not be processed. Please try again.'
        updateSelectedFile(id, { status: 'failed', error: message })
        return
      }

      const upload = response.upload || {}
      updateSelectedFile(id, {
        status: upload.status || 'completed',
        progress: 100,
        uploadId: upload.id,
        mappingReviewCount: upload.mapping_review_count || 0,
        ratioCount: Array.isArray(response.ratios) ? response.ratios.length : 0,
        error: '',
      })
    })

    request.addEventListener('error', () => {
      updateSelectedFile(id, {
        status: 'failed',
        error: 'Could not reach the financial API. Check that the backend is running.',
      })
    })
    request.send(formData)
  }

  const addFiles = (fileList) => {
    const files = Array.from(fileList ?? [])
    if (!files.length) return

    const csvFiles = files.filter((file) => file.name.toLowerCase().endsWith('.csv'))
    const hasInvalidFiles = csvFiles.length !== files.length

    if (csvFiles.length) {
      const existingIds = new Set(selectedFiles.map(({ id }) => id))
      const nextFiles = csvFiles
        .map((file) => ({
          id: `${file.name}-${file.size}-${file.lastModified}`,
          file,
        }))
        .filter(({ id }) => {
          if (existingIds.has(id)) return false
          existingIds.add(id)
          return true
        })

      setSelectedFiles((currentFiles) => [
        ...currentFiles,
        ...nextFiles.map(({ id, file }) => ({ id, file, status: 'queued', progress: 0, error: '' })),
      ])
      nextFiles.forEach(({ id, file }) => uploadCsv(file, id))
    }

    setUploadError(
      hasInvalidFiles
        ? 'Only CSV files are supported. Please choose a .csv file.'
        : '',
    )
  }

  const handleFileInput = (event) => {
    addFiles(event.target.files)
    event.target.value = ''
  }

  const formatFileSize = (bytes) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  const updateOrigin = (event) => {
    const rect = event.currentTarget.getBoundingClientRect()

    setOrigin({
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    })
  }

  return (
    <div className="fingpt-app">
      <aside className="fingpt-sidebar">
        <div className="fingpt-brand">
          <img
            src={fsLogo}
            alt="FinSight logo"
            className="fingpt-logo"
          />
          <span>FinGPT</span>
        </div>

        <nav className="fingpt-navigation">
          <motion.button
            type="button"
            className="sidebar-item active"
            whileHover={{ backgroundColor: '#303132' }}
            whileTap={{ scale: 0.985 }}
            transition={{ duration: 0.16 }}
          >
            <MessageSquare size={17} strokeWidth={1.8} />
            <span>Research Chat</span>
            <span className="nav-indicator" />
          </motion.button>

          <button type="button" className="sidebar-item">
            <LayoutDashboard size={17} strokeWidth={1.8} />
            <span>Dashboard</span>
          </button>

          <button type="button" className="sidebar-item">
            <Bookmark size={17} strokeWidth={1.8} />
            <span>Saved Reports</span>
          </button>

          <button type="button" className="sidebar-item" onClick={() => window.location.assign('/analytics')}>
            <ChartNoAxesColumn size={17} strokeWidth={1.8} />
            <span>Analytics</span>
          </button>

          <button type="button" className="sidebar-item">
            <Settings size={17} strokeWidth={1.8} />
            <span>Settings</span>
          </button>
        </nav>

        <section
          className="sidebar-documents"
          aria-labelledby="uploaded-documents-title"
        >
          <div className="uploaded-documents-heading">
            <h2 id="uploaded-documents-title">Uploaded Documents</h2>
            <span>{selectedFiles.length}</span>
          </div>

          {selectedFiles.length === 0 ? (
            <p className="uploaded-empty-state">
              Your uploaded files will appear here.
            </p>
          ) : (
            <ul className="uploaded-file-list">
              {selectedFiles.map(({ id, file, status, progress, error, mappingReviewCount }) => (
                <li className="uploaded-file-item" key={id}>
                  <span className="uploaded-file-icon">
                    <FileText size={17} strokeWidth={1.7} />
                  </span>
                  <span className="uploaded-file-details">
                    <strong title={file.name}>{file.name}</strong>
                    <small>
                      CSV · {formatFileSize(file.size)} · {
                        status === 'queued' ? 'Queued' :
                          status === 'uploading' ? `Uploading ${progress}%` :
                            status === 'processing' ? 'Processing' :
                              status === 'completed' ? 'Stored' :
                                status === 'needs_review' ? 'Stored · review needed' :
                                  status === 'failed' ? 'Failed' : status
                      }
                    </small>
                    {(status === 'uploading' || status === 'processing') && (
                      <progress
                        className="upload-progress"
                        max="100"
                        value={progress}
                        aria-label={`Uploading ${file.name}`}
                      />
                    )}
                    {status === 'needs_review' && mappingReviewCount > 0 && (
                      <small className="upload-review-note">
                        {mappingReviewCount} line item{mappingReviewCount === 1 ? '' : 's'} need review.
                      </small>
                    )}
                    {error && <small className="upload-file-error" role="alert">{error}</small>}
                  </span>
                  <button
                    type="button"
                    className="remove-upload-button"
                    aria-label={`Remove ${file.name}`}
                    onClick={() => {
                      setSelectedFiles((currentFiles) =>
                        currentFiles.filter((item) => item.id !== id),
                      )
                    }}
                  >
                    <X size={15} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

      </aside>

      <main className="fingpt-workspace terrain-workspace">
        <FinancialTerrain />


        
<header className="research-header">
  <div className="research-title">
    <h2>FinGPT Intelligence 2.0</h2>

  </div>

  <button type="button" className="company-selector">
    <span className="company-mark">R</span>

    <span className="company-details">
      <strong>Reliance Industries Limited</strong>
      <small>RELIANCE · NSE</small>
    </span>

    <span className="company-chevron">⌄</span>
  </button>

  <div className="header-actions">
    <button type="button" className="export-button">
      ↓ Export report
    </button>

    <div className="profile-control" ref={profileControlRef}>
      <button
        ref={profileButtonRef}
        type="button"
        className="header-avatar"
        aria-label={`Open profile for ${profile.name}`}
        aria-haspopup="dialog"
        aria-expanded={profileOpen}
        aria-controls="profile-popover"
        onClick={() => {
          setSignOutError('')
          setProfileOpen((open) => !open)
        }}
      >
        <ProfileImage src={profile.avatarUrl} initials={profile.initials} />
      </button>

      {profileOpen && (
        <div
          className="profile-popover"
          id="profile-popover"
          role="dialog"
          aria-label="User profile"
        >
          <div className="profile-popover-identity">
            <ProfileImage
              src={profile.avatarUrl}
              initials={profile.initials}
              alt={`${profile.name} profile`}
            />
            <span className="profile-identity-copy">
              <strong title={profile.name}>{profile.name}</strong>
              <small title={profile.email}>{profile.email || 'No email address'}</small>
            </span>
          </div>

          <div className="profile-popover-divider" />
          <button
            type="button"
            className="profile-menu-option"
            onClick={() => {
              setProfileOpen(false)
              setAccountOpen(true)
            }}
          >
            <UserRound size={16} strokeWidth={1.8} />
            <span>Profile / Account</span>
          </button>
          {signOutError && <p className="profile-menu-error" role="alert">{signOutError}</p>}
          <button
            type="button"
            className="profile-menu-option profile-sign-out"
            onClick={handleSignOut}
          >
            <LogOut size={16} strokeWidth={1.8} />
            <span>Sign out</span>
          </button>
        </div>
      )}
    </div>
  </div>
</header>

        {accountOpen && createPortal(
          <div
            className="account-dialog-backdrop"
            onClick={() => setAccountOpen(false)}
          >
            <section
              className="account-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="account-dialog-title"
              onClick={(event) => event.stopPropagation()}
            >
              <header className="account-dialog-header">
                <div>
                  <h2 id="account-dialog-title">Profile / Account</h2>
                  <p>Your signed-in account details</p>
                </div>
                <button
                  ref={accountCloseRef}
                  type="button"
                  className="account-dialog-close"
                  aria-label="Close account details"
                  onClick={() => setAccountOpen(false)}
                >
                  <X size={18} />
                </button>
              </header>
              <div className="account-dialog-identity">
                <ProfileImage
                  src={profile.avatarUrl}
                  initials={profile.initials}
                  alt={`${profile.name} profile`}
                />
                <div>
                  <strong>{profile.name}</strong>
                  <span>{profile.email || 'No email address'}</span>
                </div>
              </div>
              <dl className="account-details-list">
                <div>
                  <dt>Sign-in method</dt>
                  <dd>{profile.provider === 'google' ? 'Google' : 'Email and password'}</dd>
                </div>
              </dl>
            </section>
          </div>,
          document.body,
        )}


        <motion.div
          className="chat-content"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
        >

          <h1>What would you like to understand?</h1>

          <p className="workspace-description">
            Analyze financial statements, investigate companies,
            and uncover meaningful risks.
          </p>

          <form
            className="chat-composer"
            onSubmit={(event) => event.preventDefault()}
          >
            <button
              type="button"
              className="composer-attach"
              aria-label="Upload financial data"
              aria-haspopup="dialog"
              onClick={() => setUploadOpen(true)}
            >
              <Upload size={18} strokeWidth={1.8} />
            </button>

            <textarea
              placeholder="Ask FinGPT about a company or upload financial statements..."
              rows={1}
              aria-label="Ask FinGPT"
            />

            <motion.button
              type="submit"
              className="send-button origin-send"
              aria-label="Send message"
              onPointerEnter={(event) => {
                updateOrigin(event)
                setOriginHovered(true)
              }}
              onPointerMove={updateOrigin}
              onPointerLeave={() => setOriginHovered(false)}
              whileTap={{ scale: 0.94 }}
            >
              <motion.span
                className="origin-send-fill"
                animate={{ scale: originHovered ? 1 : 0 }}
                transition={{
                  duration: originHovered ? 0.35 : 0.22,
                  ease: originHovered
                    ? [0.22, 1, 0.36, 1]
                    : [0.4, 0, 1, 1],
                }}
                style={{
                  left: origin.x,
                  top: origin.y,
                }}
              />

              <span className="origin-send-icon">
                <ArrowRight size={21} strokeWidth={2} />
              </span>
            </motion.button>
          </form>

          <div className="example-prompts">
            <button type="button">Analyze a balance sheet</button>
            <button type="button">Explain Altman Z-Score</button>
            <button type="button">Assess financial risk</button>
          </div>
        </motion.div>

        {uploadOpen && (
          createPortal(
            <div
              className="upload-dialog-backdrop"
              onClick={() => setUploadOpen(false)}
            >
              <section
                className="upload-dialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby="upload-dialog-title"
                onClick={(event) => event.stopPropagation()}
              >
              <div className="upload-dialog-header">
                <div>
                  <h2 id="upload-dialog-title">Upload Financial Data</h2>
                  <p>CSV files only (.csv)</p>
                </div>
                <button
                  type="button"
                  className="upload-close-button"
                  aria-label="Close upload dialog"
                  onClick={() => setUploadOpen(false)}
                >
                  <X size={19} />
                </button>
              </div>

              <input
                ref={fileInputRef}
                className="visually-hidden-file-input"
                type="file"
                accept=".csv,text/csv"
                multiple
                aria-hidden="true"
                tabIndex={-1}
                onChange={handleFileInput}
              />

              <div
                className={`upload-dropzone${isDragging ? ' is-dragging' : ''}`}
                role="region"
                aria-label="CSV file drop area"
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(event) => {
                  event.preventDefault()
                  setIsDragging(true)
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(event) => {
                  event.preventDefault()
                  setIsDragging(false)
                  addFiles(event.dataTransfer.files)
                }}
              >
                <span className="upload-icon-wrap">
                  <Upload size={20} strokeWidth={1.8} />
                </span>
                <strong>Drag &amp; drop your CSV here</strong>
                <span className="upload-drop-hint">or</span>
                <button
                  type="button"
                  className="browse-files-button"
                  onClick={(event) => {
                    event.stopPropagation()
                    fileInputRef.current?.click()
                  }}
                >
                  Browse Files
                </button>
              </div>

              {uploadError && (
                <p className="upload-error" role="alert">
                  {uploadError}
                </p>
              )}

              </section>
            </div>,
            document.body,
          )
        )}
      </main>
    </div>
  )
}

export default FinGPT
