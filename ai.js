

import { blockCoords, BLOCK_I, rotIleft, rotIright, rotJLTSZleft, rotJLTSZright } from './data.js';
import { collidesWithGrid } from './game.js';

const COLS = 10;
const GRID_HEIGHT = 24;
const BLANK_ROW = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
const DANGER_HEIGHT_THRESHOLD = 18; // If the highest column is above this, AI will prioritize survival.
const DROUGHT_THRESHOLD = 12; // Pieces placed without a aitris before penalty applies

// --- Heuristic Weights ---
export const BASE_SURVIVAL_WEIGHTS = {
    aggregateHeight: 0.51,
    completedLines: -0.76,
    holes: 1.0,
    bumpiness: 0.18,
    lookaheadScore: 0.8,
    centerClog: 0.8,
    holeReduction: -2.5,
};

export const BASE_WELL_WEIGHTS = {
    aggregateHeight: 0.4,
    holes: 4.0,
    bumpiness: 0.25,
    wellClogs: 8.0,
    lineClearBonus: -5.0, // Exponential bonus: bonus * (lines^2)
    droughtPenalty: 0.08,
    lookaheadScore: 0.8,
};


// --- Helper Functions for Evaluation ---

function getColumnHeights(grid) {
    const heights = Array(COLS).fill(0);
    for (let c = 0; c < COLS; c++) {
        for (let r = 0; r < GRID_HEIGHT; r++) {
            if (grid[r][c]) {
                heights[c] = GRID_HEIGHT - r;
                break;
            }
        }
    }
    return heights;
}

function getAggregateHeight(heights) {
    return heights.reduce((sum, h) => sum + h, 0);
}

function getHoles(grid) {
    let holes = 0;
    for (let c = 0; c < COLS; c++) {
        let blockFound = false;
        for (let r = 0; r < GRID_HEIGHT; r++) {
            if (grid[r][c]) {
                blockFound = true;
            } else if (blockFound) {
                holes++;
            }
        }
    }
    return holes;
}


function getBumpiness(heights) {
    let bumpiness = 0;
    for (let i = 0; i < heights.length - 1; i++) {
        bumpiness += Math.abs(heights[i] - heights[i + 1]);
    }
    return bumpiness;
}

function simulateLineClearing(grid) {
    let clearedCount = 0;
    const newGrid = [];

    for (let r = GRID_HEIGHT - 1; r >= 0; r--) {
        if (grid[r].every(cell => cell !== 0)) {
            clearedCount++;
        } else {
            newGrid.unshift(grid[r]);
        }
    }
    while (newGrid.length < GRID_HEIGHT) {
        newGrid.unshift(BLANK_ROW.slice());
    }
    return { grid: newGrid, clearedCount };
}

