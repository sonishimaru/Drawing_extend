import * as THREE from 'three';
import type { MaterialDef } from '../materials';
import { materialTexture } from './textures';

/** Physically based material for a catalogue entry, with surface detail from its texture. */
export function makeMaterial(m: MaterialDef): THREE.Material {
  const tex = materialTexture(m);
  if (m.transmission) {
    return new THREE.MeshPhysicalMaterial({
      color: m.color,
      roughness: m.roughness,
      metalness: 0,
      transmission: m.transmission,
      thickness: 0.004,
      ior: 1.49,
      specularIntensity: 1,
      clearcoat: 0.6,
      clearcoatRoughness: 0.05,
    });
  }
  const mat = new THREE.MeshPhysicalMaterial({
    color: tex ? '#ffffff' : m.color,
    map: tex?.map ?? null,
    roughness: m.roughness,
    metalness: m.metalness,
  });
  if (!tex) return mat;
  // The pattern doubles as surface relief and gloss variation.
  mat.bumpMap = tex.data;
  mat.roughnessMap = tex.data;
  switch (m.texture) {
    case 'wood':
      mat.bumpScale = 0.6;
      // Oiled finish: a faint sheen on top of the grain.
      mat.clearcoat = 0.12;
      mat.clearcoatRoughness = 0.5;
      break;
    case 'brushed':
      mat.bumpScale = 0.15;
      mat.anisotropy = 0.7;
      mat.envMapIntensity = 1.2;
      break;
    case 'marble':
      mat.bumpScale = 0.05;
      mat.clearcoat = 0.7;
      mat.clearcoatRoughness = 0.08;
      break;
    case 'granite':
      mat.bumpScale = 0.4;
      mat.clearcoat = 0.3;
      mat.clearcoatRoughness = 0.2;
      break;
    case 'concrete':
      mat.bumpScale = 1.6;
      break;
    case 'plaster':
      mat.bumpScale = 0.5;
      mat.sheen = 0.3;
      mat.sheenColor = new THREE.Color('#ffffff');
      mat.sheenRoughness = 0.9;
      break;
  }
  return mat;
}
