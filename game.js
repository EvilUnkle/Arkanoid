(() => {
    'use strict';

    const canvas = document.getElementById('game');
    const ctx = canvas.getContext('2d');
    const scoreEl = document.getElementById('score');
    const livesEl = document.getElementById('lives');
    const levelEl = document.getElementById('level');
    const overlay = document.getElementById('overlay');
    const overlayTitle = document.getElementById('overlay-title');
    const overlayText = document.getElementById('overlay-text');
    const startBtn = document.getElementById('start-btn');

    let W = 0, H = 0, DPR = 1;

    // Игровые объекты
    const paddle = { w: 0, h: 0, x: 0, y: 0, targetX: 0 };
    const ball = { x: 0, y: 0, r: 0, dx: 0, dy: 0, speed: 0 };
    const bricks = [];
    const BRICK_COLS = 8;
    const BRICK_ROWS = 5;

    // Состояние
    let state = 'idle'; // idle | playing | paused | gameover
    let score = 0;
    let lives = 3;
    let level = 1;
    let lastTime = 0;
    let animationId = null;

    // Цвета кирпичей по ряду
    const BRICK_COLORS = ['#ff5252', '#ff9800', '#ffeb3b', '#4caf50', '#4dd0e1'];

    // ===== Управление (относительное) =====
    let lastPointerX = null;
    const keys = {};

    function resize() {
        const rect = canvas.getBoundingClientRect();
        DPR = Math.min(window.devicePixelRatio || 1, 2);
        W = rect.width;
        H = rect.height;
        canvas.width = W * DPR;
        canvas.height = H * DPR;
        ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

        paddle.w = Math.max(70, W * 0.22);
        paddle.h = 12;
        paddle.y = H - 40 - paddle.h;

        ball.r = Math.max(6, W * 0.014);
        ball.speed = Math.min(W, H) * 0.7;

        layoutBricks();
    }

    function layoutBricks() {
        if (bricks.length === 0) return;
        const padding = 8;
        const offsetTop = 20;
        const offsetLeft = padding;
        const totalPadding = padding * (BRICK_COLS + 1);
        const brickW = (W - totalPadding) / BRICK_COLS;
        const brickH = 22;

        bricks.forEach((b, i) => {
            const row = Math.floor(i / BRICK_COLS);
            const col = i % BRICK_COLS;
            b.w = brickW;
            b.h = brickH;
            b.x = offsetLeft + col * (brickW + padding);
            b.y = offsetTop + row * (brickH + padding);
        });
    }

    function createBricks() {
        bricks.length = 0;
        const bonusRows = Math.min(level - 1, 3);
        const rows = BRICK_ROWS + bonusRows;
        const padding = 8;
        const totalPadding = padding * (BRICK_COLS + 1);
        const brickW = (W - totalPadding) / BRICK_COLS;
        const brickH = 22;

        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < BRICK_COLS; col++) {
                bricks.push({
                    x: padding + col * (brickW + padding),
                    y: 20 + row * (brickH + padding),
                    w: brickW,
                    h: brickH,
                    alive: true,
                    color: BRICK_COLORS[row % BRICK_COLORS.length]
                });
            }
        }
    }

    function resetBall() {
        ball.x = W / 2;
        ball.y = paddle.y - ball.r - 2;
        const angle = (-Math.PI / 2) + (Math.random() - 0.5) * 0.6;
        ball.dx = Math.cos(angle) * ball.speed;
        ball.dy = Math.sin(angle) * ball.speed;
    }

    function startGame() {
        score = 0;
        lives = 3;
        level = 1;
        updateHUD();
        createBricks();
        paddle.x = (W - paddle.w) / 2;
        paddle.targetX = paddle.x;
        resetBall();
        state = 'playing';
        overlay.classList.add('hidden');
        lastTime = performance.now();
        if (animationId) cancelAnimationFrame(animationId);
        animationId = requestAnimationFrame(loop);
    }

    function nextLevel() {
        level++;
        updateHUD();
        createBricks();
        resetBall();
        state = 'playing';
        lastTime = performance.now();
    }

    function loseLife() {
        lives--;
        updateHUD();
        if (lives <= 0) {
            state = 'gameover';
            showOverlay('Игра окончена', `Твой счёт: ${score}`, 'Заново');
        } else {
            resetBall();
        }
    }

    function showOverlay(title, text, btn) {
        overlayTitle.textContent = title;
        overlayText.textContent = text;
        startBtn.textContent = btn;
        overlay.classList.remove('hidden');
    }

    function updateHUD() {
        scoreEl.textContent = score;
        livesEl.textContent = lives;
        levelEl.textContent = level;
    }

    // ===== Относительное управление пальцем =====
    // Палец двигается на Δx → платформа двигается на Δx * sensitivity.
    // Позиция пальца на экране значения не имеет.
    canvas.addEventListener('pointerdown', (e) => {
        if (state !== 'playing' && state !== 'paused') return;
        lastPointerX = e.clientX;
        if (canvas.setPointerCapture) {
            try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
        }
    });

    canvas.addEventListener('pointermove', (e) => {
        if ((state !== 'playing' && state !== 'paused') || lastPointerX === null) return;

        const dx = e.clientX - lastPointerX;
        lastPointerX = e.clientX;

        const sensitivity = 1.3; // 1.0 = 1:1, больше = быстрее реакция
        paddle.targetX += dx * sensitivity;
        paddle.targetX = Math.max(0, Math.min(W - paddle.w, paddle.targetX));
        paddle.x = paddle.targetX;
    });

    const endPointer = () => { lastPointerX = null; };
    canvas.addEventListener('pointerup', endPointer);
    canvas.addEventListener('pointercancel', endPointer);
    canvas.addEventListener('pointerleave', endPointer);

    // Клавиатура (десктоп)
    window.addEventListener('keydown', (e) => {
        keys[e.key] = true;
        if (e.key === ' ') e.preventDefault();
    });
    window.addEventListener('keyup', (e) => keys[e.key] = false);

    // ===== Физика и логика =====
    function update(dt) {
        if (state !== 'playing') return;

        // Клавиатура — относительное движение
        const keySpeed = W * 0.9;
        if (keys['ArrowLeft'] || keys['a'] || keys['A']) {
            paddle.targetX -= keySpeed * dt;
        }
        if (keys['ArrowRight'] || keys['d'] || keys['D']) {
            paddle.targetX += keySpeed * dt;
        }
        paddle.targetX = Math.max(0, Math.min(W - paddle.w, paddle.targetX));

        // Синхронизация: тач уже установил paddle.x = paddle.targetX
        paddle.x = paddle.targetX;

        // Движение мяча с подшагами (чтобы не пролетал сквозь)
        const steps = 3;
        const subDt = dt / steps;
        for (let s = 0; s < steps; s++) {
            ball.x += ball.dx * subDt;
            ball.y += ball.dy * subDt;

            // Стены
            if (ball.x - ball.r < 0) {
                ball.x = ball.r;
                ball.dx = Math.abs(ball.dx);
            }
            if (ball.x + ball.r > W) {
                ball.x = W - ball.r;
                ball.dx = -Math.abs(ball.dx);
            }
            if (ball.y - ball.r < 0) {
                ball.y = ball.r;
                ball.dy = Math.abs(ball.dy);
            }

            // Платформа
            if (ball.dy > 0 &&
                ball.y + ball.r >= paddle.y &&
                ball.y - ball.r <= paddle.y + paddle.h &&
                ball.x + ball.r >= paddle.x &&
                ball.x - ball.r <= paddle.x + paddle.w) {

                ball.y = paddle.y - ball.r;
                const hit = (ball.x - (paddle.x + paddle.w / 2)) / (paddle.w / 2);
                const angle = (-Math.PI / 2) + hit * (Math.PI / 3);
                const speed = Math.hypot(ball.dx, ball.dy) * 1.02;
                ball.dx = Math.cos(angle) * speed;
                ball.dy = Math.sin(angle) * speed;
            }

            // Кирпичи
            for (const b of bricks) {
                if (!b.alive) continue;
                if (ball.x + ball.r < b.x || ball.x - ball.r > b.x + b.w ||
                    ball.y + ball.r < b.y || ball.y - ball.r > b.y + b.h) continue;

                const overlapLeft = (ball.x + ball.r) - b.x;
                const overlapRight = (b.x + b.w) - (ball.x - ball.r);
                const overlapTop = (ball.y + ball.r) - b.y;
                const overlapBottom = (b.y + b.h) - (ball.y - ball.r);
                const minOverlap = Math.min(overlapLeft, overlapRight, overlapTop, overlapBottom);

                if (minOverlap === overlapLeft || minOverlap === overlapRight) {
                    ball.dx = -ball.dx;
                } else {
                    ball.dy = -ball.dy;
                }

                b.alive = false;
                score += 10;
                updateHUD();
                break;
            }
        }

        // Падение вниз
        if (ball.y - ball.r > H) {
            loseLife();
            return;
        }

        // Победа на уровне
        if (bricks.every(b => !b.alive)) {
            nextLevel();
        }
    }

    function render() {
        ctx.fillStyle = '#0a0a1a';
        ctx.fillRect(0, 0, W, H);

        // Сетка
        ctx.strokeStyle = 'rgba(77, 208, 225, 0.05)';
        ctx.lineWidth = 1;
        const grid = 40;
        for (let x = 0; x < W; x += grid) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, H);
            ctx.stroke();
        }
        for (let y = 0; y < H; y += grid) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(W, y);
            ctx.stroke();
        }

        // Кирпичи
        for (const b of bricks) {
            if (!b.alive) continue;
            ctx.fillStyle = b.color;
            ctx.shadowColor = b.color;
            ctx.shadowBlur = 10;
            roundRect(b.x, b.y, b.w, b.h, 4);
            ctx.fill();
            ctx.shadowBlur = 0;
        }

        // Платформа
        const grad = ctx.createLinearGradient(paddle.x, 0, paddle.x + paddle.w, 0);
        grad.addColorStop(0, '#4dd0e1');
        grad.addColorStop(1, '#9c27b0');
        ctx.fillStyle = grad;
        ctx.shadowColor = '#4dd0e1';
        ctx.shadowBlur = 15;
        roundRect(paddle.x, paddle.y, paddle.w, paddle.h, paddle.h / 2);
        ctx.fill();
        ctx.shadowBlur = 0;

        // Мяч
        ctx.fillStyle = '#fff';
        ctx.shadowColor = '#4dd0e1';
        ctx.shadowBlur = 20;
        ctx.beginPath();
        ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
    }

    function roundRect(x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
    }

    function loop(now) {
        const dt = Math.min((now - lastTime) / 1000, 0.033);
        lastTime = now;
        update(dt);
        render();
        if (state === 'playing' || state === 'paused') {
            animationId = requestAnimationFrame(loop);
        }
    }

    // ===== Старт =====
    startBtn.addEventListener('click', startGame);

    window.addEventListener('resize', resize);
    window.addEventListener('orientationchange', () => setTimeout(resize, 200));

    resize();
    render();

    // Пауза при сворачивании
    document.addEventListener('visibilitychange', () => {
        if (document.hidden && state === 'playing') {
            state = 'paused';
            cancelAnimationFrame(animationId);
        } else if (!document.hidden && state === 'paused') {
            state = 'playing';
            lastTime = performance.now();
            animationId = requestAnimationFrame(loop);
        }
    });
})();