export const SUPPORTED_SIZES = Object.freeze([9, 16]);

export function getScreenCols(size) {
  return size * size;
}

export function getScreenRows(size) {
  return size;
}

export function getNumCats(size) {
  return size * size;
}

export function getCoords(size, row, column) {
  return {
    x: column % size,
    y: row,
    z: Math.floor(column / size),
  };
}

export function shuffle(values, random = Math.random) {
  for (let index = values.length - 1; index > 0; index--) {
    const swapIndex = Math.floor(random() * (index + 1));
    [values[index], values[swapIndex]] = [values[swapIndex], values[index]];
  }
  return values;
}

export function generateCats(size) {
  const rows = getScreenRows(size);
  const columns = getScreenCols(size);
  const isCat = Array.from({ length: rows }, () => Array(columns).fill(false));
  const catCoords = [];

  let xStep = 3;
  let zStep = 5;
  if (size === 9) {
    xStep = 4;
    zStep = 2;
  }

  for (let z = 0; z < size; z++) {
    for (let x = 0; x < size; x++) {
      const y = (xStep * x + zStep * z) % size;
      const column = z * size + x;
      isCat[y][column] = true;
      catCoords.push([y, column]);
    }
  }

  return { isCat, catCoords };
}

export function getOrthogonalNeighbors(size, row, column) {
  const neighbors = [];
  const x = column % size;
  const z = Math.floor(column / size);

  if (x > 0) neighbors.push([row, column - 1]);
  if (x < size - 1) neighbors.push([row, column + 1]);
  if (row > 0) neighbors.push([row - 1, column]);
  if (row < size - 1) neighbors.push([row + 1, column]);
  if (z > 0) neighbors.push([row, column - size]);
  if (z < size - 1) neighbors.push([row, column + size]);

  return neighbors;
}

export function generateRegions(size, catCoords, random = Math.random) {
  const rows = getScreenRows(size);
  const columns = getScreenCols(size);
  const regionCount = catCoords.length;
  const regions = Array.from({ length: rows }, () => Array(columns).fill(-1));
  const regionSizes = Array(regionCount).fill(1);
  const caps = Array(regionCount).fill(Infinity);
  const regionOrder = shuffle([...Array(regionCount).keys()], random);
  const cappedCount = Math.max(2, Math.floor(regionCount * 0.15));

  for (const regionId of regionOrder.slice(0, cappedCount)) {
    caps[regionId] = 1 + Math.floor(random() * 2);
  }

  const frontier = [];
  const removeFrontierAt = (index) => {
    frontier[index] = frontier[frontier.length - 1];
    frontier.pop();
  };

  for (let regionId = 0; regionId < regionCount; regionId++) {
    const [row, column] = catCoords[regionId];
    regions[row][column] = regionId;
    frontier.push([row, column]);
  }

  let remaining = rows * columns - regionCount;
  while (remaining > 0 && frontier.length > 0) {
    const frontierIndex = Math.floor(random() * frontier.length);
    const [row, column] = frontier[frontierIndex];
    const regionId = regions[row][column];

    if (regionSizes[regionId] >= caps[regionId]) {
      removeFrontierAt(frontierIndex);
      continue;
    }

    const openNeighbors = getOrthogonalNeighbors(size, row, column)
      .filter(([nextRow, nextColumn]) => regions[nextRow][nextColumn] === -1);

    if (openNeighbors.length === 0) {
      removeFrontierAt(frontierIndex);
      continue;
    }

    const [nextRow, nextColumn] = openNeighbors[Math.floor(random() * openNeighbors.length)];
    regions[nextRow][nextColumn] = regionId;
    regionSizes[regionId]++;
    frontier.push([nextRow, nextColumn]);
    remaining--;
  }

  // 드물게 작은 영역들이 빈 공간을 둘러싼 경우에도 인접 영역으로만 흡수해 연결성을 유지한다.
  while (remaining > 0) {
    let filledThisPass = 0;
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < columns; column++) {
        if (regions[row][column] !== -1) continue;
        const neighbor = getOrthogonalNeighbors(size, row, column)
          .find(([nextRow, nextColumn]) => regions[nextRow][nextColumn] !== -1);
        if (!neighbor) continue;
        regions[row][column] = regions[neighbor[0]][neighbor[1]];
        remaining--;
        filledThisPass++;
      }
    }
    if (filledThisPass === 0) throw new Error('Unable to connect every cell to a region.');
  }

  return regions;
}

