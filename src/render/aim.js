import * as THREE from 'three';
import { pieceNear } from '../game/rules.js';
import { MAX_SPEED } from '../game/physics.js';
import { PALETTE } from './palette.js';
import { PIECE_HEIGHT } from './piecesView.js';

// Pulling back this many squares gives a full-strength flick.
const FULL_PULL = 2.5;
// Releasing within this distance of the piece cancels instead of shooting a dribble.
const DEAD_ZONE = 0.2;
const MAX_ARROW = 3;

function buildArrow() {
  const shape = new THREE.Shape();
  const w = 0.09;
  const head = 0.28;
  // Unit-length arrow along +y in shape space, scaled to the shot strength later.
  shape.moveTo(-w, 0);
  shape.lineTo(w, 0);
  shape.lineTo(w, 1 - head);
  shape.lineTo(w * 3, 1 - head);
  shape.lineTo(0, 1);
  shape.lineTo(-w * 3, 1 - head);
  shape.lineTo(-w, 1 - head);
  shape.closePath();
  const geometry = new THREE.ShapeGeometry(shape);
  // Laid flat, the shape's +y ends up along -z; turn it so the arrow points along +z.
  geometry.rotateX(-Math.PI / 2);
  geometry.rotateY(Math.PI);
  const material = new THREE.MeshBasicMaterial({
    color: PALETTE.aimWeak,
    transparent: true,
    opacity: 0.85,
    depthTest: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 10;
  const arrow = new THREE.Group();
  arrow.add(mesh);
  arrow.visible = false;
  return { arrow, mesh, material };
}

/**
 * Pointer input for flicking: press on one of your pieces, pull back like a slingshot and let
 * go. `enable(state, onShot)` arms it for the side to move; it stays idle otherwise, so the
 * same drag on empty space orbits the camera.
 */
export function createAim({ container, canvas, camera, scene, piecesView }) {
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -PIECE_HEIGHT / 2);
  const hit = new THREE.Vector3();
  const { arrow, mesh, material } = buildArrow();
  arrow.position.y = PIECE_HEIGHT + 0.02;
  scene.add(arrow);
  const weak = new THREE.Color(PALETTE.aimWeak);
  const strong = new THREE.Color(PALETTE.aimStrong);

  let armed = null;
  let drag = null;

  function boardPoint(event) {
    const rect = canvas.getBoundingClientRect();
    pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(pointer, camera);
    return raycaster.ray.intersectPlane(plane, hit) ? { x: hit.x, z: hit.z } : null;
  }

  // The flick goes opposite to the pull, with strength growing with the pull length.
  function shotFor(point) {
    const dx = drag.piece.x - point.x;
    const dz = drag.piece.z - point.z;
    const pull = Math.hypot(dx, dz);
    if (pull < DEAD_ZONE) return null;
    const power = Math.min(pull, FULL_PULL) / FULL_PULL;
    return {
      pieceId: drag.piece.id,
      power,
      vx: (dx / pull) * power * MAX_SPEED,
      vz: (dz / pull) * power * MAX_SPEED,
    };
  }

  function showArrow(shot) {
    arrow.visible = Boolean(shot);
    if (!shot) return;
    arrow.position.x = drag.piece.x;
    arrow.position.z = drag.piece.z;
    arrow.rotation.y = Math.atan2(shot.vx, shot.vz);
    mesh.scale.set(1, 1, 0.5 + shot.power * (MAX_ARROW - 0.5));
    material.color.copy(weak).lerp(strong, shot.power);
  }

  function endDrag() {
    drag = null;
    arrow.visible = false;
    piecesView.setAiming(null);
  }

  // Capture phase on the container runs before the camera controls see the press.
  container.addEventListener(
    'pointerdown',
    (event) => {
      if (!armed || drag || !event.isPrimary) return;
      const point = boardPoint(event);
      const piece = point && pieceNear(armed.state, point.x, point.z, armed.state.turn);
      if (!piece) return;
      event.stopPropagation();
      event.preventDefault();
      drag = { piece, pointerId: event.pointerId };
      piecesView.setAiming(piece.id);
    },
    { capture: true },
  );

  window.addEventListener('pointermove', (event) => {
    if (drag && event.pointerId === drag.pointerId) {
      const point = boardPoint(event);
      if (point) showArrow(shotFor(point));
      return;
    }
    if (!armed || drag) return;
    const point = event.target === canvas ? boardPoint(event) : null;
    const over = point && pieceNear(armed.state, point.x, point.z, armed.state.turn);
    canvas.style.cursor = over ? 'grab' : '';
  });

  window.addEventListener('pointerup', (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const point = boardPoint(event);
    const shot = point && shotFor(point);
    endDrag();
    if (!shot || !armed) return;
    const { onShot } = armed;
    armed = null;
    canvas.style.cursor = '';
    onShot({ pieceId: shot.pieceId, vx: shot.vx, vz: shot.vz });
  });

  window.addEventListener('pointercancel', endDrag);
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && drag) endDrag();
  });

  return {
    enable(state, onShot) {
      armed = { state, onShot };
    },
    /** Fires a shot as if dragged, for scripted checks. */
    shoot(shot) {
      if (!armed) return false;
      const { onShot } = armed;
      armed = null;
      onShot(shot);
      return true;
    },
    disable() {
      armed = null;
      canvas.style.cursor = '';
      endDrag();
    },
  };
}
