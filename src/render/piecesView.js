import * as THREE from 'three';
import { LIGHT, PIECE_RADIUS } from '../game/constants.js';
import { FRAME_SECONDS } from '../game/physics.js';
import { TABLE_Y } from './boardView.js';
import { PALETTE } from './palette.js';
import { woodMaterial } from './wood.js';

export const PIECE_HEIGHT = 0.16;
const GRAVITY = 9.8;
// How long a fallen piece keeps sliding on the table after it lands.
const LANDING_SECONDS = 0.6;

function checkerGeometry() {
  const r = PIECE_RADIUS;
  const h = PIECE_HEIGHT;
  // Half profile from the centre of the bottom out and up, with grooves on the rim like a real
  // wooden checker and a shallow dish on top.
  const profile = [
    [0, 0],
    [r - 0.02, 0],
    [r, 0.02],
    [r, 0.045],
    [r - 0.012, 0.055],
    [r, 0.065],
    [r, h - 0.065],
    [r - 0.012, h - 0.055],
    [r, h - 0.045],
    [r, h - 0.02],
    [r - 0.02, h],
    [r * 0.78, h],
    [r * 0.72, h - 0.02],
    [0, h - 0.02],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  return new THREE.LatheGeometry(profile, 48);
}

function inlayGeometry() {
  const ring = new THREE.RingGeometry(PIECE_RADIUS * 0.45, PIECE_RADIUS * 0.58, 48);
  ring.rotateX(-Math.PI / 2);
  ring.translate(0, PIECE_HEIGHT - 0.018, 0);
  return ring;
}

function buildMaterials() {
  const make = (body, inlay, seed) => ({
    body: woodMaterial(body, { seed, roughness: 0.45 }),
    inlay: new THREE.MeshStandardMaterial({ color: inlay, roughness: 0.4, metalness: 0.1 }),
  });
  return {
    light: make(PALETTE.lightPiece, PALETTE.lightPieceInlay, 13),
    dark: make(PALETTE.darkPiece, PALETTE.darkPieceInlay, 17),
  };
}

/** Where a piece that left the board at `fall` is, `t` seconds after it left. */
function fallingPose(fall, t) {
  const drop = -TABLE_Y;
  const landAt = Math.sqrt((2 * drop) / GRAVITY);
  const flight = Math.min(t, landAt);
  let x = fall.x + fall.vx * flight;
  let z = fall.z + fall.vz * flight;
  if (t > landAt) {
    // Slides to a stop on the table with an easing that ends at rest.
    const slide = Math.min(t - landAt, LANDING_SECONDS);
    const travelled = slide - (slide * slide) / (2 * LANDING_SECONDS);
    x += fall.vx * travelled * 0.5;
    z += fall.vz * travelled * 0.5;
  }
  const y = Math.max(TABLE_Y, -0.5 * GRAVITY * flight * flight);
  // Tips forward over the edge while dropping and lands flat on the table.
  const tilt = 0.9 * Math.sin(Math.min(1, t / landAt) * Math.PI);
  return { x, y, z, tilt };
}

export const fallSeconds = () => Math.sqrt((2 * -TABLE_Y) / GRAVITY) + LANDING_SECONDS;

export function createPiecesView() {
  const group = new THREE.Group();
  const geometry = checkerGeometry();
  const inlay = inlayGeometry();
  const materials = buildMaterials();
  const meshes = new Map();
  let playback = null;
  let aimingId = null;

  function meshFor(piece) {
    let mesh = meshes.get(piece.id);
    if (!mesh) {
      const set = piece.color === LIGHT ? materials.light : materials.dark;
      mesh = new THREE.Group();
      const body = new THREE.Mesh(geometry, set.body.clone());
      body.castShadow = true;
      body.receiveShadow = true;
      mesh.add(body, new THREE.Mesh(inlay, set.inlay));
      mesh.userData.body = body;
      meshes.set(piece.id, mesh);
      group.add(mesh);
    }
    return mesh;
  }

  function place(mesh, x, y, z, tilt = 0, heading = 0) {
    mesh.position.set(x, y, z);
    mesh.rotation.set(0, 0, 0);
    if (tilt) {
      // Tilt about the horizontal axis that is perpendicular to the travel direction.
      mesh.rotateY(heading);
      mesh.rotateX(tilt);
    }
  }

  function showAiming() {
    for (const [id, mesh] of meshes) {
      mesh.userData.body.material.emissive.set(id === aimingId ? '#5a3a10' : '#000000');
    }
  }

  return {
    group,

    /** Puts every piece of `pieces` at rest where it stands and hides the others. */
    sync(pieces) {
      playback?.resolve();
      playback = null;
      const present = new Set();
      for (const piece of pieces) {
        if (!piece.onBoard) continue;
        present.add(piece.id);
        const mesh = meshFor(piece);
        mesh.visible = true;
        place(mesh, piece.x, 0, piece.z);
      }
      for (const [id, mesh] of meshes) if (!present.has(id)) mesh.visible = false;
    },

    /**
     * Replays a simulated shot in real time. `onHit(strength)` and `onLand()` fire as
     * collisions and landings happen, for sound. Resolves when everything is at rest.
     */
    play(pieces, simulation, { onHit, onLand } = {}) {
      playback?.resolve();
      return new Promise((resolve) => {
        const fallEnds = simulation.falls.map((f) => f.time + fallSeconds());
        playback = {
          pieces,
          simulation,
          start: null,
          duration: Math.max(simulation.frames.length * FRAME_SECONDS, ...fallEnds),
          nextHit: 0,
          landed: new Set(),
          onHit,
          onLand,
          resolve,
        };
      });
    },

    setAiming(id) {
      aimingId = id;
      showAiming();
    },

    update(nowMs) {
      if (!playback) return;
      const p = playback;
      p.start ??= nowMs;
      const t = (nowMs - p.start) / 1000;
      const { frames, falls, hits } = p.simulation;

      while (p.nextHit < hits.length && hits[p.nextHit].time <= t) {
        p.onHit?.(hits[p.nextHit++].strength);
      }

      const exact = t / FRAME_SECONDS;
      const i = Math.min(Math.floor(exact), frames.length - 1);
      const j = Math.min(i + 1, frames.length - 1);
      const blend = Math.min(1, exact - i);
      p.pieces.forEach((piece, index) => {
        if (!piece.onBoard) return;
        const mesh = meshFor(piece);
        const fall = falls.find((f) => f.id === piece.id);
        if (fall && t >= fall.time) {
          const pose = fallingPose(fall, t - fall.time);
          place(mesh, pose.x, pose.y, pose.z, pose.tilt, Math.atan2(fall.vx, fall.vz));
          if (pose.y <= TABLE_Y && !p.landed.has(piece.id)) {
            p.landed.add(piece.id);
            p.onLand?.();
          }
          return;
        }
        const [x0, z0] = frames[i][index];
        const [x1, z1] = frames[j][index];
        place(mesh, x0 + (x1 - x0) * blend, 0, z0 + (z1 - z0) * blend);
      });

      if (t >= p.duration) {
        playback = null;
        p.resolve();
      }
    },
  };
}
