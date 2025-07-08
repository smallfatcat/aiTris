/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { createInitialState, finishLineClear, moveLeft, moveRight, rotateLeft, rotateRight, hardDrop, moveDown } from './game.js';
import { initWebglContext, createProjectionMatrix, getGameBoardDrawData, getNextPieceDrawData, getDividerDrawData, clearCanvas, drawScene, getPreviewFrameDrawData, getTextDrawData } from './render.js';
import { findBestMove, mutateWeights, BASE_SURVIVAL_WEIGHTS, BASE_WELL_WEIGHTS } from './ai.js';

// --- UI Elements ---
const h1 = document.querySelector('h1');
const mainContainer = document.getElementById('main-container');
const startLevelInput = document.getElementById('startlevel') as HTMLInputElement;
const resetButton = document.getElementById('reset-button') as HTMLButtonElement;
const trainingModeButton = document.getElementById('training-mode-button') as HTMLButtonElement;
const speedSlider = document.getElementById('speed-slider') as HTMLInputElement;
const speedLabel = document.getElementById('speed-label') as HTMLElement;

// --- Game Instance Definition ---
class GameInstance {
    id;
    strategy;
    weights; // AI personality

    // Rendering State
    canvas: HTMLCanvasElement;
    renderer;
    projectionMatrix;

    // Game State
    state;
    isClearing = false;
    clearStartTime = 0;

    // AI State
    aiState = 'PLANNING';
    aiMoveQueue = [];
    aiTargetPiece = null;
    aiNextActionTime = 0;
    aiActionInProgress = false;
    aiCurrentActionType = null;
    aiCurrentActionCount = 0;
    
    constructor(id, strategy, weights, canvas, projectionMatrix) {
        this.id = id;
        this.strategy = strategy;
        this.weights = weights;
        this.canvas = canvas;
        this.renderer = initWebglContext(this.canvas);
        this.projectionMatrix = projectionMatrix;
    }
    
    reset(startLevel, pieceQueue) {
        this.state = createInitialState(startLevel, pieceQueue);
        this.isClearing = false;
        this.clearStartTime = 0;
        this.resetAiExecutionState();
    }
    
    resetAiExecutionState() {
        this.aiState = 'PLANNING';
        this.aiMoveQueue = [];
        this.aiTargetPiece = null;
        this.aiActionInProgress = false;
        this.aiCurrentActionType = null;
        this.aiCurrentActionCount = 0;
        this.aiNextActionTime = Date.now();
    }

    handleAiAction(action) {
        switch (action) {
            case 'moveL': moveLeft(this.state); break;
            case 'moveR': moveRight(this.state); break;
            case 'rotateL': rotateLeft(this.state); break;
            case 'rotateR': rotateRight(this.state); break;
            case 'softD': moveDown(this.state); break;
            case 'hardD': hardDrop(this.state); break;
        }
    }
}

// --- Global App State ---
let currentMode = 'battle'; // 'battle' or 'training'
let animationFrameId;
let pieceQueue = [];
const PIECE_QUEUE_SIZE = 10000;

// Game Instances
let games: GameInstance[] = [];
let baselineWeights = { ...BASE_WELL_WEIGHTS };
let trainedSkilledWeights: object | null = null;


// AI timing state
const baseAiTimings = {
    AI_PLANNING_DELAY: 100, // ms to "think" after a piece is placed
    AI_ACTION_DELAY: 40,  // ms between each single move/rotate action
    timeDelayDas: 120, // Auto-shift delay
    timeDelayARE: 40,  // Auto-repeat delay
    CLEAR_DELAY: 300 // ms for line clear animation
};
let aiTimings = { ...baseAiTimings };