function evaluateBoard(grid, clearedLines, strategy, weights, iPieceDrought, holesBeforeClear) {
    const heights = getColumnHeights(grid);

    if (strategy === 'rightWell' || strategy === 'leftWell') {
        const wellColumn = (strategy === 'rightWell') ? 9 : 0;
        const neighborColumn = (strategy === 'rightWell') ? 8 : 1;

        const holes = getHoles(grid);
        const holePenalty = weights.holes * holes;

        let stackBumpiness = 0;
        for (let i = 0; i < COLS - 1; i++) {
             if ( (strategy === 'rightWell' && i === wellColumn - 1) || (strategy === 'leftWell' && i === wellColumn) ) {
                continue;
             }
             stackBumpiness += Math.abs(heights[i] - heights[i + 1]);
        }
        const bumpinessPenalty = weights.bumpiness * stackBumpiness;
        
        const aggregateHeight = getAggregateHeight(heights);
        const heightPenalty = weights.aggregateHeight * aggregateHeight;
        
        const wellClogs = heights[wellColumn];
        const clogPenalty = weights.wellClogs * wellClogs;
        
        const lineClearBonus = weights.lineClearBonus * (clearedLines * clearedLines);

        let droughtPenalty = 0;
        if (iPieceDrought > DROUGHT_THRESHOLD) {
            const wellDepth = heights[neighborColumn] - heights[wellColumn];
            if (wellDepth > 3) {
                const excessDrought = iPieceDrought - DROUGHT_THRESHOLD;
                droughtPenalty = excessDrought * wellDepth * weights.droughtPenalty;
            }
        }

        return holePenalty + bumpinessPenalty + heightPenalty + clogPenalty + lineClearBonus + droughtPenalty;
    }
    
    // --- 'survival' strategy logic ---
    const holes = getHoles(grid);
    const aggregateHeight = getAggregateHeight(heights);
    const bumpiness = getBumpiness(heights);

    let score = (
        (weights.aggregateHeight || 0) * aggregateHeight +
        (weights.completedLines || 0) * clearedLines +
        (weights.holes || 0) * holes +
        (weights.bumpiness || 0) * bumpiness
    );
    
    if (holesBeforeClear !== null && clearedLines > 0) {
        const holesReduced = holesBeforeClear - holes;
        if (holesReduced > 0) {
            score += (weights.holeReduction || 0) * holesReduced;
        }
    }

    const maxHeight = Math.max(...heights);
    if (maxHeight > DANGER_HEIGHT_THRESHOLD) {
        const centerCols = [3, 4, 5, 6];
        let centerClogHeight = 0;
        for (const c of centerCols) {
            centerClogHeight += heights[c];
        }
        score += (weights.centerClog || 0) * centerClogHeight;
    }

    return score;
}

function evaluateAllPossiblePlacements(grid, piece, strategy, weights, iPieceDrought) {
    let bestScore = Infinity;

    if (!piece || typeof piece.type === 'undefined') {
        return 0; // No next piece, no future score to add
    }

    for (let rotation = 0; rotation < blockCoords[piece.type].length; rotation++) {
        const tempPiece = { ...piece, rotation };

        for (let x = -2; x < COLS; x++) {
            tempPiece.x = x;
            if (collidesWithGrid(grid, tempPiece, 0, 0, 0)) continue;

            let y = 0;
            while (!collidesWithGrid(grid, { ...tempPiece, y: y + 1 }, 0, 0, 0)) {
                y++;
            }
            tempPiece.y = y;

            const tempGrid = JSON.parse(JSON.stringify(grid));
            const shape = blockCoords[tempPiece.type][tempPiece.rotation];
            for (const coord of shape) {
                const col = tempPiece.x + coord[0];
                const row = tempPiece.y + coord[1];
                 if (row >= 0 && row < GRID_HEIGHT && col >= 0 && col < COLS) {
                    tempGrid[row][col] = tempPiece.type + 1;
                }
            }

            const holesBeforeClear = getHoles(tempGrid);
            const { grid: finalGrid, clearedCount } = simulateLineClearing(tempGrid);
            const score = evaluateBoard(finalGrid, clearedCount, strategy, weights, iPieceDrought, holesBeforeClear);
            
            if (score < bestScore) {
                bestScore = score;
            }
        }
    }
    return bestScore;
}


// --- Main AI Logic (BFS Pathfinding) ---

function getPieceKey(piece) {
    return `${piece.x},${piece.y},${piece.rotation}`;
}

function simulateRotation(grid, piece, direction) {
    if (piece.type === 3) return null; // Block O

    const srsData = piece.type === BLOCK_I 
        ? (direction === 'R' ? rotIright : rotIleft)
        : (direction === 'R' ? rotJLTSZright : rotJLTSZleft);
    
    const tests = srsData[piece.rotation];
    const r = (direction === 'R' ? 1 : 3);

    for (const test of tests) {
        const [dx, dy] = test;
        if (!collidesWithGrid(grid, piece, dx, dy, r)) {
            return { ...piece, x: piece.x + dx, y: piece.y + dy, rotation: (piece.rotation + r) % 4 };
        }
    }
    return null; // No valid kick
}

