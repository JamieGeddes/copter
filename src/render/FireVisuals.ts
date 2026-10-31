import { BufferAttribute, Color, InstancedMesh, Mesh, Object3D, Scene } from 'three';
import { Particles } from '../fx/Particles';
import { Bucket } from '../missions/Bucket';
import { Cell, FireGrid } from '../world/FireGrid';
import { ScatterItem, World } from '../world/World';

/** Particle pool sizes. These cap the cost however large the fire grows. */
const MAX_FLAMES = 1400;
const MAX_SMOKE = 1100;
const MAX_STEAM = 350;
const MAX_WATER = 420;
const FLAME_RATE = 520;
const SMOKE_RATE = 190;

const BURNING_TINT = new Color(1.7, 0.55, 0.1);
const SCORCH = new Color(0.1, 0.085, 0.075);
const SINGED = new Color(0.42, 0.34, 0.26);
const TREE_BURNING = new Color(0.45, 0.3, 0.2);
const TREE_BURNT = new Color(0.14, 0.12, 0.11);

interface TreeRef {
  mesh: InstancedMesh;
  index: number;
  item: ScatterItem;
}

/**
 * Everything the fire looks like: flames and smoke from the burning cells, a glowing front and
 * scorched ground (terrain vertex colours), trees blackened and stripped as they burn, steam where
 * water hits fire and the falling water itself.
 */
export class FireVisuals {
  private readonly flames = new Particles({ capacity: MAX_FLAMES, colour: 0xff7a1c, opacity: 0.85, additive: true, drag: 1.2, gravity: 2.5 });
  private readonly smoke = new Particles({ capacity: MAX_SMOKE, colour: 0x2e2a27, opacity: 0.55, drag: 0.35, gravity: 1.6 });
  private readonly steam = new Particles({ capacity: MAX_STEAM, colour: 0xf4f6f6, opacity: 0.55, drag: 0.7, gravity: 1.8 });
  private readonly water = new Particles({ capacity: MAX_WATER, colour: 0xbfe0f2, opacity: 0.55, drag: 0.2, gravity: -16 });
  private readonly pools = [this.flames, this.smoke, this.steam, this.water];
  private readonly colourAttr: BufferAttribute;
  private readonly colours: Float32Array;
  private readonly base: Float32Array;
  private readonly treesByCell = new Map<number, TreeRef[]>();
  private readonly dummy = new Object3D();
  private readonly tint = new Color();
  private dirtyColours = false;
  private flameBudget = 0;
  private smokeBudget = 0;
  private waterBudget = 0;
  private steamBudget = 0;

  constructor(
    scene: Scene,
    private readonly world: World,
    private readonly grid: FireGrid,
    props: Object3D,
    terrain: Mesh,
  ) {
    for (const p of this.pools) scene.add(p.points);
    this.flames.points.renderOrder = 4;

    this.colourAttr = terrain.geometry.getAttribute('color') as BufferAttribute;
    this.colours = this.colourAttr.array as Float32Array;
    this.base = Float32Array.from(this.colours);

    // Map each tree to the instance that draws it (same filter order as createScatter).
    const trees = world.scatter.filter((s) => s.kind === 'tree');
    for (const [name, pick] of [
      ['treeRound', (s: ScatterItem) => s.variant < 2],
      ['treePine', (s: ScatterItem) => s.variant >= 2],
    ] as const) {
      const mesh = props.getObjectByName(name) as InstancedMesh | undefined;
      if (!mesh) continue;
      trees.filter(pick).forEach((item, index) => {
        const cell = grid.cellAt(item.x, item.z);
        if (cell < 0) return;
        const list = this.treesByCell.get(cell) ?? [];
        list.push({ mesh, index, item });
        this.treesByCell.set(cell, list);
      });
    }

    // Show the state the fire is already in.
    for (let i = 0; i < grid.state.length; i++) if (grid.state[i] !== Cell.Unburnt) this.paintCell(i);
    grid.drainChanges();
    this.flush();
  }

  setVisible(visible: boolean): void {
    for (const p of this.pools) p.points.visible = visible;
  }

  /** Call once per frame. `splash` is where water is landing, with the burning cells it hit. */
  update(
    dt: number,
    pixelsPerMetre: number,
    wind: { x: number; z: number } | undefined,
    bucket: Bucket | undefined,
    splash: { x: number; z: number; y: number; radius: number; height: number; hits: number } | undefined,
  ): void {
    for (const i of this.grid.drainChanges()) this.paintCell(i);
    this.flush();
    this.spawnFire(dt, wind);
    this.spawnWater(dt, bucket, splash);
    for (const p of this.pools) {
      p.update(dt);
      p.setScale(pixelsPerMetre);
    }
  }

