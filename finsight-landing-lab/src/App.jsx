
import { useEffect, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useMemo } from 'react'
import * as THREE from 'three'
import './App.css'
import FinGPT from './pages/FinGPT'
import Analytics from './pages/Analytics'
import Login from './pages/Login'
import { useAuth } from './context/AuthContext'
import WhoWeAre from './pages/WhoWeAre'
import WhyFinSight from './pages/WhyFinSight'


function ProtectedFinGPT() {
  const { user, loading } = useAuth()

  useEffect(() => {
    if (!loading && !user) window.location.replace('/login')
  }, [loading, user])

  if (loading || !user) {
    return <div className="auth-loading" role="status">Loading your workspace…</div>
  }

  return <FinGPT />
}

function ProtectedAnalytics() {
  const { user, loading } = useAuth()

  useEffect(() => {
    if (!loading && !user) window.location.replace('/login')
  }, [loading, user])

  if (loading || !user) {
    return <div className="auth-loading" role="status">Loading your workspace…</div>
  }

  return <Analytics />
}

function AnimatedHeadline() {
  const words = [
    'See', 'the', 'signal', 'behind',
    'every', 'financial', 'decision.',
  ]

  const [visibleWords, setVisibleWords] = useState(0)

  useEffect(() => {
    const timers = words.map((_, index) =>
      setTimeout(() => setVisibleWords(index + 1), 350 + index * 180)
    )

    return () => timers.forEach(clearTimeout)
  }, [])

  return (
    <h1 className="animated-headline">
      {words.map((word, index) => (
        <span
          key={word}
          className={`headline-word ${index < visibleWords ? 'is-visible' : ''
            }`}
        >
          {word}
        </span>
      ))}
    </h1>
  )
}

const TERRAIN_WIDTH = 40
const TERRAIN_DEPTH = 20
const TERRAIN_OFFSET_Y = -3.2

function terrainHeight(x, z, time = 0) {
  const hill = (centerX, centerZ, spreadX, spreadZ, height) =>
    height * Math.exp(
      -(((x - centerX) / spreadX) ** 2 + ((z - centerZ) / spreadZ) ** 2),
    )

  // Primary far ridge — tall peaks that dominate the background
  const broadHills =
    hill(-14.5, -7.0, 4.2, 3.2, 7.8) +   // far-left peak
    hill(-5.0, -8.5, 3.8, 3.0, 6.4) +   // left-centre back peak
    hill(5.2, -7.5, 4.4, 3.4, 8.2) +   // centre-right back peak (tallest)
    hill(14.8, -8.0, 4.0, 3.0, 7.2) +   // far-right back peak
    hill(-10.5, 1.2, 5.0, 4.0, 6.2) +   // mid-left secondary hill
    hill(0.5, 1.8, 5.2, 4.2, 5.8) +   // mid-centre secondary hill
    hill(11.0, 1.0, 4.8, 3.8, 6.6)     // mid-right secondary hill

  // Foreground ridge — dark, prominent, sweeps across lower frame
  const frontRidge =
    hill(-16.0, 6.5, 6.0, 3.5, 5.4) +
    hill(-4.5, 7.0, 5.5, 3.0, 4.8) +
    hill(6.0, 6.8, 5.8, 3.2, 5.2) +
    hill(16.5, 6.2, 5.5, 3.0, 4.6)

  // Central valley carved out (keeps hero text readable)
  const valleys =
    -hill(-9.0, -1.2, 3.8, 3.0, 2.8) -
    hill(-0.2, -1.8, 4.2, 3.4, 3.2) -
    hill(8.5, -0.8, 3.8, 3.0, 2.6) -
    hill(1.8, -5.5, 3.5, 2.4, 1.8)

  const layeredWaves =
    Math.sin(x * 0.37 + z * 0.24 + time * 0.22) * 0.52 +
    Math.cos(x * 0.64 - z * 0.28 + time * 0.17) * 0.28 +
    Math.sin(z * 0.68 + x * 0.17 + time * 0.13) * 0.18 +
    Math.sin(x * 1.02 + z * 0.48 + time * 0.1) * 0.08
  const frontSlope = -0.09 * (z + 1)
  const wave =
    Math.sin(x * 0.24 + z * 0.32 + time * 0.3) * 0.24 +
    Math.cos(x * 0.18 - z * 0.25 + time * 0.21) * 0.15

  return broadHills + frontRidge + valleys + layeredWaves + frontSlope + wave
}

