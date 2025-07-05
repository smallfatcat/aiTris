import { blockCoords, blockColors } from './data.js';

const COLS = 10;
const ROWS = 20;
const HIDDEN_ROWS = 4;

// Vertex shader program
const vsSource = `
    attribute vec2 a_position;
    attribute vec4 a_color;

    uniform mat4 u_projectionMatrix;
    
    varying lowp vec4 v_color;

    void main() {
        gl_Position = u_projectionMatrix * vec4(a_position, 0, 1);
        v_color = a_color;
    }
`;

// Fragment shader program
const fsSource = `
    precision mediump float;
    varying lowp vec4 v_color;

    void main() {
        gl_FragColor = v_color;
    }
`;

function createShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error('An error occurred compiling the shaders: ' + gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
    }
    return shader;
}

function createProgram(gl, vertexShader, fragmentShader) {
    const program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        console.error('Unable to initialize the shader program: ' + gl.getProgramInfoLog(program));
        return null;
    }
    return program;
}

export function initWebglContext(canvas) {
    const gl = canvas.getContext('webgl', { alpha: true });
    if (!gl) {
        console.error("WebGL not supported!");
        return null;
    }

    const vertexShader = createShader(gl, gl.VERTEX_SHADER, vsSource);
    const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fsSource);
    const program = createProgram(gl, vertexShader, fragmentShader);

    const programInfo = {
        program,
        attribLocations: {
            position: gl.getAttribLocation(program, 'a_position'),
            color: gl.getAttribLocation(program, 'a_color'),
        },
        uniformLocations: {
            projectionMatrix: gl.getUniformLocation(program, 'u_projectionMatrix'),
        },
    };

    return { gl, programInfo };
}

export function createProjectionMatrix(width, height) {
    const left = 0, right = width, bottom = 0, top = height, near = -1, far = 1;
    const lr = 1 / (right - left), bt = 1 / (bottom - top), nf = 1 / (far - near);
    return [
        2 * lr, 0, 0, 0,
        0, 2 * bt, 0, 0,
        0, 0, -2 * nf, 0,
        -(right + left) * lr, -(bottom + top) * bt, -(far + near) * nf, 1
    ];
}

export function hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? [
        parseInt(result[1], 16) / 255,
        parseInt(result[2], 16) / 255,
        parseInt(result[3], 16) / 255,
    ] : [0, 0, 0];
}

function lightenColor(rgb, factor) {
    return [
        Math.min(1.0, rgb[0] * (1 + factor)),
        Math.min(1.0, rgb[1] * (1 + factor)),
        Math.min(1.0, rgb[2] * (1 + factor)),
    ];
}

function darkenColor(rgb, factor) {
    return [
        rgb[0] * (1 - factor),
        rgb[1] * (1 - factor),
        rgb[2] * (1 - factor),
    ];
}

function addQuad(positions, colors, x, y, w, h, color, alpha = 1.0) {
    // A quad is two triangles (6 vertices)
    positions.push(x, y, x + w, y, x, y + h, x, y + h, x + w, y, x + w, y + h);
    for (let i = 0; i < 6; i++) {
        colors.push(color[0], color[1], color[2], alpha);
    }
}

function addShadedBlock(positions, colors, x, y, baseRgb, alpha = 1.0) {
    const outlineWidth = 0.05;
    const blackColor = [0, 0, 0];

    addQuad(positions, colors, x, y, 1, 1, blackColor, alpha);

    const insetX = x + outlineWidth;
    const insetY = y + outlineWidth;
    const insetSize = 1 - (2 * outlineWidth);
    const bevelWidth = 0.15 * insetSize;
    const lightFactor = 0.4;
    const darkFactor = 0.4;
    const lightColor = lightenColor(baseRgb, lightFactor);
    const darkColor = darkenColor(baseRgb, darkFactor);

    addQuad(positions, colors, insetX, insetY, insetSize, bevelWidth, lightColor, alpha);
    addQuad(positions, colors, insetX, insetY + insetSize - bevelWidth, insetSize, bevelWidth, darkColor, alpha);
    const verticalBarY = insetY + bevelWidth;
    const verticalBarHeight = insetSize - (2 * bevelWidth);
    addQuad(positions, colors, insetX, verticalBarY, bevelWidth, verticalBarHeight, lightColor, alpha);
    addQuad(positions, colors, insetX + insetSize - bevelWidth, verticalBarY, bevelWidth, verticalBarHeight, darkColor, alpha);
    addQuad(positions, colors, insetX + bevelWidth, insetY + bevelWidth, insetSize - (2 * bevelWidth), insetSize - (2 * bevelWidth), baseRgb, alpha);
}