function updateSpeed() {
    const sliderValue = parseInt(speedSlider.value, 10);
    const speedFactor = sliderValue / 50.0; // slider [0, 100] -> factor [0, 2]

    if (currentMode === 'training') {
        // In training mode, make non-movement delays zero for max simulation speed.
        aiTimings.AI_PLANNING_DELAY = 0;
        aiTimings.CLEAR_DELAY = 0;
        aiTimings.AI_ACTION_DELAY = 0; // Single moves/rotations are instant.

        // The slider now ONLY controls auto-repeat speed (DAS/ARE).
        aiTimings.timeDelayDas = baseAiTimings.timeDelayDas * speedFactor;
        aiTimings.timeDelayARE = baseAiTimings.timeDelayARE * speedFactor;
    } else { // Battle mode
        aiTimings.AI_PLANNING_DELAY = baseAiTimings.AI_PLANNING_DELAY * speedFactor;
        aiTimings.AI_ACTION_DELAY = baseAiTimings.AI_ACTION_DELAY * speedFactor;
        aiTimings.timeDelayDas = baseAiTimings.timeDelayDas * speedFactor;
        aiTimings.timeDelayARE = baseAiTimings.timeDelayARE * speedFactor;
        aiTimings.CLEAR_DELAY = Math.max(50, baseAiTimings.CLEAR_DELAY * speedFactor);
    }

    if (sliderValue === 0) { speedLabel.textContent = 'Superhuman'; }
    else if (sliderValue < 40) { speedLabel.textContent = 'Fast'; }
    else if (sliderValue < 60) { speedLabel.textContent = 'Normal'; }
    else if (sliderValue < 85) { speedLabel.textContent = 'Slow'; }
    else { speedLabel.textContent = 'Very Slow'; }
}


function updateGame(game) {
    if (game.isClearing) {
        if (Date.now() - game.clearStartTime > aiTimings.CLEAR_DELAY) {
            game.isClearing = false;
            finishLineClear(game.state);
            game.resetAiExecutionState();
        }
        return; 
    }

    if (game.state.linesBeingCleared) {
        game.isClearing = true;
        game.clearStartTime = Date.now();
        game.aiMoveQueue = [];
        game.aiTargetPiece = null;
        return;
    }

    if (game.state.gameOver) {
        return;
    }
    
    // AI LOGIC
    if (Date.now() < game.aiNextActionTime) {
         // Wait
    } else if (game.aiState === 'PLANNING') {
        const { path, target } = findBestMove(game.state, game.strategy, game.weights);
        game.aiMoveQueue = path;
        game.aiTargetPiece = target;
        game.aiState = 'EXECUTING';
        game.aiNextActionTime = Date.now();

    } else if (game.aiState === 'EXECUTING') {
        if (game.aiActionInProgress) {
            game.handleAiAction(game.aiCurrentActionType);
            game.aiCurrentActionCount--;
            if (game.aiCurrentActionCount > 0) {
                game.aiNextActionTime = Date.now() + aiTimings.timeDelayARE;
            } else {
                game.aiActionInProgress = false;
                game.aiNextActionTime = Date.now();
            }
        } else {
            if (game.aiMoveQueue.length === 0) {
                game.aiState = 'PLANNING';
                game.aiNextActionTime = Date.now() + aiTimings.AI_PLANNING_DELAY;
            } else {
                const nextMove = game.aiMoveQueue.shift();

                if (nextMove === 'moveL' || nextMove === 'moveR') {
                    let moveCount = 1;
                    while (game.aiMoveQueue.length > 0 && game.aiMoveQueue[0] === nextMove) {
                        game.aiMoveQueue.shift();
                        moveCount++;
                    }
                    game.handleAiAction(nextMove);
                    if (moveCount > 1) {
                        game.aiActionInProgress = true;
                        game.aiCurrentActionType = nextMove;
                        game.aiCurrentActionCount = moveCount - 1;
                        game.aiNextActionTime = Date.now() + aiTimings.timeDelayDas;
                    } else {
                        game.aiNextActionTime = Date.now() + aiTimings.AI_ACTION_DELAY;
                    }
                } else {
                    game.handleAiAction(nextMove);
                    if(nextMove === 'hardD') {
                        game.aiState = 'PLANNING';
                        game.aiNextActionTime = Date.now() + aiTimings.AI_PLANNING_DELAY;
                    } else {
                         game.aiNextActionTime = Date.now() + aiTimings.AI_ACTION_DELAY;
                    }
                }
            }
        }
    }
}