export function makeBoard(size, random = Math.random) {
  if (!SUPPORTED_SIZES.includes(size)) throw new RangeError(`Unsupported cube size: ${size}`);
  const { isCat, catCoords } = generateCats(size);
  return {
    isDiamond: isCat,
    regions: generateRegions(size, catCoords, random),
  };
}

export function validateBoard(board, size) {
  const errors = [];
  const rows = getScreenRows(size);
  const columns = getScreenCols(size);
  const expectedCats = getNumCats(size);
  const validMatrix = (matrix) => Array.isArray(matrix) &&
    matrix.length === rows &&
    matrix.every((row) => Array.isArray(row) && row.length === columns);

  if (!validMatrix(board?.isDiamond) || !validMatrix(board?.regions)) {
    return ['Board matrices do not match the selected cube size.'];
  }

  const countLine = (coords) => coords.reduce(
    (count, [row, column]) => count + Number(Boolean(board.isDiamond[row][column])),
    0
  );

  for (let z = 0; z < size; z++) {
    for (let y = 0; y < size; y++) {
      const coords = Array.from({ length: size }, (_, x) => [y, z * size + x]);
      if (countLine(coords) !== 1) errors.push(`X axis failed at y=${y}, z=${z}.`);
    }
  }

  for (let z = 0; z < size; z++) {
    for (let x = 0; x < size; x++) {
      const coords = Array.from({ length: size }, (_, y) => [y, z * size + x]);
      if (countLine(coords) !== 1) errors.push(`Y axis failed at x=${x}, z=${z}.`);
    }
  }

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const coords = Array.from({ length: size }, (_, z) => [y, z * size + x]);
      if (countLine(coords) !== 1) errors.push(`Z axis failed at x=${x}, y=${y}.`);
    }
  }

  const regionCatCounts = new Map();
  let catCount = 0;
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const regionId = board.regions[row][column];
      if (!Number.isInteger(regionId) || regionId < 0 || regionId >= expectedCats) {
        errors.push(`Invalid region at row=${row}, column=${column}.`);
        continue;
      }
      if (!board.isDiamond[row][column]) continue;
      catCount++;
      regionCatCounts.set(regionId, (regionCatCounts.get(regionId) || 0) + 1);

      const { x, y, z } = getCoords(size, row, column);
      for (let dz = -1; dz <= 1; dz++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0 && dz === 0) continue;
            const nextX = x + dx;
            const nextY = y + dy;
            const nextZ = z + dz;
            if (nextX < 0 || nextY < 0 || nextZ < 0 || nextX >= size || nextY >= size || nextZ >= size) continue;
            if (board.isDiamond[nextY][nextZ * size + nextX]) {
              errors.push(`Adjacent cats found near x=${x}, y=${y}, z=${z}.`);
            }
          }
        }
      }
    }
  }

  if (catCount !== expectedCats) errors.push(`Expected ${expectedCats} cats, received ${catCount}.`);
  if (new Set(board.regions.flat()).size !== expectedCats) {
    errors.push(`Expected ${expectedCats} regions.`);
  }
  for (let regionId = 0; regionId < expectedCats; regionId++) {
    if (regionCatCounts.get(regionId) !== 1) errors.push(`Region ${regionId} does not contain exactly one cat.`);
  }

  return errors;
}
