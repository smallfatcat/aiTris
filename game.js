
import {
    blockCoords, gravityAtLevel, BLOCK_I, BLOCK_O,
    rotIleft, rotIright, rotJLTSZleft, rotJLTSZright
} from './data.js';

const COLS = 10;
const GRID_HEIGHT = 24; // 20 visible + 4 hidden
const BLANK_ROW = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

function createEmptyGrid() {
    return Array.from({ length: GRID_HEIGHT }, () => BLANK_ROW.slice());
}

export function createInitialState(startLevel = 0, pieceQueue) {
    const state = {};
    state.pieceQueue = pieceQueue;
    state.pieceQueueIndex = 0;

    state.grid = createEmptyGrid();
    state.Next = {
        type: state.pieceQueue[state.pieceQueueIndex],
    };
    state.ghostPiece = null;
    state.linesBeingCleared = null;
    state.gameOver = false;
    state.score = 0;
    state.lines = 0;
    state.level = startLevel;
    state.speed = gravityAtLevel[startLevel] || 50;
    state.dropTickStart = 0;
    state.softDrop = 0;
    state.levelUp = (startLevel * 10) + 10;
    state.iPieceDrought = 0;

    spawnBlock(state);
    return state;
}

export function collidesWithGrid(grid, activeBlock, new_x, new_y, new_rotation) {
    const shape = blockCoords[activeBlock.type][(activeBlock.rotation + new_rotation) % 4];
    for (const coord of shape) {
        const col = activeBlock.x + new_x + coord[0];
        const row = activeBlock.y + new_y + coord[1];
        if (col < 0 || col >= COLS || row >= GRID_HEIGHT || (row >= 0 && grid[row][col])) {
            return true;
        }
    }
    return false;
}

export function calculateGhostPosition(block, grid) {
    let ghostY = block.y;
    while (!collidesWithGrid(grid, { ...block, y: ghostY + 1 }, 0, 0, 0)) {
        ghostY++;
    }
    return ghostY;
}

function updateGhostPiece(state) {
    if (!state.Block || typeof state.Block.type === 'undefined') {
        state.ghostPiece = null;
        return;
    }
    const ghostY = calculateGhostPosition(state.Block, state.grid);
    state.ghostPiece = { ...state.Block, y: ghostY };
}

function lockBlock(state) {
    state.score += state.softDrop;
    state.softDrop = 0;
    state.iPieceDrought++; // Increment drought counter for every piece placed
    const shape = blockCoords[state.Block.type][state.Block.rotation];
    for (const coord of shape) {
        const col = state.Block.x + coord[0];
        const row = state.Block.y + coord[1];
        if (row >= 0) {
            state.grid[row][col] = state.Block.type + 1;
        }
    }
}

export function placePiece(state) {
    lockBlock(state);

    const linesToClear = [];
    for (let r = 0; r < GRID_HEIGHT; r++) {
        if (state.grid[r].every(cell => cell !== 0)) {
            linesToClear.push(r);
        }
    }

    if (linesToClear.length > 0) {
        // If an I-piece clears lines (likely a Tetris), reset the drought counter.
        if (state.Block.type === BLOCK_I) {
            state.iPieceDrought = 0;
        }
        state.linesBeingCleared = linesToClear;
        // Update score and level immediately
        const clearedCount = linesToClear.length;
        switch (clearedCount) {
            case 1: state.score += 40 * (state.level + 1); break;
            case 2: state.score += 100 * (state.level + 1); break;
            case 3: state.score += 300 * (state.level + 1); break;
            case 4: state.score += 1200 * (state.level + 1); break;
        }
        state.lines += clearedCount;
        if (state.lines >= state.levelUp) {
            state.level++;
            state.levelUp += 10;
            if (state.level < gravityAtLevel.length) {
                state.speed = gravityAtLevel[state.level];
            } else {
                state.speed = 50;
            }
        }
    } else {
        // If no lines are cleared, spawn the next piece immediately.
        spawnBlock(state);
    }
}

export function finishLineClear(state) {
    if (!state.linesBeingCleared) return;

    // Sort descending to ensure splicing works correctly
    const sortedLines = state.linesBeingCleared.sort((a, b) => b - a);
    sortedLines.forEach(rowIndex => {
        state.grid.splice(rowIndex, 1);
    });

    // Add new blank rows at the top
    for (let i = 0; i < state.linesBeingCleared.length; i++) {
        state.grid.unshift(BLANK_ROW.slice());
    }

    state.linesBeingCleared = null;
    spawnBlock(state); // Spawn the next piece after clearing
}


export function spawnBlock(state) {
    state.pieceQueueIndex++;
    if (state.pieceQueueIndex >= state.pieceQueue.length) {
        state.pieceQueueIndex = 0;
    }
    const nextPieceType = state.pieceQueue[state.pieceQueueIndex];

    const startPos = { x: 3, y: 2, rotation: 0 };
    if (collidesWithGrid(state.grid, { ...state.Next, ...startPos }, 0, 0, 0)) {
        state.gameOver = true;
        state.Block = {}; // Clear active block
        updateGhostPiece(state);
        return;
    }

    state.Block = {
        ...state.Next,
        ...startPos
    };
    state.Next = {
        type: nextPieceType
    };
    updateGhostPiece(state);
}

export function applyGravity(state) {
    if (collidesWithGrid(state.grid, state.Block, 0, 1, 0)) {
        placePiece(state);
    } else {
        state.Block.y++;
    }
    state.dropTickStart = Date.now();
}

export function moveLeft(state) {
    if (!collidesWithGrid(state.grid, state.Block, -1, 0, 0)) {
        state.Block.x--;
        updateGhostPiece(state);
    }
}
export function moveRight(state) {
    if (!collidesWithGrid(state.grid, state.Block, 1, 0, 0)) {
        state.Block.x++;
        updateGhostPiece(state);
    }
}
export function moveDown(state) {
    if (!collidesWithGrid(state.grid, state.Block, 0, 1, 0)) {
        state.Block.y++;
        state.softDrop++;
        state.dropTickStart = Date.now();
    }
    // NOTE: The 'else' part that called placePiece() is removed.
    // Locking is now exclusively handled by hardDrop() to give the AI
    // full control over piece placement via its action queue.
}

function rotate(state, srsArray) {
    for (let i = 0; i < srsArray.length; i++) {
        const [x, y, r] = srsArray[i];
        if (!collidesWithGrid(state.grid, state.Block, x, y, r)) {
            state.Block.x += x;
            state.Block.y += y;
            state.Block.rotation = (state.Block.rotation + r) % 4;
            updateGhostPiece(state);
            return;
        }
    }
}

export function rotateLeft(state) {
    if (!state.Block.type && state.Block.type !== 0) return;
    if (state.Block.type === BLOCK_O) return;
    const srs = state.Block.type === BLOCK_I ? rotIleft : rotJLTSZleft;
    rotate(state, srs[state.Block.rotation]);
}

export function rotateRight(state) {
    if (!state.Block.type && state.Block.type !== 0) return;
    if (state.Block.type === BLOCK_O) return;
    const srs = state.Block.type === BLOCK_I ? rotIright : rotJLTSZright;
    rotate(state, srs[state.Block.rotation]);
}

export function hardDrop(state) {
    if (!state.Block.type && state.Block.type !== 0) return;
    const ghostY = calculateGhostPosition(state.Block, state.grid);
    const cellsDropped = ghostY - state.Block.y;
    state.score += cellsDropped * 2;
    state.Block.y = ghostY;
    placePiece(state);
    state.dropTickStart = Date.now();
}