function addPieceOutline(positions, colors, piece, color, offsetX = 0, offsetY = 0) {
    const borderWidth = 0.08;
    const shape = blockCoords[piece.type][piece.rotation];
    const shapeSet = new Set(shape.map(c => `${c[0]},${c[1]}`));

    for (const coord of shape) {
        const [cx, cy] = coord;
        const x = piece.x + cx + offsetX;
        const y = piece.y + cy - HIDDEN_ROWS + offsetY;
        if (y + 1 < 0) continue;

        if (!shapeSet.has(`${cx},${cy + 1}`)) addQuad(positions, colors, x, y + 1 - borderWidth, 1, borderWidth, color, 1.0);
        if (!shapeSet.has(`${cx},${cy - 1}`)) addQuad(positions, colors, x, y, 1, borderWidth, color, 1.0);
        if (!shapeSet.has(`${cx - 1},${cy}`)) addQuad(positions, colors, x, y, borderWidth, 1, color, 1.0);
        if (!shapeSet.has(`${cx + 1},${cy}`)) addQuad(positions, colors, x + 1 - borderWidth, y, borderWidth, 1, color, 1.0);
    }
}

// --- DATA GENERATORS ---

const charMap = {
    '0': [[0,0,1,0.2],[0,0.8,1,0.2],[0,0,0.2,1],[0.8,0,0.2,1]],
    '1': [[0.4,0,0.2,1]],
    '2': [[0,0.8,1,0.2],[0,0.4,1,0.2],[0,0,1,0.2],[0.8,0.4,0.2,0.4],[0,0,0.2,0.4]],
    '3': [[0,0.8,1,0.2],[0,0.4,1,0.2],[0,0,1,0.2],[0.8,0,0.2,1]],
    '4': [[0,0.4,1,0.2],[0,0.8,0.2,0.2],[0.8,0,0.2,1],[0,0.4,0.2,0.6]],
    '5': [[0,0.8,1,0.2],[0,0.4,1,0.2],[0,0,1,0.2],[0,0.4,0.2,0.4],[0.8,0,0.2,0.4]],
    '6': [[0,0.8,1,0.2],[0,0.4,1,0.2],[0,0,1,0.2],[0,0,0.2,1],[0.8,0,0.2,0.4]],
    '7': [[0,0.8,1,0.2],[0.8,0,0.2,1]],
    '8': [[0,0.8,1,0.2],[0,0.4,1,0.2],[0,0,1,0.2],[0,0,0.2,1],[0.8,0,0.2,1]],
    '9': [[0,0.8,1,0.2],[0,0.4,1,0.2],[0.8,0,0.2,1],[0,0.4,0.2,0.4]],
    'A': [[0,0,0.2,1], [0.8,0,0.2,1], [0.2,0.8,0.6,0.2], [0.2,0.4,0.6,0.2]],
    'B': [[0,0,0.2,1],[0.2,0.8,0.6,0.2],[0.8,0.4,0.2,0.4],[0.2,0.4,0.6,0.2],[0.2,0,0.6,0.2],[0.8,0,0.2,0.4]],
    'S': [[0,0.8,1,0.2],[0,0.4,1,0.2],[0,0,1,0.2],[0,0.4,0.2,0.4],[0.8,0,0.2,0.4]],
    'C': [[0,0.8,1,0.2],[0,0,1,0.2],[0,0,0.2,1]],
    'O': [[0,0.8,1,0.2],[0,0,1,0.2],[0,0,0.2,1],[0.8,0,0.2,1]],
    'R': [[0,0.8,1,0.2],[0,0.4,1,0.2],[0,0,0.2,1],[0.8,0.4,0.2,0.6],[0.4,0.2,0.2,0.2],[0.6,0,0.2,0.2]],
    'E': [[0,0.8,1,0.2],[0,0.4,1,0.2],[0,0,1,0.2],[0,0,0.2,1]],
    'L': [[0,0,1,0.2],[0,0,0.2,1]],
    'I': [[0.4,0,0.2,1]],
    'N': [[0,0,0.2,1],[0.8,0,0.2,1],[0.2,0.6,0.2,0.2],[0.4,0.4,0.2,0.2],[0.6,0.2,0.2,0.2]],
    'V': [[0,0.6,0.2,0.4],[0.8,0.6,0.2,0.4],[0.2,0.3,0.2,0.3],[0.6,0.3,0.2,0.3],[0.4,0,0.2,0.3]],
    'D': [[0,0,0.2,1],[0.2,0.8,0.6,0.2],[0.8,0.2,0.2,0.6],[0.2,0,0.6,0.2]],
    'U': [[0,0,0.2,1],[0.2,0,0.6,0.2],[0.8,0,0.2,1]],
    'G': [[0.2,0.8,0.8,0.2],[0,0.2,0.2,0.6],[0.2,0,0.8,0.2],[0.8,0.2,0.2,0.4],[0.4,0.4,0.4,0.2]],
    'H': [[0,0,0.2,1],[0.8,0,0.2,1],[0.2,0.4,0.6,0.2]],
    'T': [[0,0.8,1,0.2],[0.4,0,0.2,1]],
    'M': [[0,0,0.2,1],[0.8,0,0.2,1],[0.2,0.6,0.2,0.2],[0.4,0.4,0.2,0.2],[0.6,0.6,0.2,0.2]],
    'K': [[0,0,0.2,1],[0.8,0.4,0.2,0.6],[0.2,0.4,0.6,0.2],[0.6,0,0.2,0.4]],
};