export function findBestMove(state, strategy, weights) {
    let bestScore = Infinity;
    let bestPath = null;
    let bestTarget = null;
    const initialPiece = state.Block;
    const nextPiece = state.Next;

    let effectiveStrategy = strategy;
    if (strategy === 'rightWell' || strategy === 'leftWell') {
        const heights = getColumnHeights(state.grid);
        if (Math.max(...heights) > DANGER_HEIGHT_THRESHOLD) {
            effectiveStrategy = 'survival'; // Switch to survival mode
        }
    }

    if (!initialPiece || typeof initialPiece.type === 'undefined') {
        return { path: [], target: null };
    }

    const queue = [{ piece: initialPiece, path: [] }];
    const visited = new Set([getPieceKey(initialPiece)]);

    while (queue.length > 0) {
        const { piece, path } = queue.shift();

        if (collidesWithGrid(state.grid, piece, 0, 1, 0)) {
            const tempGrid = JSON.parse(JSON.stringify(state.grid));
            const shape = blockCoords[piece.type][piece.rotation];
            
            for (const coord of shape) {
                const col = piece.x + coord[0];
                const row = piece.y + coord[1];
                if (row >= 0 && row < GRID_HEIGHT && col >= 0 && col < COLS) {
                    tempGrid[row][col] = piece.type + 1;
                }
            }
            
            const holesBeforeClear = getHoles(tempGrid);
            const { grid: gridAfterCurrentMove, clearedCount } = simulateLineClearing(tempGrid);
            
            const currentMoveScore = evaluateBoard(gridAfterCurrentMove, clearedCount, effectiveStrategy, weights, state.iPieceDrought, holesBeforeClear);
            
            const nextPieceBestScore = evaluateAllPossiblePlacements(gridAfterCurrentMove, nextPiece, effectiveStrategy, weights, state.iPieceDrought);

            const lookaheadWeight = weights.lookaheadScore || 0.8;
            const totalScore = currentMoveScore + (nextPieceBestScore * lookaheadWeight);

            if (totalScore < bestScore) {
                bestScore = totalScore;
                bestPath = [...path, 'hardD'];
                bestTarget = piece;
            }
        }

        const actions = [
            { name: 'moveL', newPiece: { ...piece, x: piece.x - 1 }, isValid: !collidesWithGrid(state.grid, piece, -1, 0, 0) },
            { name: 'moveR', newPiece: { ...piece, x: piece.x + 1 }, isValid: !collidesWithGrid(state.grid, piece, 1, 0, 0) },
            { name: 'softD', newPiece: { ...piece, y: piece.y + 1 }, isValid: !collidesWithGrid(state.grid, piece, 0, 1, 0) },
            { name: 'rotateR', newPiece: simulateRotation(state.grid, piece, 'R') },
            { name: 'rotateL', newPiece: simulateRotation(state.grid, piece, 'L') }
        ];

        for (const action of actions) {
            if (action.newPiece && (action.isValid === undefined || action.isValid)) {
                const key = getPieceKey(action.newPiece);
                if (!visited.has(key)) {
                    visited.add(key);
                    queue.push({ piece: action.newPiece, path: [...path, action.name] });
                }
            }
        }
    }
    return { path: bestPath || ['hardD'], target: bestTarget }; // Failsafe
}

/**
 * Creates a new weights object with slightly modified values.
 * @param {object} baseWeights The starting weights object.
 * @param {number} mutationFactor The maximum percentage change (e.g., 0.1 for +/-10%).
 * @returns {object} A new object with mutated weights.
 */
export function mutateWeights(baseWeights, mutationFactor = 0.1) {
    const mutated = { ...baseWeights };
    for (const key in mutated) {
        const baseValue = baseWeights[key];
        if (baseValue === 0) continue;

        // Use a smaller mutation factor for rewards (negative numbers) to be more gentle
        const factor = baseValue < 0 ? mutationFactor / 1.5 : mutationFactor;
        const change = (Math.random() - 0.5) * 2 * factor; // Random value between -factor and +factor
        
        let newValue = baseValue * (1 + change);

        // Crucially, prevent a reward from becoming a penalty or vice-versa
        if (baseValue * newValue < 0) {
            newValue = baseValue; // Revert if sign flips, maintaining strategy integrity
        }
        
        mutated[key] = newValue;
    }
    return mutated;
}