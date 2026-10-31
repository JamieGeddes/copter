import { OrthographicCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { groundBasis, screenToWorld } from '../src/render/isoMath';

describe('isometric ground mapping', () => {
  const yaw = Math.PI / 4;
  const elevation = (50 * Math.PI) / 180;
  const basis = groundBasis(yaw);

  // A camera placed the same way IsoCamera does it.
  const camera = new OrthographicCamera(-10, 10, 10, -10, 0.1, 1000);
  camera.position.set(
    Math.sin(yaw) * Math.cos(elevation) * 100,
    Math.sin(elevation) * 100,
    Math.cos(yaw) * Math.cos(elevation) * 100,
  );
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();

  const project = (x: number, z: number) => new Vector3(x, 0, z).project(camera);

  it('maps the screen-right stick to the right of the screen', () => {
    const r = screenToWorld(basis, 1, 0);
    const p = project(r.x, r.z);
    expect(p.x).toBeGreaterThan(0);
    expect(Math.abs(p.y)).toBeLessThan(1e-6);
  });

  it('maps the screen-up stick to the top of the screen', () => {
    const u = screenToWorld(basis, 0, 1);
    const p = project(u.x, u.z);
    expect(p.y).toBeGreaterThan(0);
    expect(Math.abs(p.x)).toBeLessThan(1e-6);
  });

  it('produces perpendicular unit axes', () => {
    const r = screenToWorld(basis, 1, 0);
    const u = screenToWorld(basis, 0, 1);
    expect(Math.hypot(r.x, r.z)).toBeCloseTo(1);
    expect(r.x * u.x + r.z * u.z).toBeCloseTo(0);
  });
});
