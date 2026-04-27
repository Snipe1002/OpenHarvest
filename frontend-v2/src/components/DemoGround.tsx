/**
 * DemoGround — large flat grass plane. Receives shadows.
 */
export default function DemoGround() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
      <planeGeometry args={[100, 100]} />
      <meshStandardMaterial color="#4a6b3a" roughness={0.9} metalness={0} />
    </mesh>
  )
}