function draw() {
    if (games.length === 0 || !games[0].renderer) return;

    // Both modes now use a single canvas, so the logic is unified.
    const renderer = games[0].renderer;
    const projectionMatrix = games[0].projectionMatrix;

    // 1. Clear the canvas once.
    clearCanvas(renderer.gl);

    // 2. Aggregate draw data from all games.
    let allPositions = [];
    let allColors = [];

    if (currentMode === 'battle') {
        for (const game of games) {
            const drawData = getBattleModeDrawData(game);
            allPositions.push(...drawData.positions);
            allColors.push(...drawData.colors);
        }
    } else { // Training mode
        games.forEach((game, index) => {
            const drawData = getTrainingModeDrawData(game, index);
            allPositions.push(...drawData.positions);
            allColors.push(...drawData.colors);
        });
    }

    // 3. Draw everything in a single call.
    drawScene(renderer.gl, renderer.programInfo, projectionMatrix, allPositions, allColors);
}

// --- DRAW DATA GENERATORS ---

const TEXT_CHAR_W = 0.3;
const TEXT_CHAR_H = 0.55;
const TEXT_LINE_H = 0.9;
const LABEL_COLOR = '#cccccc';
const VALUE_COLOR = '#f0f000';

function getRightAlignedTextData(text, x_right, y, w, h, color) {
    const textStr = text.toString();
    const textWidth = textStr.length * (w * 1.25) - (w * 0.25);
    return getTextDrawData(textStr, x_right - textWidth, y, w, h, color);
}

function getBattleModeDrawData(game: GameInstance) {
    const GUTTER_WIDTH = 5;
    const BOARD_WIDTH = 10;
    const DIVIDER_WIDTH = 0.5;
    const PREVIEW_BOX_W = 4;
    const PREVIEW_BOX_H = 4;
    
    const isGame1 = game.id === 1;
    const boardOffset = isGame1 ? GUTTER_WIDTH : (GUTTER_WIDTH + BOARD_WIDTH + DIVIDER_WIDTH);
    const previewX = isGame1 ? (GUTTER_WIDTH - PREVIEW_BOX_W) / 2 : boardOffset + BOARD_WIDTH + (GUTTER_WIDTH - PREVIEW_BOX_W) / 2;
    const previewY = 14;

    const gameData = getGameBoardDrawData(game.state, game.aiTargetPiece, game.isClearing, game.clearStartTime, boardOffset, 0, aiTimings.CLEAR_DELAY);
    const frameData = getPreviewFrameDrawData(previewX, previewY, PREVIEW_BOX_W, PREVIEW_BOX_H);
    const nextPieceData = getNextPieceDrawData(game.state.Next, previewX, previewY);
    
    const text_y_start = 12;
    const label_x = previewX;
    const value_x_right = previewX + PREVIEW_BOX_W;
    const scoreLabel = getTextDrawData('SCORE', label_x, text_y_start, TEXT_CHAR_W, TEXT_CHAR_H, LABEL_COLOR);
    const scoreValue = getRightAlignedTextData(game.state.score, value_x_right, text_y_start, TEXT_CHAR_W, TEXT_CHAR_H, VALUE_COLOR);
    const linesLabel = getTextDrawData('LINES', label_x, text_y_start - TEXT_LINE_H, TEXT_CHAR_W, TEXT_CHAR_H, LABEL_COLOR);
    const linesValue = getRightAlignedTextData(game.state.lines, value_x_right, text_y_start - TEXT_LINE_H, TEXT_CHAR_W, TEXT_CHAR_H, VALUE_COLOR);
    const levelLabel = getTextDrawData('LEVEL', label_x, text_y_start - 2 * TEXT_LINE_H, TEXT_CHAR_W, TEXT_CHAR_H, LABEL_COLOR);
    const levelValue = getRightAlignedTextData(game.state.level, value_x_right, text_y_start - 2 * TEXT_LINE_H, TEXT_CHAR_W, TEXT_CHAR_H, VALUE_COLOR);

    let allPositions = [...gameData.positions, ...frameData.positions, ...nextPieceData.positions, ...scoreLabel.positions, ...scoreValue.positions, ...linesLabel.positions, ...linesValue.positions, ...levelLabel.positions, ...levelValue.positions];
    let allColors = [...gameData.colors, ...frameData.colors, ...nextPieceData.colors, ...scoreLabel.colors, ...scoreValue.colors, ...linesLabel.colors, ...linesValue.colors, ...levelLabel.colors, ...levelValue.colors];

    if (game.strategy === 'rightWell' || game.strategy === 'leftWell') {
        const droughtLabel = getTextDrawData('DROUGHT', label_x, text_y_start - 3 * TEXT_LINE_H, TEXT_CHAR_W, TEXT_CHAR_H, LABEL_COLOR);
        const droughtValue = getRightAlignedTextData(game.state.iPieceDrought, value_x_right, text_y_start - 3 * TEXT_LINE_H, TEXT_CHAR_W, TEXT_CHAR_H, VALUE_COLOR);
        allPositions.push(...droughtLabel.positions, ...droughtValue.positions);
        allColors.push(...droughtLabel.colors, ...droughtValue.colors);
    }
    
    // Only game 1 is responsible for drawing the divider
    if (isGame1) {
        const dividerData = getDividerDrawData(GUTTER_WIDTH + BOARD_WIDTH);
        allPositions.push(...dividerData.positions);
        allColors.push(...dividerData.colors);
    }

    return { positions: allPositions, colors: allColors };
}

