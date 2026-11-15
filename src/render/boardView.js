import * as THREE from 'three';
import { BOARD_SIZE, HALF } from '../game/constants.js';
import { PALETTE } from './palette.js';
import { woodMaterial } from './wood.js';

const SQUARE_HEIGHT = 0.12;
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

function buildBase() {
  const base = new THREE.Mesh(
    new THREE.BoxGeometry(BOARD_SIZE, BASE_HEIGHT, BOARD_SIZE),
    woodMaterial(PALETTE.boardSide, { seed: 7, repeat: 2, roughness: 0.6 }),
  );
  base.position.y = -SQUARE_HEIGHT - BASE_HEIGHT / 2;
  base.castShadow = true;
  base.receiveShadow = true;
  return base;
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
  group.add(buildSquares(), buildBase(), buildTable());
  // Room around the board for pieces landing on the table right next to it.
  const edge = HALF + 0.6;
  const bounds = new THREE.Box3(
    new THREE.Vector3(-edge, TABLE_Y, -edge),
    new THREE.Vector3(edge, 0.4, edge),
  );
  return { group, bounds };
}
