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
    const buffsEl = document.getElementById('buffs');
    const pauseBtn = document.getElementById('pause-btn');

    let W = 0, H = 0, DPR = 1;

    // Игровые объекты
    const paddle = { w: 0, h: 0, x: 0, y: 0, targetX: 0, baseW: 0 };
    const balls = []; // теперь массив мячей
    const bricks = [];
    const particles = [];
    const powerups = []; // падающие бонусы

    const BRICK_COLS = 8;
    const BRICK_ROWS = 5;

    // Состояние
    let state = 'idle'; // idle | playing | paused | gameover
    let score = 0;
    let lives = 3;
    let level = 1;
    let lastTime = 0;
    let animationId = null;

    // Активные бонусы (таймеры в секундах)
    const activeBuffs = {
        widen: 0,
        slow: 0,
        doubleScore: 0
    };

    const BRICK_COLORS = ['#ff5252', '#ff9800', '#ffeb3b', '#4caf50', '#4dd0e1'];

    // Типы бонусов
    const POWERUP_TYPES = [
        { type: 'widen',       color: '#4caf50', symbol: '+',  weight: 30 },
        { type: 'life',        color: '#ff5252', symbol: '♥',  weight: 15 },
        { type: 'slow',        color: '#4dd0e1', symbol: 'S',  weight: 25 },
        { type: 'doubleScore', color: '#ffeb3b', symbol: '×2', weight: 20 },
        { type: 'multiBall',   color: '#9c27b0', symbol: 'M',  weight: 10 }
    ];

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

        paddle.baseW = Math.max(70, W * 0.22);
        paddle.w = paddle.baseW;
        paddle.h = 12;
        paddle.y = H - 40 - paddle.h;

        layoutBricks();

        // Пересчёт шариков
        const ballR = Math.max(6, W * 0.014);
        for (const b of balls) b.r = ballR;
    }

    function layoutBricks() {
        if (bricks.length === 0) return;
        const padding = 8;
        const offsetTop = 20;
        const totalPadding = padding * (BRICK_COLS + 1);
        const brickW = (W - totalPadding) / BRICK_COLS;
        const brickH = 22;

        bricks.forEach((b, i) => {
            const row = Math.floor(i / BRICK_COLS);
            const col = i % BRICK_COLS;
            b.w = brickW;
            b.h = brickH;
            b.x = padding + col * (brickW + padding);
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

    function createBall(x, y) {
        const r = Math.max(6, W * 0.014);
        const speed = Math.min(W, H) * 0.7;
        const angle = (-Math.PI / 2) + (Math.random() - 0.5) * 0.6;
        return {
            x, y, r,
            dx: Math.cos(angle) * speed,
            dy: Math.sin(angle) * speed,
            baseSpeed: speed
        };
    }

    function resetBall() {
        balls.length = 0;
        balls.push(createBall(W / 2, paddle.y - 8));
    }

    function startGame() {
        score = 0;
        lives = 3;
        level = 1;
        activeBuffs.widen = 0;
        activeBuffs.slow = 0;
        activeBuffs.doubleScore = 0;
        particles.length = 0;
        powerups.length = 0;
        paddle.w = paddle.baseW;
        updateHUD();
        createBricks();
        paddle.x = (W - paddle.w) / 2;
        paddle.targetX = paddle.x;
        resetBall();
        state = 'playing';
        overlay.classList.add('hidden');
        updateBuffsUI();
        lastTime = performance.now();
        if (animationId) cancelAnimationFrame(animationId);
        animationId = requestAnimationFrame(loop);
    }

    function nextLevel() {
        level++;
        activeBuffs.widen = 0;
        activeBuffs.slow = 0;
        activeBuffs.doubleScore = 0;
        paddle.w = paddle.baseW;
        paddle.x = Math.min(paddle.x, W - paddle.w);
        paddle.targetX = paddle.x;
        powerups.length = 0;
        updateHUD();
        createBricks();
        resetBall();
        updateBuffsUI();
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
            activeBuffs.widen = 0;
            activeBuffs.slow = 0;
            activeBuffs.doubleScore = 0;
            paddle.w = paddle.baseW;
            paddle.x = Math.min(paddle.x, W - paddle.w);
            paddle.targetX = paddle.x;
            resetBall();
            updateBuffsUI();
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

    function updateBuffsUI() {
        if (!buffsEl) return;
        const parts = [];
        if (activeBuffs.widen > 0) parts.push(`+${Math.ceil(activeBuffs.widen)}с`);
        if (activeBuffs.slow > 0) parts.push(`S ${Math.ceil(activeBuffs.slow)}с`);
        if (activeBuffs.doubleScore > 0) parts.push(`×2 ${Math.ceil(activeBuffs.doubleScore)}с`);
        buffsEl.textContent = parts.join('  ');
    }

    // ===== Бонусы =====
    function pickPowerupType() {
        const total = POWERUP_TYPES.reduce((s, p) => s + p.weight, 0);
        let r = Math.random() * total;
        for (const p of POWERUP_TYPES) {
            r -= p.weight;
            if (r <= 0) return p;
        }
        return POWERUP_TYPES[0];
    }

    function maybeSpawnPowerup(x, y) {
        if (Math.random() > 0.15) return; // 15% шанс
        const t = pickPowerupType();
        powerups.push({
            x, y,
            w: 22, h: 22,
            dy: 150, // скорость падения px/сек
            color: t.color,
            symbol: t.symbol,
            type: t.type
        });
    }

    function applyPowerup(p) {
        switch (p.type) {
            case 'widen':
                activeBuffs.widen = 15;
                paddle.w = paddle.baseW * 1.5;
                break;
            case 'life':
                if (lives < 5) {
                    lives++;
                    updateHUD();
                }
                break;
            case 'slow':
                activeBuffs.slow = 10;
                break;
            case 'doubleScore':
                activeBuffs.doubleScore = 15;
                break;
            case 'multiBall': {
                // Добавляем 2 мяча из позиции первого
                const src = balls[0];
                if (src) {
                    for (let i = 0; i < 2; i++) {
                        const b = createBall(src.x, src.y);
                        const angle = (-Math.PI / 2) + (Math.random() - 0.5) * Math.PI;
                        const speed = Math.hypot(src.dx, src.dy);
                        b.dx = Math.cos(angle) * speed;
                        b.dy = Math.sin(angle) * speed;
                        balls.push(b);
                    }
                }
                break;
            }
        }
        updateBuffsUI();
    }

    // ===== Частицы =====
    function spawnParticles(x, y, color, count) {
        for (let i = 0; i < count; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = 60 + Math.random() * 160;
            particles.push({
                x, y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                life: 0.5 + Math.random() * 0.4,
                maxLife: 0.9,
                size: 2 + Math.random() * 3,
                color
            });
        }
    }

    // ===== Относительное управление пальцем =====
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

        const sensitivity = 1.3;
        paddle.targetX += dx * sensitivity;
        paddle.targetX = Math.max(0, Math.min(W - paddle.w, paddle.targetX));
        paddle.x = paddle.targetX;
    });

    const endPointer = () => { lastPointerX = null; };
    canvas.addEventListener('pointerup', endPointer);
    canvas.addEventListener('pointercancel', endPointer);
    canvas.addEventListener('pointerleave', endPointer);

    // Клавиатура
    window.addEventListener('keydown', (e) => {
        keys[e.key] = true;
        if (e.key === ' ') e.preventDefault();
    });
    window.addEventListener('keyup', (e) => keys[e.key] = false);

    // Кнопка паузы
    if (pauseBtn) {
        pauseBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (state === 'playing') {
                state = 'paused';
                pauseBtn.textContent = '▶';
            } else if (state === 'paused') {
                state = 'playing';
                pauseBtn.textContent = '⏸';
                lastTime = performance.now();
            }
        });
    }

    // ===== Физика =====
    function update(dt) {
        if (state !== 'playing') return;

        // Таймеры бонусов
        let buffsChanged = false;
        for (const key of ['widen', 'slow', 'doubleScore']) {
            if (activeBuffs[key] > 0) {
                activeBuffs[key] -= dt;
                if (activeBuffs[key] <= 0) {
                    activeBuffs[key] = 0;
                    if (key === 'widen') {
                        // Возврат ширины с сохранением центра
                        const cx = paddle.x + paddle.w / 2;
                        paddle.w = paddle.baseW;
                        paddle.x = Math.max(0, Math.min(W - paddle.w, cx - paddle.w / 2));
                        paddle.targetX = paddle.x;
                    }
                }
                buffsChanged = true;
            }
        }
        if (buffsChanged) updateBuffsUI();

        // Клавиатура
        const keySpeed = W * 0.9;
        if (keys['ArrowLeft'] || keys['a'] || keys['A']) {
            paddle.targetX -= keySpeed * dt;
        }
        if (keys['ArrowRight'] || keys['d'] || keys['D']) {
            paddle.targetX += keySpeed * dt;
        }
        paddle.targetX = Math.max(0, Math.min(W - paddle.w, paddle.targetX));
        paddle.x = paddle.targetX;

        // Множитель скорости мяча (slow)
        const speedMul = activeBuffs.slow > 0 ? 0.75 : 1.0;

        // Движение каждого мяча
        const steps = 3;
        const subDt = (dt / steps) * speedMul;

        for (let bi = balls.length - 1; bi >= 0; bi--) {
            const ball = balls[bi];
            let removed = false;

            for (let s = 0; s < steps; s++) {
                ball.x += ball.dx * subDt;
                ball.y += ball.dy * subDt;

                // Стены
                if (ball.x - ball.r < 0) { ball.x = ball.r; ball.dx = Math.abs(ball.dx); }
                if (ball.x + ball.r > W) { ball.x = W - ball.r; ball.dx = -Math.abs(ball.dx); }
                if (ball.y - ball.r < 0) { ball.y = ball.r; ball.dy = Math.abs(ball.dy); }

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
                    const mult = activeBuffs.doubleScore > 0 ? 2 : 1;
                    score += 10 * mult;
                    updateHUD();

                    // Частицы + возможно бонус
                    spawnParticles(b.x + b.w / 2, b.y + b.h / 2, b.color, 10);
                    maybeSpawnPowerup(b.x + b.w / 2, b.y + b.h / 2);
                    break;
                }
            }

            // Упал вниз
            if (ball.y - ball.r > H) {
                balls.splice(bi, 1);
                removed = true;
            }
            if (removed) continue;
        }

        // Если все мячи улетели — теряем жизнь
        if (balls.length === 0) {
            loseLife();
            return;
        }

        // Движение бонусов
        for (let i = powerups.length - 1; i >= 0; i--) {
            const p = powerups[i];
            p.y += p.dy * dt;

            // Поймал платформой?
            if (p.y + p.h >= paddle.y &&
                p.y <= paddle.y + paddle.h &&
                p.x + p.w >= paddle.x &&
                p.x <= paddle.x + paddle.w) {
                applyPowerup(p);
                spawnParticles(p.x + p.w / 2, p.y + p.h / 2, p.color, 14);
                powerups.splice(i, 1);
                continue;
            }

            // Улетел вниз
            if (p.y > H) {
                powerups.splice(i, 1);
            }
        }

        // Частицы
        for (let i = particles.length - 1; i >= 0; i--) {
            const pt = particles[i];
            pt.life -= dt;
            if (pt.life <= 0) {
                particles.splice(i, 1);
                continue;
            }
            pt.x += pt.vx * dt;
            pt.y += pt.vy * dt;
            pt.vx *= 0.94;
            pt.vy *= 0.94;
            pt.vy += 120 * dt; // гравитация
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

        // Бонусы
        for (const p of powerups) {
            ctx.fillStyle = p.color;
            ctx.shadowColor = p.color;
            ctx.shadowBlur = 15;
            roundRect(p.x, p.y, p.w, p.h, 6);
            ctx.fill();
            ctx.shadowBlur = 0;

            // Символ
            ctx.fillStyle = '#0a0a1a';
            ctx.font = 'bold 14px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(p.symbol, p.x + p.w / 2, p.y + p.h / 2 + 1);
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

        // Мячи
        ctx.fillStyle = '#fff';
        ctx.shadowColor = '#4dd0e1';
        ctx.shadowBlur = 20;
        for (const ball of balls) {
            ctx.beginPath();
            ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.shadowBlur = 0;

        // Частицы
        for (const p of particles) {
            const alpha = Math.max(0, p.life / p.maxLife);
            ctx.globalAlpha = alpha;
            ctx.fillStyle = p.color;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1;
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

    document.addEventListener('visibilitychange', () => {
        if (document.hidden && state === 'playing') {
            state = 'paused';
            if (pauseBtn) pauseBtn.textContent = '▶';
            cancelAnimationFrame(animationId);
        } else if (!document.hidden && state === 'paused') {
            // Автовозврат только если была не ручная пауза — упрощаем: не трогаем
        }
    });
})();