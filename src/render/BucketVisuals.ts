import {
  BufferGeometry,
  CircleGeometry,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Line,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Scene,
  Vector3,
} from 'three';
import { Bucket } from '../missions/Bucket';

const HEIGHT = 1.5;
const RADIUS = 1.0;

const line = (n: number): BufferGeometry => {
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(new Float32Array(n * 3), 3));
  return g;
};

/** The collapsible water bucket, its slings and its long line. */
export class BucketVisuals {
  private readonly root = new Group();
  private readonly body = new Group();
  private readonly water: Mesh;
  private readonly rope: Line;
  private readonly slings: LineSegments;
  private readonly apex = new Vector3();

  constructor(scene: Scene) {
    const shell = new Mesh(
      new CylinderGeometry(RADIUS, RADIUS * 0.72, HEIGHT, 16, 1, true),
      new MeshLambertMaterial({ color: 0xd8321f, side: DoubleSide }),
    );
    shell.position.y = HEIGHT / 2;
    shell.castShadow = true;
    const band = new Mesh(
      new CylinderGeometry(RADIUS * 1.01, RADIUS * 0.96, 0.3, 16, 1, true),
      new MeshLambertMaterial({ color: 0xf2f0ea, side: DoubleSide }),
    );
    band.position.y = HEIGHT - 0.3;
    const floor = new Mesh(new CircleGeometry(RADIUS * 0.72, 16), new MeshLambertMaterial({ color: 0x8e2417 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0.02;
    this.water = new Mesh(
      new CircleGeometry(RADIUS * 0.95, 16),
      new MeshBasicMaterial({ color: 0x4aa3d6, transparent: true, opacity: 0.85 }),
    );
    this.water.rotation.x = -Math.PI / 2;
    this.body.add(shell, band, floor, this.water);

    const ropeMaterial = new LineBasicMaterial({ color: 0x1c1c1c });
    this.rope = new Line(line(2), ropeMaterial);
    this.rope.frustumCulled = false;
    this.slings = new LineSegments(line(6), ropeMaterial);
    this.slings.frustumCulled = false;
    this.root.add(this.body, this.rope, this.slings);
    scene.add(this.root);
  }

  setVisible(visible: boolean): void {
    this.root.visible = visible;
  }

  update(bucket: Bucket, hook: Vector3): void {
    // The bucket collapses as it empties.
    const open = 0.35 + 0.65 * Math.max(bucket.fill, bucket.dropping ? 0.3 : 0);
    this.body.position.set(bucket.x, bucket.y, bucket.z);
    this.body.scale.set(0.7 + 0.3 * open, open, 0.7 + 0.3 * open);
    this.water.visible = bucket.fill > 0.02;
    this.water.position.y = 0.1 + bucket.fill * (HEIGHT - 0.35);

    const top = HEIGHT * open;
    this.apex.set(bucket.x, bucket.y + top + 1.3, bucket.z);
    const slings = this.slings.geometry.getAttribute('position');
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      slings.setXYZ(i * 2, this.apex.x, this.apex.y, this.apex.z);
      slings.setXYZ(i * 2 + 1, bucket.x + Math.cos(a) * RADIUS * (0.7 + 0.3 * open), bucket.y + top, bucket.z + Math.sin(a) * RADIUS * (0.7 + 0.3 * open));
    }
    slings.needsUpdate = true;
    const rope = this.rope.geometry.getAttribute('position');
    rope.setXYZ(0, hook.x, hook.y, hook.z);
    rope.setXYZ(1, this.apex.x, this.apex.y, this.apex.z);
    rope.needsUpdate = true;
  }
}
