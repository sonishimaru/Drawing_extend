import * as THREE from 'three';

/**
 * A photo-studio sweep: a floor that curves up into the back wall, so there is no
 * visible horizon line. Built in local space with the wall at z = 0 and the floor at
 * y = 0; the floor runs towards +z.
 */
function sweepGeometry(width: number, depth: number, height: number, radius: number, arcSegments = 24): THREE.BufferGeometry {
  const profile: { z: number; y: number; nz: number; ny: number }[] = [];
  profile.push({ z: depth, y: 0, nz: 0, ny: 1 });
  for (let i = 0; i <= arcSegments; i++) {
    const t = (i / arcSegments) * (Math.PI / 2);
    profile.push({ z: radius - radius * Math.sin(t), y: radius - radius * Math.cos(t), nz: Math.sin(t), ny: Math.cos(t) });
  }
  profile.push({ z: 0, y: height, nz: 1, ny: 0 });
  const xs = [-width / 2, 0, width / 2];
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  for (const [j, p] of profile.entries()) {
    for (const [i, x] of xs.entries()) {
      pos.push(x, p.y, p.z);
      nor.push(0, p.ny, p.nz);
      uv.push(i / (xs.length - 1), j / (profile.length - 1));
    }
  }
  const index: number[] = [];
  for (let j = 0; j < profile.length - 1; j++) {
    for (let i = 0; i < xs.length - 1; i++) {
      const a = j * xs.length + i;
      const b = a + 1;
      const c = a + xs.length;
      const d = c + 1;
      index.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(index);
  return g;
}

export interface StageLayout {
  /** height of the floor (m) */
  floorY: number;
  /** depth of the back wall (m) */
  wallZ: number;
  /** horizontal centre of the stage (m) */
  centerX: number;
  /** characteristic size of the piece, sets the scale of everything (m) */
  span: number;
  /** what the key light aims at */
  target: THREE.Vector3;
  /** key light direction (pointing from the light towards the target) */
  keyDir: THREE.Vector3;
}

export const STUDIO_COLOR = '#dedad3';

/** Studio sweep plus a three-point light rig with soft shadows. */
export class Stage {
  readonly group = new THREE.Group();
  readonly key: THREE.DirectionalLight;
  readonly fill: THREE.HemisphereLight;
  readonly rim: THREE.DirectionalLight;
  private sweep: THREE.Mesh;
  private studioMaterial = new THREE.MeshStandardMaterial({ color: STUDIO_COLOR, roughness: 1, metalness: 0, envMapIntensity: 0.35 });
  private shadowMaterial = new THREE.ShadowMaterial({ opacity: 0.16 });

  constructor() {
    this.sweep = new THREE.Mesh(new THREE.BufferGeometry(), this.studioMaterial);
    this.sweep.receiveShadow = true;

    this.key = new THREE.DirectionalLight('#fff6ea', 1.9);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048);
    this.key.shadow.bias = -0.0003;
    this.key.shadow.normalBias = 0.0004;

    this.fill = new THREE.HemisphereLight('#f4f6ff', '#d8d0c4', 0.45);
    this.rim = new THREE.DirectionalLight('#eef3ff', 0.9);

    this.group.add(this.sweep, this.key, this.key.target, this.fill, this.rim, this.rim.target);
  }

  /** Flat drawing look: only the shadows remain, on the drawing's background colour. */
  setFlat(flat: boolean, color: string) {
    this.sweep.material = flat ? this.shadowMaterial : this.studioMaterial;
    this.studioMaterial.color.set(color);
    // Shadows need to stay visible on a dark backdrop too.
    this.shadowMaterial.opacity = new THREE.Color(color).getHSL({ h: 0, s: 0, l: 0 }).l < 0.35 ? 0.35 : 0.16;
  }

  layout(l: StageLayout) {
    const s = l.span;
    const radius = Math.min(s * 0.45, Math.max(0.02, l.target.y - l.floorY) * 0.8, Math.max(0.02, -l.wallZ + 0.05));
    this.sweep.geometry.dispose();
    this.sweep.geometry = sweepGeometry(s * 14, s * 10, s * 8, radius);
    this.sweep.position.set(l.centerX, l.floorY, l.wallZ);

    const dist = s * 3;
    this.key.position.copy(l.target).addScaledVector(l.keyDir, -dist);
    this.key.target.position.copy(l.target);
    this.rim.position.set(l.target.x + s * 1.2, l.target.y + s * 1.5, l.wallZ - s * 0.2);
    this.rim.target.position.copy(l.target);

    const cam = this.key.shadow.camera;
    const r = s * 1.4;
    cam.left = cam.bottom = -r;
    cam.right = cam.top = r;
    cam.near = dist * 0.1;
    cam.far = dist * 3;
    cam.updateProjectionMatrix();
  }
}