export function getTextDrawData(text, startX, startY, charWidth, charHeight, color) {
    const positions = [];
    const colors = [];
    const charSpacing = charWidth * 0.25;
    const rgbColor = hexToRgb(color);

    let currentX = startX;
    text = text.toString().toUpperCase();

    for (const char of text) {
        if (char === ' ') {
            currentX += charWidth + charSpacing;
            continue;
        }
        if (charMap[char]) {
            const quads = charMap[char];
            for (const quad of quads) {
                const [qx, qy, qw, qh] = quad;
                // Since the projection matrix inverts Y, we must also invert the character's internal Y.
                const invertedY = (1 - qy - qh);
                addQuad(
                    positions, colors,
                    currentX + (qx * charWidth),
                    startY + (invertedY * charHeight),
                    qw * charWidth,
                    qh * charHeight,
                    rgbColor, 1.0
                );
            }
        }
        currentX += charWidth + charSpacing;
    }

    return { positions, colors };
}


export function getGameBoardDrawData(state, aiTargetPiece = null, isClearing = false, clearStartTime = 0, offsetX = 0, offsetY = 0, clearDelay = 300) {
    const positions = [];
    const colors = [];

    // Locked blocks
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            const gridRow = r + HIDDEN_ROWS;
            const colorIndex = state.grid[gridRow][c];
            if (colorIndex) {
                const color = hexToRgb(blockColors[colorIndex]);
                let alpha = 1.0;
                if (isClearing && state.linesBeingCleared && state.linesBeingCleared.includes(gridRow)) {
                    const elapsedTime = Date.now() - clearStartTime;
                    alpha = Math.max(0, 1.0 - (elapsedTime / clearDelay));
                }
                addShadedBlock(positions, colors, c + offsetX, r + offsetY, color, alpha);
            }
        }
    }

    // Ghost piece
    if (aiTargetPiece) {
        const color = hexToRgb('#bbbbbb');
        addPieceOutline(positions, colors, aiTargetPiece, color, offsetX, offsetY);
    }

    // Active piece
    if (state.Block.type !== undefined && !state.linesBeingCleared) {
        const shape = blockCoords[state.Block.type][state.Block.rotation];
        const color = hexToRgb(blockColors[state.Block.type + 1]);
        for (const coord of shape) {
            const x = state.Block.x + coord[0] + offsetX;
            const y = state.Block.y + coord[1] - HIDDEN_ROWS + offsetY;
            if (y >= 0) {
                addShadedBlock(positions, colors, x, y, color);
            }
        }
    }
    
    return { positions, colors };
}