function getTrainingModeDrawData(game: GameInstance, index: number) {
    const NUM_COLS = 3;
    const TOTAL_WORLD_WIDTH = 46.5;
    const TOTAL_WORLD_HEIGHT = 60;
    const GAME_VIEW_WIDTH = TOTAL_WORLD_WIDTH / NUM_COLS;   // 15.5
    const GAME_VIEW_HEIGHT = TOTAL_WORLD_HEIGHT / NUM_COLS; // 20

    // Calculate offsets for the 3x3 grid.
    // The Y-axis is inverted by the projection matrix (y=0 is top).
    // The games should be ordered 1-3 (top), 4-6 (middle), 7-9 (bottom).
    const col = index % NUM_COLS;
    const row = Math.floor(index / NUM_COLS);
    const offsetX = col * GAME_VIEW_WIDTH;
    const offsetY = row * GAME_VIEW_HEIGHT;

    const BOARD_WIDTH = 10;
    const PREVIEW_BOX_W = 4;
    const PREVIEW_BOX_H = 4;

    const boardOffset = offsetX + 0.5; // Add internal padding
    const previewX = boardOffset + BOARD_WIDTH + 0.5;
    const previewY = offsetY + 14;

    const gameData = getGameBoardDrawData(game.state, game.aiTargetPiece, game.isClearing, game.clearStartTime, boardOffset, offsetY, aiTimings.CLEAR_DELAY);
    const frameData = getPreviewFrameDrawData(previewX, previewY, PREVIEW_BOX_W, PREVIEW_BOX_H);
    const nextPieceData = getNextPieceDrawData(game.state.Next, previewX, previewY);

    // --- Text layout ---
    const titleText = `AI ${game.id}`;
    const titleCharW = TEXT_CHAR_W * 1.1;
    const titleCharH = TEXT_CHAR_H * 1.1;
    const titleWidth = titleText.length * (titleCharW * 1.25) - (titleCharW * 0.25);
    
    // Center the title horizontally under the preview box.
    const titleX = previewX + (PREVIEW_BOX_W / 2) - (titleWidth / 2);
    // Position it vertically right under the preview box.
    const titleY = previewY - titleCharH - 0.3; // Small gap
    
    const titleLabel = getTextDrawData(titleText, titleX, titleY, titleCharW, titleCharH, '#ffffff');
    
    // Position other labels below the title.
    const text_y_start = titleY - TEXT_LINE_H;
    const label_x = previewX;
    const value_x_right = previewX + PREVIEW_BOX_W;

    const scoreLabel = getTextDrawData('SCORE', label_x, text_y_start, TEXT_CHAR_W, TEXT_CHAR_H, LABEL_COLOR);
    const scoreValue = getRightAlignedTextData(game.state.score, value_x_right, text_y_start, TEXT_CHAR_W, TEXT_CHAR_H, VALUE_COLOR);
    const linesLabel = getTextDrawData('LINES', label_x, text_y_start - TEXT_LINE_H, TEXT_CHAR_W, TEXT_CHAR_H, LABEL_COLOR);
    const linesValue = getRightAlignedTextData(game.state.lines, value_x_right, text_y_start - TEXT_LINE_H, TEXT_CHAR_W, TEXT_CHAR_H, VALUE_COLOR);

    const allPositions = [...gameData.positions, ...frameData.positions, ...nextPieceData.positions, ...titleLabel.positions, ...scoreLabel.positions, ...scoreValue.positions, ...linesLabel.positions, ...linesValue.positions];
    const allColors = [...gameData.colors, ...frameData.colors, ...nextPieceData.colors, ...titleLabel.colors, ...scoreLabel.colors, ...scoreValue.colors, ...linesLabel.colors, ...linesValue.colors];

    return { positions: allPositions, colors: allColors };
}