function createTerrainGeometry(segmentsX, segmentsZ) {
  const vertices = (segmentsX + 1) * (segmentsZ + 1)
  const positions = new Float32Array(vertices * 3)
  const indices = new Uint32Array(segmentsX * segmentsZ * 6)
  let index = 0

  for (let row = 0; row <= segmentsZ; row++) {
    for (let column = 0; column <= segmentsX; column++) {
      const vertex = row * (segmentsX + 1) + column
      const x = (column / segmentsX - 0.5) * TERRAIN_WIDTH
      const z = (row / segmentsZ - 0.5) * TERRAIN_DEPTH
      positions[vertex * 3] = x
      positions[vertex * 3 + 1] = terrainHeight(x, z)
      positions[vertex * 3 + 2] = z
    }
  }

  for (let row = 0; row < segmentsZ; row++) {
    for (let column = 0; column < segmentsX; column++) {
      const a = row * (segmentsX + 1) + column
      const b = a + segmentsX + 1
      indices.set([a, b, a + 1, b, b + 1, a + 1], index)
      index += 6
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute(
    'position',
    new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage),
  )
  geometry.setIndex(new THREE.BufferAttribute(indices, 1))
  geometry.computeVertexNormals()
  return geometry
}

function SignalNode({ x, z, color, height, reducedMotion }) {
  const groupRef = useRef(null)
  const nodeRef = useRef(null)
  const glowRef = useRef(null)
  const materialColor = color === 'red' ? '#e3343b' : '#d8dcde'

  useFrame(({ clock }) => {
    if (groupRef.current) {
      groupRef.current.position.y = terrainHeight(x, z, reducedMotion ? 0 : clock.elapsedTime) + 0.08
    }
    if (reducedMotion) return
    const pulse = 0.82 + Math.sin(clock.elapsedTime * 1.35 + x * 0.65) * 0.18
    if (nodeRef.current) nodeRef.current.scale.setScalar(pulse)
    if (glowRef.current) glowRef.current.intensity = 0.8 + pulse * 0.85
  })

  return (
    <group ref={groupRef} position={[x, terrainHeight(x, z) + 0.08, z]}>
      <mesh position={[0, height / 2, 0]}>
        <cylinderGeometry args={[0.008, 0.008, height, 5]} />
        <meshBasicMaterial
          color={materialColor}
          transparent
          opacity={color === 'red' ? 0.48 : 0.26}
          toneMapped={false}
        />
      </mesh>
      <mesh ref={nodeRef} position={[0, height, 0]}>
        <sphereGeometry args={[color === 'red' ? 0.07 : 0.045, 14, 12]} />
        <meshBasicMaterial color={materialColor} toneMapped={false} />
        <pointLight
          ref={glowRef}
          color={materialColor}
          intensity={1}
          distance={1.8}
          decay={2}
        />
      </mesh>
    </group>
  )
}

function TerrainScene({ reducedMotion, pointerRef }) {
  const terrainRef = useRef(null)
  const meshRef = useRef(null)
  const lightRef = useRef(null)
  const { size } = useThree()
  const compact = size.width < 700
  const segmentsX = compact ? 80 : 140
  const segmentsZ = compact ? 42 : 64
  const geometry = useMemo(
    () => createTerrainGeometry(segmentsX, segmentsZ),
    [segmentsX, segmentsZ],
  )

  useEffect(() => () => geometry.dispose(), [geometry])

  useFrame(({ clock, pointer }, delta) => {
    const terrain = terrainRef.current
    if (!terrain) return

    if (!reducedMotion && meshRef.current) {
      const position = geometry.attributes.position
      for (let vertex = 0; vertex < position.count; vertex++) {
        const x = position.getX(vertex)
        const z = position.getZ(vertex)
        position.setY(vertex, terrainHeight(x, z, clock.elapsedTime))
      }
      position.needsUpdate = true
      geometry.computeVertexNormals()
    }

    if (lightRef.current && !reducedMotion) {
      lightRef.current.intensity = 2.15 + Math.sin(clock.elapsedTime * 0.22) * 0.16
    }

    const parallax = reducedMotion || compact ? 0 : 1
    const pointerX = pointerRef.current.x || pointer.x
    const pointerY = pointerRef.current.y || pointer.y
    terrain.rotation.y = THREE.MathUtils.damp(
      terrain.rotation.y,
      pointerX * 0.025 * parallax,
      1.25,
      delta,
    )
    terrain.rotation.x = THREE.MathUtils.damp(
      terrain.rotation.x,
      pointerY * 0.008 * parallax,
      1.25,
      delta,
    )
    terrain.position.x = THREE.MathUtils.damp(
      terrain.position.x,
      pointerX * 0.28 * parallax,
      1.25,
      delta,
    )
  })

  const signals = compact
    ? [
      [-9.5, 3.8, 'red', 1.1],
      [-3.2, 5.0, 'red', 0.9],
      [4.0, 4.2, 'red', 1.05],
      [9.8, 3.2, 'red', 1.2],
    ]
    : [
      // Red nodes
      [-13.5, 3.8, 'red', 1.6],
      [-7.5, 5.2, 'red', 1.1],
      [-2.5, 3.4, 'red', 1.3],
      [3.0, 5.5, 'red', 1.0],
      [8.0, 3.8, 'red', 1.45],
      [13.0, 4.8, 'red', 1.2],
      // Grey nodes — subtle depth markers
      [-10.5, 5.8, 'grey', 0.7],
      [-4.8, 4.0, 'grey', 0.6],
      [0.5, 3.0, 'grey', 0.8],
      [6.0, 5.0, 'grey', 0.55],
      [11.5, 5.5, 'grey', 0.65],
      [-16.0, 2.5, 'grey', 0.5],
      [15.5, 2.0, 'grey', 0.5],
    ]

  return (
    <>
      <directionalLight
        ref={lightRef}
        position={[-8, 12, 6]}
        intensity={2.4}
        color="#ffffff"
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-left={-22}
        shadow-camera-right={22}
        shadow-camera-top={14}
        shadow-camera-bottom={-14}
        shadow-bias={-0.0002}
      />
      <group ref={terrainRef} position={[0, TERRAIN_OFFSET_Y, compact ? 0 : 4.5]}>
        <mesh ref={meshRef} geometry={geometry} castShadow receiveShadow>
          <meshStandardMaterial
            color="#1a1c1e"
            roughness={0.82}
            metalness={0.14}
            side={THREE.DoubleSide}
          />
        </mesh>
        <mesh geometry={geometry} position={[0, 0.014, 0]} renderOrder={1}>
          <meshBasicMaterial
            color="#c0c6c9"
            wireframe
            transparent
            opacity={0.14}
            depthWrite={false}
            polygonOffset
            polygonOffsetFactor={-1}
            toneMapped={false}
          />
        </mesh>
        {signals.map(([x, z, color, height]) => (
          <SignalNode
            key={`${x}-${z}`}
            x={x}
            z={z}
            color={color}
            height={height}
            reducedMotion={reducedMotion}
          />
        ))}
      </group>
    </>
  )
}

function useReducedMotion() {
  const [reducedMotion, setReducedMotion] = useState(() =>
    window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const updatePreference = (event) => setReducedMotion(event.matches)
    query.addEventListener('change', updatePreference)
    return () => query.removeEventListener('change', updatePreference)
  }, [])

  return reducedMotion
}