export function getNextPieceDrawData(piece, offsetX_units = 0, offsetY_units = 0) {
    const positions = [];
    const colors = [];

    if (piece && piece.type !== undefined) {
        const shape = blockCoords[piece.type][0];
        const color = hexToRgb(blockColors[piece.type + 1]);

        let minX = 4, maxX = -1, minY = 4, maxY = -1;
        for (const coord of shape) {
            minX = Math.min(minX, coord[0]);
            maxX = Math.max(maxX, coord[0]);
            minY = Math.min(minY, coord[1]);
            maxY = Math.max(maxY, coord[1]);
        }
        const pieceWidth = maxX - minX + 1;
        const pieceHeight = maxY - minY + 1;
        const offsetX = (4 - pieceWidth) / 2;
        const offsetY = (4 - pieceHeight) / 2;

        for (const coord of shape) {
            const x = (coord[0] - minX) + offsetX + offsetX_units;
            const y = (coord[1] - minY) + offsetY + offsetY_units;
            addShadedBlock(positions, colors, x, y, color);
        }
    }
    
    return { positions, colors };
}

export function getDividerDrawData(offsetX = 0) {
    const positions = [];
    const colors = [];
    const dividerColor = hexToRgb('#444');
    addQuad(positions, colors, offsetX, 0, 0.5, 20, dividerColor, 1.0);
    return { positions, colors };
}

export function getPreviewFrameDrawData(x, y, w, h) {
    const positions = [];
    const colors = [];
    const frameColor = hexToRgb('#444');
    const borderWidth = 0.1;
    const bgColor = hexToRgb(blockColors[0]);

    // Border (larger quad)
    addQuad(positions, colors, x, y, w, h, frameColor, 1.0);
    // Background (smaller quad on top)
    addQuad(positions, colors, 
        x + borderWidth, y + borderWidth, 
        w - (2 * borderWidth), h - (2 * borderWidth),
        bgColor, 1.0
    );

    return { positions, colors };
}


// --- RENDERING PRIMITIVES ---

export function clearCanvas(gl) {
    const bgColor = hexToRgb(blockColors[0]);
    gl.clearColor(bgColor[0], bgColor[1], bgColor[2], 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);
}

export function drawScene(gl, programInfo, projectionMatrix, positions, colors) {
    if (positions.length === 0) {
        return;
    }

    gl.useProgram(programInfo.program);
    gl.uniformMatrix4fv(programInfo.uniformLocations.projectionMatrix, false, projectionMatrix);

    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(programInfo.attribLocations.position);
    gl.vertexAttribPointer(programInfo.attribLocations.position, 2, gl.FLOAT, false, 0, 0);

    const colorBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(colors), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(programInfo.attribLocations.color);
    gl.vertexAttribPointer(programInfo.attribLocations.color, 4, gl.FLOAT, false, 0, 0);
    
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    gl.drawArrays(gl.TRIANGLES, 0, positions.length / 2);

    gl.disable(gl.BLEND);
}