import { useMemo } from 'react'
import { Canvas } from '@react-three/fiber'
import { Line } from '@react-three/drei'
import { Bloom, EffectComposer } from '@react-three/postprocessing'
import type { Scene, SimResult } from '@shared/types'
import { heatColor, isoLayout } from '@shared/layout'

export default function WarRoomScene({
  scene,
  sample,
  flat,
  focus,
  onFocus,
}: {
  scene: Scene
  sample: SimResult['samples'][number] | undefined
  flat: boolean
  focus?: string
  onFocus: (id: string) => void
}) {
  const points = useMemo(() => isoLayout(scene), [scene])
  return (
    <Canvas orthographic camera={{ position: [14, 12, 14], zoom: 32, near: -40, far: 80 }} dpr={[1, 1.5]} gl={{ antialias: true }}>
      <color attach="background" args={['#120e0a']} />
      <ambientLight intensity={0.45} />
      <directionalLight position={[6, 10, 4]} intensity={0.7} />
      <gridHelper args={[16, 16, '#3a2a14', '#3a2a14']} position={[0, -0.02, 0]} />
      {scene.edges.map((edge) => {
        const a = points[edge.from]
        const b = points[edge.to]
        if (!a || !b) return null
        return <Line key={edge.id} points={[[a.x, 0.2, a.z], [b.x, 0.2, b.z]]} color={edge.style === 'sync' ? '#ffb020' : '#2ee6c7'} lineWidth={1} />
      })}
      {scene.components.map((component) => {
        const point = points[component.id]
        if (!point) return null
        const util = Math.min(1, sample?.util[component.id] ?? 0)
        const color = heatColor(util || 0.15)
        const focused = focus === component.id
        return (
          <mesh key={component.id} position={[point.x, 0.12, point.z]} onClick={() => onFocus(component.id)}>
            <boxGeometry args={[1.15, focused ? 0.28 : 0.16, 1.15]} />
            <meshStandardMaterial color={flat ? '#1a140c' : color} emissive={flat ? '#000' : color} emissiveIntensity={focused ? 1.2 : 0.45} />
          </mesh>
        )
      })}
      {!flat ? (
        <EffectComposer>
          <Bloom luminanceThreshold={0.25} mipmapBlur intensity={0.55} />
        </EffectComposer>
      ) : null}
    </Canvas>
  )
}