function FinancialTerrain() {
  const reducedMotion = useReducedMotion()
  const pointerRef = useRef({ x: 0, y: 0 })

  useEffect(() => {
    const finePointer = window.matchMedia('(pointer: fine)')
    if (reducedMotion || !finePointer.matches) return undefined

    const updatePointer = (event) => {
      pointerRef.current.x = (event.clientX / window.innerWidth - 0.5) * 2
      pointerRef.current.y = (event.clientY / window.innerHeight - 0.5) * 2
    }
    window.addEventListener('pointermove', updatePointer, { passive: true })
    return () => window.removeEventListener('pointermove', updatePointer)
  }, [reducedMotion])

  return (
    <div className={`terrain-3d${reducedMotion ? ' is-reduced-motion' : ''}`} aria-hidden="true">
      <Canvas
        camera={{ position: [0, 7.5, 16], fov: 48, near: 0.1, far: 90 }}
        frameloop={reducedMotion ? 'demand' : 'always'}
        dpr={[1, 1.35]}
        shadows
        gl={{ antialias: true, alpha: true, powerPreference: 'low-power' }}
        fallback={<div className="terrain-fallback" />}
        onCreated={({ gl, scene, camera }) => {
          gl.shadowMap.type = THREE.PCFShadowMap
          gl.toneMapping = THREE.ACESFilmicToneMapping
          gl.shadowMap.needsUpdate = true
          camera.lookAt(0, 0.5, 0)
          scene.fog = new THREE.Fog('#e8e8e6', 22, 52)
        }}
      >
        <ambientLight intensity={0.45} color="#d8dadb" />
        <hemisphereLight args={['#c8caca', '#1e1e1e', 0.7]} />
        <TerrainScene reducedMotion={reducedMotion} pointerRef={pointerRef} />
      </Canvas>
    </div>
  )
}