function animate() {
    games.forEach(updateGame);
    draw();

    // Check for automatic training restart
    if (currentMode === 'training') {
        const LINE_COMPLETION_TARGET = 200;
        const allGamesFinished = games.every(game => 
            game.state.gameOver || game.state.lines >= LINE_COMPLETION_TARGET
        );

        if (allGamesFinished && games.length > 0) {
            // Find the best game based on score/lines ratio
            let bestGame = null;
            let bestPerformance = -1;
            
            for (const game of games) {
                // Handle case where lines is 0 to avoid division by zero. Such games are ranked lowest.
                const performance = game.state.lines > 0 ? game.state.score / game.state.lines : -1;
                
                if (performance > bestPerformance) {
                    bestPerformance = performance;
                    bestGame = game;
                }
            }
            
            // If a best game was found (i.e., at least one game cleared a line), use it.
            if (bestGame && bestPerformance > -1) {
                console.log(`Training session complete. New baseline from AI ${bestGame.id} (Score/Lines: ${bestPerformance.toFixed(2)}).`);
                baselineWeights = { ...bestGame.weights };
            } else {
                console.log("All games failed to clear any lines. Restarting with same baseline.");
            }

            // Restart the entire training setup
            setupAndStartGames();
            return; // Exit here to prevent the old animation loop from continuing
        }
    }

    animationFrameId = requestAnimationFrame(animate);
}

function generatePieceQueue() {
    pieceQueue = [];
    for(let i = 0; i < PIECE_QUEUE_SIZE; i++) {
        pieceQueue.push(Math.floor(Math.random() * 7));
    }
}

// --- MODE MANAGEMENT & INITIALIZATION ---

function selectBaseline(index: number) {
    if (currentMode !== 'training' || !games[index]) return;
    console.log(`Selecting AI ${games[index].id} as new baseline.`);
    baselineWeights = { ...games[index].weights };
    setupAndStartGames(); // Restart with new baseline
}

function useInBattle(index: number) {
    if (currentMode !== 'training' || !games[index]) return;
    console.log(`Using AI ${games[index].id} in battle mode.`);
    trainedSkilledWeights = { ...games[index].weights };
    toggleMode(); // This switches to battle mode and calls init()
}

