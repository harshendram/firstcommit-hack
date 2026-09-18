"use client";

import type * as THREE from "three";
import { useGLTF } from "@react-three/drei";
import React, { useEffect, useRef, useState } from "react";
import { Vector3 } from "three";

import stonesData from "@/components/world/data/data.json";
import { ASSETS } from "@/lib/assets";

type Stone = {
  id: number;
  pos: [number, number, number];
};

const stones: Stone[] = stonesData.stones.map((stone) => ({
  ...stone,
  pos: [stone.pos[0] ?? 0, stone.pos[1] ?? 0, stone.pos[2] ?? 0] as [
    number,
    number,
    number,
  ],
}));

const Stones = () => {
  const meshRefs = useRef<(THREE.Mesh | null)[]>([]);
  const [visibility, setVisibility] = useState<boolean[]>(() =>
    stones.map(() => true),
  );

  useEffect(() => {
    const storedVisibility = localStorage.getItem("stoneVisibility");
    if (storedVisibility) {
      setVisibility(JSON.parse(storedVisibility) as boolean[]);
    } else {
      const initialVisibility = stones.map(() => true);
      setVisibility(initialVisibility);
      localStorage.setItem(
        "stoneVisibility",
        JSON.stringify(initialVisibility),
      );
    }
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      const storedVisibility = localStorage.getItem("stoneVisibility");
      if (storedVisibility) {
        const parsed: boolean[] = JSON.parse(storedVisibility) as boolean[];
        if (JSON.stringify(parsed) !== JSON.stringify(visibility)) {
          setVisibility(parsed);
        }
      }
    }, 500);

    return () => clearInterval(interval);
  }, [visibility]);

  const toggleVisibility = (index: number) => {
    const newVisibility = [...visibility];
    newVisibility[index] = !newVisibility[index];
    setVisibility(newVisibility);
    localStorage.setItem("stoneVisibility", JSON.stringify(newVisibility));
  };

  return (
    <>
      {stones.map((stone, index) => (
        <mesh
          key={stone.id}
          position={new Vector3(...stone.pos)}
          scale={3.5}
          userData={{ camIgnore: true }}
          ref={(el) => {
            meshRefs.current[index] = el;
          }}
          visible={visibility[index]}
          onPointerDown={() => toggleVisibility(index)}
        >
          <Blue_Stone />
        </mesh>
      ))}
    </>
  );
};

type BlueStoneProps = {
  [key: string]: never;
};

type GLTFResult = {
  nodes: {
    Crystal_low002: THREE.Mesh;
  };
  materials: {
    Crystal: THREE.Material;
  };
};

const Blue_Stone: React.FC<BlueStoneProps> = (props) => {
  const { nodes, materials } = useGLTF(
    ASSETS.STONE,
    ASSETS.DRACO,
  ) as unknown as GLTFResult;

  return (
    <group {...props} dispose={null}>
      <mesh
        castShadow
        receiveShadow
        geometry={nodes.Crystal_low002.geometry}
        material={materials.Crystal}
        rotation={[Math.PI / 2, 0, 0]}
        scale={0.012}
      />
    </group>
  );
};

useGLTF.preload(ASSETS.STONE, ASSETS.DRACO);

export default Stones;
