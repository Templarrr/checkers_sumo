import * as THREE from 'three';
import { pieceNear, spreadDegrees } from '../game/rules.js';
import { MAX_SPEED } from '../game/physics.js';
import { PALETTE } from './palette.js';
import { PIECE_HEIGHT } from './piecesView.js';

// Pulling back this many squares gives a full-strength flick.
const FULL_PULL = 2.5;
// Releasing within this distance of the piece cancels instead of shooting a dribble.
const DEAD_ZONE = 0.2;
const MIN_REACH = 0.8;
const MAX_REACH = 3.2;

// The sector covers every direction the flick may actually take, see scatterShot.
function buildSector() {
  const material = new THREE.MeshBasicMaterial({
    color: PALETTE.aimWeak,
    transparent: true,
    opacity: 0.45,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  });
  const fill = new THREE.Mesh(new THREE.BufferGeometry(), material);
  const lineMaterial = new THREE.MeshBasicMaterial({ color: PALETTE.aimWeak, depthWrite: false });
  const line = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.035), lineMaterial);
  line.rotation.x = -Math.PI / 2;
  const sector = new THREE.Group();
  sector.add(fill, line);
  sector.visible = false;
  return { sector, fill, line, material, lineMaterial };
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
  const { sector, fill, line, material, lineMaterial } = buildSector();
  sector.position.y = 0.004;
  scene.add(sector);
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

  function showSector(shot, piece = drag?.piece) {
    sector.visible = Boolean(shot);
    if (!shot) return;
    const reach = MIN_REACH + shot.power * (MAX_REACH - MIN_REACH);
    const spread = (spreadDegrees(shot.power) * Math.PI) / 180;
    fill.geometry.dispose();
    fill.geometry = new THREE.CircleGeometry(reach, 24, -spread, spread * 2).rotateX(-Math.PI / 2);
    line.scale.x = reach;
    line.position.x = reach / 2;
    sector.position.x = piece.x;
    sector.position.z = piece.z;
    // Built pointing along +x; turn it towards the shot.
    sector.rotation.y = -Math.atan2(shot.vz, shot.vx);
    material.color.copy(weak).lerp(strong, shot.power);
    lineMaterial.color.copy(material.color);
  }

  function endDrag() {
    drag = null;
    sector.visible = false;
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
      if (point) showSector(shotFor(point));
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
    /** Shows where a computer player is about to shoot, or hides it with `null`. */
    preview(state, shot) {
      const piece = shot && state.pieces.find((p) => p.id === shot.pieceId);
      piecesView.setAiming(piece ? piece.id : null);
      showSector(
        piece && { ...shot, power: Math.min(Math.hypot(shot.vx, shot.vz) / MAX_SPEED, 1) },
        piece,
      );
    },
    disable() {
      armed = null;
      canvas.style.cursor = '';
      endDrag();
    },
  };
}