function createStrategySelector(id: string, defaultStrategy: string): string {
    const trainedOption = trainedSkilledWeights ? `<option value="trained" ${defaultStrategy === 'trained' ? 'selected' : ''}>Trained AI</option>` : '';
    return `
        <div class="strategy-selector">
            <label for="${id}">Strategy</label>
            <select name="${id}" id="${id}">
                ${trainedOption}
                <option value="rightWell" ${defaultStrategy === 'rightWell' ? 'selected' : ''}>Right Well</option>
                <option value="leftWell" ${defaultStrategy === 'leftWell' ? 'selected' : ''}>Left Well</option>
                <option value="survival" ${defaultStrategy === 'survival' ? 'selected' : ''}>Survival</option>
            </select>
        </div>
    `;
}

function createBattleUI() {
    // Determine default for right AI. If trained weights exist, use them, otherwise default to a well.
    const rightDefault = trainedSkilledWeights ? 'trained' : 'rightWell';
    
    mainContainer.innerHTML = `
      <div id="battle-container">
        <div class="side-info" id="side-info-1">
            <h2>LEFT AI</h2>
            ${createStrategySelector('left-strategy', 'survival')}
        </div>
        <div id="board-wrapper">
            <canvas id="battle-canvas" width="610" height="400"></canvas>
        </div>
        <div class="side-info" id="side-info-2">
            <h2>RIGHT AI</h2>
            ${createStrategySelector('right-strategy', rightDefault)}
        </div>
      </div>
    `;
}

function createTrainingUI() {
    mainContainer.innerHTML = `
        <div id="training-container">
            <div id="board-wrapper">
                <canvas id="training-canvas" width="465" height="600"></canvas>
            </div>
            <div id="training-info-grid">
                ${Array.from({length: 9}, (_, i) => i + 1).map(i => `
                    <div class="training-info-panel" id="training-info-panel-${i}">
                        <div class="weights-display" id="weights-display-${i}"></div>
                        <div class="info-button-container">
                            <button class="baseline-button" data-index="${i-1}">MAKE BASELINE</button>
                            <button class="use-battle-button" data-index="${i-1}">USE IN BATTLE</button>
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
    document.querySelectorAll('.baseline-button').forEach(button => {
        button.addEventListener('click', (e) => {
            const index = parseInt((e.target as HTMLElement).dataset.index, 10);
            selectBaseline(index);
        });
    });
    document.querySelectorAll('.use-battle-button').forEach(button => {
        button.addEventListener('click', (e) => {
            const index = parseInt((e.target as HTMLElement).dataset.index, 10);
            useInBattle(index);
        });
    });
}


function getWeightsForStrategy(strategy: string) {
    switch (strategy) {
        case 'trained':
            // Provide a failsafe in case this is selected but weights are null
            return trainedSkilledWeights || BASE_SURVIVAL_WEIGHTS;
        case 'survival':
            return BASE_SURVIVAL_WEIGHTS;
        case 'rightWell':
        case 'leftWell':
            return BASE_WELL_WEIGHTS;
        default:
            return BASE_SURVIVAL_WEIGHTS;
    }
}

function initBattleMode() {
    h1.textContent = 'aitris AI BATTLE';
    trainingModeButton.textContent = 'Enter Training Mode';
    createBattleUI();

    const canvas = document.getElementById('battle-canvas') as HTMLCanvasElement;
    const projectionMatrix = createProjectionMatrix(30.5, 20);

    const leftStrategySelect = document.getElementById('left-strategy') as HTMLSelectElement;
    const rightStrategySelect = document.getElementById('right-strategy') as HTMLSelectElement;

    const leftStrategy = leftStrategySelect.value;
    const rightStrategy = rightStrategySelect.value;

    const leftWeights = getWeightsForStrategy(leftStrategy);
    const rightWeights = getWeightsForStrategy(rightStrategy);
    
    games = [
        new GameInstance(1, leftStrategy, leftWeights, canvas, projectionMatrix),
        new GameInstance(2, rightStrategy, rightWeights, canvas, projectionMatrix)
    ];

    // Add event listeners for changing strategies mid-game
    leftStrategySelect.addEventListener('change', () => {
        if (games[0]) {
            const newStrategy = leftStrategySelect.value;
            games[0].strategy = newStrategy;
            games[0].weights = getWeightsForStrategy(newStrategy);
            games[0].resetAiExecutionState();
        }
    });

    rightStrategySelect.addEventListener('change', () => {
        if (games[1]) {
            const newStrategy = rightStrategySelect.value;
            games[1].strategy = newStrategy;
            games[1].weights = getWeightsForStrategy(newStrategy);
            games[1].resetAiExecutionState();
        }
    });
}