function App() {
  const [menuOpen, setMenuOpen] = useState(false)
  const path = window.location.pathname

  if (path === '/login' || path === '/signup') {
    return <Login />
  }

  if (path === '/fingpt') {
    return <ProtectedFinGPT />
  }
  if (path === '/analytics') {
    return <ProtectedAnalytics />
  }
  const links = [
    { label: 'Who We Are', href: '#about' },
    { label: 'Why Choose Us', href: '#why-us' },
    { label: 'Technology Ecosystem', href: '#technology' },
    { label: "Meet the Unicorn's Mind", href: '#team' },
    { label: 'Contact Us', href: '#contact' },
  ]

  return (
    <main className="landing-page">
      <a href="/" className="nav-logo">FinSight</a>
      <nav className="navbar">
        <div className="nav-controls">
          <div className="nav-menu-wrap">
            <button
              className="menu-pill"
              onClick={() => setMenuOpen(!menuOpen)}
              aria-expanded={menuOpen}
            >
              <span className="menu-icon">{menuOpen ? '×' : '☰'}</span>
              <span>Menu</span>
            </button>

            {menuOpen && (
              <div className="menu-dropdown">
                {links.map((link) => (
                  <a
                    key={link.href}
                    href={link.href}
                    onClick={() => setMenuOpen(false)}
                  >
                    {link.label}
                  </a>
                ))}
              </div>
            )}
          </div>

          <a href="/fingpt" className="nav-template-cta">
            Try FinGPT <span>↗</span>
          </a>
        </div>
      </nav>

      <section className="hero">
        <FinancialTerrain />
        <p className="hero-brand">
          <span className="india-badge">BUILT IN INDIA</span>
        </p>
        <AnimatedHeadline />
        <p className="hero-description">
          Turn financial data into actionable insights and uncover risks with AI-powered analysis.
        </p>
        <button className="hero-cta">
          Explore FinSight <span>↗</span>
        </button>
      </section>
      <WhoWeAre />
      <WhyFinSight />
    </main>
  )
}

export default App
