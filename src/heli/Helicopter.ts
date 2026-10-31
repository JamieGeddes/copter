import {
  BufferGeometry,
  Float32BufferAttribute,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
  Scene,
} from 'three';
import { damp, smoothstep } from '../core/math';
import { FlightModel } from './FlightModel';
import { HeliSpec } from './HeliSpec';
import { animateRotor, HeliVisualParts } from './rotor';

/** Couples a flight model to its 3D representation and altitude cues. */
export class Helicopter {
  readonly flight: FlightModel;
  readonly visual: HeliVisualParts;
  private readonly marker: Mesh;
  private readonly markerMaterial: MeshBasicMaterial;
  private readonly heightLine: Line;
  private pitch = 0;
  private roll = 0;
  private time = 0;
  showHeightLine = false;

  constructor(spec: HeliSpec, visual: HeliVisualParts, scene: Scene) {
    this.flight = new FlightModel(spec);
    this.visual = visual;
    scene.add(visual.root);

    // A ring on the ground directly below helps judge position when hovering.
    this.markerMaterial = new MeshBasicMaterial({ color: 0x2a1c10, transparent: true, opacity: 0, depthWrite: false });
    this.marker = new Mesh(new RingGeometry(2.3, 2.75, 32), this.markerMaterial);
    this.marker.rotation.x = -Math.PI / 2;
    this.marker.renderOrder = 1;
    scene.add(this.marker);

    const lineGeometry = new BufferGeometry();
    lineGeometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 0, 1, 0], 3));
    this.heightLine = new Line(lineGeometry, new LineBasicMaterial({ color: 0x2a1c10, transparent: true, opacity: 0.4 }));
    this.heightLine.frustumCulled = false;
    scene.add(this.heightLine);
  }

  /** Syncs visuals with the flight state. `groundY` is the surface directly below. */
  sync(dt: number, groundY: number): void {
    const f = this.flight;
    const s = f.spec;
    this.time += dt;
    const { root, body, rotors } = this.visual;

    // Express the world-space disc tilt in the aircraft's frame.
    const sin = Math.sin(f.heading);
    const cos = Math.cos(f.heading);
    const forward = f.tiltX * sin + f.tiltZ * cos;
    const right = f.tiltX * -cos + f.tiltZ * sin;
    this.pitch = damp(this.pitch, forward * s.maxTilt, 10, dt);
    this.roll = damp(this.roll, right * s.maxTilt, 10, dt);

    const airborne = !f.landed && !f.destroyed;
    const bob = airborne ? Math.sin(this.time * 2.1) * 0.06 + Math.sin(this.time * 3.7) * 0.03 : 0;
    root.position.set(f.x, f.y + bob, f.z);
    root.rotation.y = f.heading;
    body.rotation.set(this.pitch, 0, this.roll + (f.destroyed ? 0.5 : 0));

    for (const { rotor, speed } of rotors) animateRotor(rotor, f.spool, speed, dt);

    const agl = f.y - groundY;
    this.marker.position.set(f.x, groundY + 0.12, f.z);
    this.markerMaterial.opacity = f.destroyed ? 0 : smoothstep(1.5, 6, agl) * 0.45;
    const pos = this.heightLine.geometry.getAttribute('position');
    pos.setXYZ(0, f.x, groundY, f.z);
    pos.setXYZ(1, f.x, f.y, f.z);
    pos.needsUpdate = true;
    this.heightLine.visible = this.showHeightLine && agl > 1 && !f.destroyed;
  }
}