function initTrainingMode() {
    h1.textContent = 'AI TRAINING MODE';
    trainingModeButton.textContent = 'Back to Battle';
    createTrainingUI();
    games = [];

    const canvas = document.getElementById('training-canvas') as HTMLCanvasElement;
    const projectionMatrix = createProjectionMatrix(46.5, 60);

    for (let i = 1; i <= 9; i++) {
        // AI 1 is the unmodified baseline. Others are mutations.
        const currentWeights = (i === 1) ? baselineWeights : mutateWeights(baselineWeights, 0.2);
        const game = new GameInstance(i, 'rightWell', currentWeights, canvas, projectionMatrix);
        games.push(game);

        const weightsDisplay = document.getElementById(`weights-display-${i}`);
        if (!weightsDisplay) continue;

        let displayHtml = '';
        const weightEntries = [];

        if (i === 1) {
            displayHtml = `<h4>AI 1 BASELINE</h4>`;
            for (const key in currentWeights) {
                 weightEntries.push(`
                    <div class="weight-entry">
                        <span class="weight-name" title="${key}">${key}</span>
                        <span class="weight-value">${currentWeights[key].toFixed(3)}</span>
                    </div>
                `);
            }
        } else {
            displayHtml = `<h4>AI ${i} MUTATIONS</h4>`;
            for (const key in baselineWeights) {
                const baseValue = baselineWeights[key];
                const newValue = currentWeights[key];
                const diff = newValue - baseValue;

                if (Math.abs(diff) > 1e-9 && baseValue !== 0) {
                    const percentChange = (diff / baseValue) * 100;
                    const changeClass = percentChange > 0 ? 'positive-change' : 'negative-change';
                    const sign = percentChange > 0 ? '+' : '';
                    
                    weightEntries.push(`
                        <div class="weight-entry">
                            <span class="weight-name" title="${key}">${key}</span>
                            <span class="weight-value">${newValue.toFixed(3)}</span>
                            <span class="weight-change ${changeClass}">(${sign}${percentChange.toFixed(1)}%)</span>
                        </div>
                    `);
                }
            }
        }
        
        if (i > 1 && weightEntries.length === 0) {
             displayHtml += '<div class="no-change-note">No significant mutations.</div>';
        } else {
            displayHtml += weightEntries.join('');
        }
        
        weightsDisplay.innerHTML = displayHtml;
    }
}


function resetCurrentGames() {
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
    }
    
    generatePieceQueue();
    const startLevel = parseInt(startLevelInput.value, 10) || 0;
    
    for (const game of games) {
        game.reset(startLevel, pieceQueue);
    }

    animate();
}

function setupAndStartGames() {
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
    }
    
    generatePieceQueue();
    const startLevel = parseInt(startLevelInput.value, 10) || 0;
    
    games = [];
    mainContainer.innerHTML = '';
    
    if (currentMode === 'battle') {
        initBattleMode();
    } else {
        initTrainingMode();
    }
    
    for (const game of games) {
        game.reset(startLevel, pieceQueue);
    }

    updateSpeed();
    animate();
}

function toggleMode() {
    currentMode = (currentMode === 'battle') ? 'training' : 'battle';
    setupAndStartGames();
}

resetButton.addEventListener('click', resetCurrentGames);
trainingModeButton.addEventListener('click', toggleMode);
speedSlider.addEventListener('input', updateSpeed);


// Start the game
setupAndStartGames();