  private spawnFire(dt: number, wind: { x: number; z: number } | undefined): void {
    const burning = this.grid.burningCells();
    const n = burning.length;
    if (n === 0) return;
    const wx = wind?.x ?? 0;
    const wz = wind?.z ?? 0;
    const cell = this.grid.cellSize;
    // Emit rates scale with the fire but stop at the pool size: bigger fires just look denser per cell.
    this.flameBudget += dt * Math.min(FLAME_RATE, n * 1.6);
    this.smokeBudget += dt * Math.min(SMOKE_RATE, n * 0.5);
    while (this.flameBudget >= 1) {
      this.flameBudget -= 1;
      const i = burning[Math.floor(Math.random() * n)];
      const x = this.grid.centreX(i) + (Math.random() - 0.5) * cell;
      const z = this.grid.centreZ(i) + (Math.random() - 0.5) * cell;
      const wooded = this.world.terrain.canopyAt(x, z) > 0.3;
      const strength = this.grid.heat[i];
      this.flames.spawn({
        x,
        y: this.world.terrain.heightAt(x, z) + (wooded ? 1.5 + Math.random() * 3 : 0.3),
        z,
        vx: wx * 0.3,
        vy: 1.5 + Math.random() * 2.5,
        vz: wz * 0.3,
        life: 0.45 + Math.random() * 0.5,
        size0: (2.4 + Math.random() * 2) * (0.6 + 0.4 * strength),
        size1: 0.5,
        shade: 0.8 + Math.random() * 0.5,
      });
    }
    while (this.smokeBudget >= 1) {
      this.smokeBudget -= 1;
      const i = burning[Math.floor(Math.random() * n)];
      const x = this.grid.centreX(i) + (Math.random() - 0.5) * cell;
      const z = this.grid.centreZ(i) + (Math.random() - 0.5) * cell;
      this.smoke.spawn({
        x,
        y: this.world.terrain.heightAt(x, z) + 3 + Math.random() * 3,
        z,
        vx: wx * 0.9 + (Math.random() - 0.5),
        vy: 3 + Math.random() * 2.5,
        vz: wz * 0.9 + (Math.random() - 0.5),
        life: 4 + Math.random() * 3,
        size0: 3,
        size1: 12 + Math.random() * 7,
        shade: 0.5 + Math.random() * 0.7,
      });
    }
  }

  private spawnWater(
    dt: number,
    bucket: Bucket | undefined,
    splash: { x: number; z: number; y: number; radius: number; height: number; hits: number } | undefined,
  ): void {
    if (bucket?.dropping && splash) {
      // A curtain of water falling from the bucket and spreading over the ground below.
      this.waterBudget += dt * 330;
      while (this.waterBudget >= 1) {
        this.waterBudget -= 1;
        const a = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random());
        const k = Math.random();
        this.water.spawn({
          x: bucket.x + (splash.x - bucket.x) * k * 0.2 + Math.cos(a) * r * splash.radius * 0.7 * k,
          y: bucket.y - 0.5,
          z: bucket.z + (splash.z - bucket.z) * k * 0.2 + Math.sin(a) * r * splash.radius * 0.7 * k,
          vx: bucket.vx * 0.8,
          vy: -2 - Math.random() * 3,
          vz: bucket.vz * 0.8,
          life: Math.min(1.6, 0.25 + splash.height / 14),
          size0: 0.9,
          size1: 1.6,
        });
      }
    }
    if (splash && splash.hits > 0) this.steamBudget += splash.hits * 0.05;
    this.steamBudget = Math.min(this.steamBudget, 30);
    while (this.steamBudget >= 1 && splash) {
      this.steamBudget -= 1;
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * splash.radius;
      const x = splash.x + Math.cos(a) * r;
      const z = splash.z + Math.sin(a) * r;
      this.steam.spawn({
        x,
        y: this.world.terrain.heightAt(x, z) + 0.8,
        z,
        vx: (Math.random() - 0.5) * 1.5,
        vy: 3 + Math.random() * 3,
        vz: (Math.random() - 0.5) * 1.5,
        life: 1.4 + Math.random() * 1.2,
        size0: 2,
        size1: 8 + Math.random() * 4,
      });
    }
  }

  /** Recolours the ground and trees of one cell to match its fire state. */
  private paintCell(i: number): void {
    const state = this.grid.state[i];
    const c = this.tint;
    const o = i * 3;
    const burnt = this.grid.fuel[i] < 0.02 || state === Cell.Burnt;
    if (state === Cell.Burning) {
      c.setRGB(this.base[o], this.base[o + 1], this.base[o + 2]).lerp(BURNING_TINT, 0.75);
    } else if (burnt) {
      c.setRGB(this.base[o], this.base[o + 1], this.base[o + 2]).multiply(SINGED).lerp(SCORCH, 0.8);
    } else {
      // Put out with fuel left: singed rather than black.
      c.setRGB(this.base[o], this.base[o + 1], this.base[o + 2]).multiplyScalar(0.55);
    }
    this.colours[o] = c.r;
    this.colours[o + 1] = c.g;
    this.colours[o + 2] = c.b;
    this.dirtyColours = true;

    const trees = this.treesByCell.get(i);
    if (!trees) return;
    for (const t of trees) {
      const stripped = state === Cell.Burnt ? 0.55 : state === Cell.Burning ? 0.85 : 1;
      this.dummy.position.set(t.item.x, t.item.y - 0.1, t.item.z);
      this.dummy.rotation.set(0, t.item.rotation, 0);
      this.dummy.scale.set(t.item.scale * (state === Cell.Burnt ? 0.6 : 1), t.item.scale * stripped, t.item.scale * (state === Cell.Burnt ? 0.6 : 1));
      this.dummy.updateMatrix();
      t.mesh.setMatrixAt(t.index, this.dummy.matrix);
      t.mesh.setColorAt(t.index, state === Cell.Burnt ? TREE_BURNT : state === Cell.Burning ? TREE_BURNING : this.tint.setScalar(0.6));
      t.mesh.instanceMatrix.needsUpdate = true;
      if (t.mesh.instanceColor) t.mesh.instanceColor.needsUpdate = true;
    }
  }

  private flush(): void {
    if (!this.dirtyColours) return;
    this.dirtyColours = false;
    this.colourAttr.needsUpdate = true;
  }
}
