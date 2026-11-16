import * as THREE from 'three';
import { BOARD_SIZE, HALF, PLAY_HALF } from '../game/constants.js';
import { PALETTE } from './palette.js';
import { woodMaterial } from './wood.js';

const SQUARE_HEIGHT = 0.12;
const FILES = 'abcdefgh';
// The board is a thick block standing on the table, so knocked-off pieces visibly drop.
const BASE_HEIGHT = 0.45;
export const TABLE_Y = -(SQUARE_HEIGHT + BASE_HEIGHT);

function buildSquares() {
  const squares = new THREE.Group();
  const geometry = new THREE.BoxGeometry(1, SQUARE_HEIGHT, 1);
  for (let rank = 0; rank < BOARD_SIZE; rank++) {
    for (let file = 0; file < BOARD_SIZE; file++) {
      const isLight = (file + rank) % 2 === 1;
      const index = rank * BOARD_SIZE + file;
      const material = woodMaterial(isLight ? PALETTE.lightSquare : PALETTE.darkSquare, {
        seed: isLight ? 3 : 5,
        roughness: 0.5,
        rotation: (index % 3) * 0.04 + (rank % 2 ? Math.PI / 2 : 0),
      });
      material.map.offset.set((index * 0.137) % 1, (index * 0.271) % 1);
      const square = new THREE.Mesh(geometry, material);
      square.position.set(file - HALF + 0.5, -SQUARE_HEIGHT / 2, HALF - 0.5 - rank);
      square.receiveShadow = true;
      squares.add(square);
    }
  }
  return squares;
}

// The frame is flush with the cells, so pieces slide onto it and stay in play until they pass
// its outer edge. It is a ring around the cells rather than a block under them: two surfaces this
// close together flicker through each other on GPUs with a coarse depth buffer, as on many phones.
function buildFrame() {
  const height = SQUARE_HEIGHT + BASE_HEIGHT;
  const material = woodMaterial(PALETTE.frame, { seed: 7, repeat: 2, roughness: 0.6 });
  const square = (half) =>
    new THREE.Path()
      .moveTo(-half, -half)
      .lineTo(half, -half)
      .lineTo(half, half)
      .lineTo(-half, half);
  const outline = new THREE.Shape(square(PLAY_HALF).getPoints());
  outline.holes.push(square(HALF));
  const ringGeometry = new THREE.ExtrudeGeometry(outline, { depth: height, bevelEnabled: false });
  // Extruded UVs are in board units; bring them to 0..1 across the frame like a box's top.
  const uv = ringGeometry.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, uv.getX(i) / (PLAY_HALF * 2) + 0.5, uv.getY(i) / (PLAY_HALF * 2) + 0.5);
  }
  ringGeometry.rotateX(Math.PI / 2);
  const ring = new THREE.Mesh(ringGeometry, material);
  // Under the cells, out of sight, so nothing shows through a gap between them.
  const base = new THREE.Mesh(new THREE.BoxGeometry(HALF * 2, BASE_HEIGHT, HALF * 2), material);
  base.position.y = -SQUARE_HEIGHT - BASE_HEIGHT / 2;
  const frame = new THREE.Group();
  for (const mesh of [ring, base]) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    frame.add(mesh);
  }
  return frame;
}

function labelMesh(text) {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = PALETTE.label;
  ctx.font = 'bold 44px Georgia, "Times New Roman", serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 32, 34);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    // Lifted in depth too, or a coarse depth buffer lets the frame poke through the letters.
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -4,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.4), material);
  mesh.rotation.x = -Math.PI / 2;
  return mesh;
}

function buildLabels() {
  const labels = new THREE.Group();
  const offset = (HALF + PLAY_HALF) / 2;
  for (let i = 0; i < BOARD_SIZE; i++) {
    const along = i - HALF + 0.5;
    for (const side of [1, -1]) {
      const file = labelMesh(FILES[i]);
      file.position.set(along, 0.002, side * offset);
      const rank = labelMesh(String(i + 1));
      rank.position.set(side * offset, 0.002, -along);
      // Near labels read from Light's seat, far ones from Dark's.
      if (side < 0) file.rotation.z = Math.PI;
      if (side > 0) rank.rotation.z = Math.PI;
      labels.add(file, rank);
    }
  }
  return labels;
}

function buildTable() {
  const material = woodMaterial(PALETTE.table, { seed: 11, repeat: 6, roughness: 0.7 });
  const table = new THREE.Mesh(new THREE.CircleGeometry(16, 64), material);
  table.rotation.x = -Math.PI / 2;
  table.position.y = TABLE_Y;
  table.receiveShadow = true;
  return table;
}

export function createBoardView() {
  const group = new THREE.Group();
  group.add(buildSquares(), buildFrame(), buildLabels(), buildTable());
  // Room around the board for pieces landing on the table right next to it.
  const edge = PLAY_HALF + 0.4;
  const bounds = new THREE.Box3(
    new THREE.Vector3(-edge, TABLE_Y, -edge),
    new THREE.Vector3(edge, 0.4, edge),
  );
  return { group, bounds };
}
