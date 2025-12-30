"use client";

import { Suspense, useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { useGLTF, OrbitControls } from "@react-three/drei";
import * as THREE from "three";

function AutoFramedHand({
  url,
  spin = true,
}: {
  url: string;
  spin?: boolean;
}) {
  const group = useRef<THREE.Group>(null);
  const { scene } = useGLTF(url);

  console.log("GLTF scene:", scene);

  // Clone so we don't mutate the cached GLTF scene used elsewhere
  const hand = useMemo(() => scene.clone(true), [scene]);

  console.log("Hand clone:", hand);

  // Center & scale to a predictable size
  useEffect(() => {
    const g = group.current;
    if (!g) return;

    g.clear();
    g.add(hand);

    // Center
    const box = new THREE.Box3().setFromObject(g);
    const center = new THREE.Vector3();
    const size = new THREE.Vector3();
    box.getCenter(center);
    box.getSize(size);

    hand.position.sub(center);

    // Scale so max dimension ~ 120 units (tweak if you want)
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const scale = 120 / maxDim;
    hand.scale.setScalar(scale);
  }, [hand]);

  // Rotate in 3 axes
  useFrame((state, delta) => {
    if (!spin) return;
    const g = group.current;
    if (!g) return;
    g.rotation.x += delta * 0.6;
    g.rotation.y += delta * 0.8;
    g.rotation.z += delta * 0.4;
  });

  return <group ref={group} />;
}

export default function HandOverlay() {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        width: "400px",
        height: "400px",
        zIndex: 999999,
        pointerEvents: "auto",
      }}
    >
      <Canvas
        style={{ width: "100%", height: "100%" }}
        gl={{ alpha: true, antialias: true }}
        camera={{ position: [0, 0, 220], fov: 50, near: 0.1, far: 2000 }}
        onCreated={({ gl }) => gl.setClearColor(0x000000, 0)}
      >
        <ambientLight intensity={0.5} />
        <directionalLight position={[10, 10, 5]} intensity={1} />
        <OrbitControls enablePan={true} enableZoom={true} enableRotate={true} />
        <AutoFramedHand url="/65-rigged_hand_blend/RiggedHand.glb" />
      </Canvas>
    </div>
  );
}

useGLTF.preload("/65-rigged_hand_blend/RiggedHand.glb");
