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

    const paddle = { w: 0, h: 0, x: 0, y: 0, targetX: 0, baseW: 0, hitFlash: 0 };
    const balls = [];
    const bricks = [];
    const particles = [];
    const powerups = [];

    const BRICK_COLS = 8;
    const BRICK_ROWS = 5;

    let state = 'idle';
    let score = 0;
    let lives = 3;
    let level = 1;
    let lastTime = 0;
    let animationId = null;
    let time = 0; // общий таймер для анимаций

    const activeBuffs = { widen: 0, slow: 0, doubleScore: 0 };

    const BRICK_COLORS = ['#ff5252', '#ff9800', '#ffeb3b', '#4caf50', '#4dd0e1'];

    const POWERUP_TYPES = [
        { type: 'widen',       color: '#4caf50', symbol: '+',  weight: 30 },
        { type: 'life',        color: '#ff5252', symbol: '♥',  weight: 15 },
        { type: 'slow',        color: '#4dd0e1', symbol: 'S',  weight: 25 },
        { type: 'doubleScore', color: '#ffeb3b', symbol: '×2', weight: 20 },
        { type: 'multiBall',   color: '#9c27b0', symbol: 'M',  weight: 10 }
    ];

    // ===== Звуки (Web Audio, без файлов) =====
    let audioCtx = null;
    let soundEnabled = true;
    let masterGain = null;

    function initAudio() {
        if (audioCtx) return;
        try {
            const Ctx = window.AudioContext || window.webkitAudioContext;
            audioCtx = new Ctx();
            masterGain = audioCtx.createGain();
            masterGain.gain.value = 0.35;
            masterGain.connect(audioCtx.destination);
        } catch (_) {
            soundEnabled = false;
        }
    }

    // Возобновить контекст (iOS требует жест пользователя)
    function resumeAudio() {
        if (!audioCtx) initAudio();
        if (audioCtx && audioCtx.state === 'suspended') {
            audioCtx.resume().catch(() => {});
        }
    }

    function beep({ freq = 440, duration = 0.08, type = 'square', volume = 1, slideTo = null }) {
        if (!soundEnabled) return;
        if (!audioCtx) initAudio();
        if (!audioCtx) return;
        if (audioCtx.state === 'suspended') return;

        const t0 = audioCtx.currentTime;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();

        osc.type = type;
        osc.frequency.setValueAtTime(freq, t0);
        if (slideTo) {
            osc.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t0 + duration);
        }

        gain.gain.setValueAtTime(0, t0);
        gain.gain.linearRampToValueAtTime(0.6 * volume, t0 + 0.005);
        gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);

        osc.connect(gain);
        gain.connect(masterGain);
        osc.start(t0);
        osc.stop(t0 + duration + 0.02);
    }

    const SFX = {
        paddle:  () => beep({ freq: 300, slideTo: 500, duration: 0.07, type: 'square', volume: 0.8 }),
        brick:   () => beep({ freq: 700, slideTo: 1100, duration: 0.05, type: 'square', volume: 0.7 }),
        brickHard:() => beep({ freq: 400, slideTo: 300, duration: 0.06, type: 'sawtooth', volume: 0.7 }),
        wall:    () => beep({ freq: 500, slideTo: 400, duration: 0.04, type: 'triangle', volume: 0.5 }),
        powerup: () => {
            beep({ freq: 800, slideTo: 1400, duration: 0.12, type: 'square', volume: 0.9 });
            setTimeout(() => beep({ freq: 1200, slideTo: 1800, duration: 0.1, type: 'square', volume: 0.7 }), 70);
        },
        lose:    () => {
            beep({ freq: 300, slideTo: 80, duration: 0.4, type: 'sawtooth', volume: 1 });
        },
        win:     () => {
            [523, 659, 784, 1047].forEach((f, i) => {
                setTimeout(() => beep({ freq: f, duration: 0.12, type: 'square', volume: 0.8 }), i * 90);
            });
        }
    };

    // ===== Управление =====
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
        for (const b of balls) b.r = Math.max(6, W * 0.014);
    }

    function layoutBricks() {
        if (bricks.length === 0) return;
        const padding = 8;
        const offsetTop = 20;
        const totalPadding = padding * (BRICK_COLS + 1);
        const brickW = (W - totalPadding) / BRICK_COLS;
        const brickH = 22;

        bricks.forEach((b) => {
            b.w = brickW;
            b.h = brickH;
            b.x = padding + b.col * (brickW + padding);
            b.y = offsetTop + b.row * (brickH + padding);
        });
    }

    // ===== Рандомная генерация кирпичей =====
    function createBricks() {
        bricks.length = 0;
        const bonusRows = Math.min(level - 1, 3);
        const rows = BRICK_ROWS + bonusRows;
        const padding = 8;
        const totalPadding = padding * (BRICK_COLS + 1);
        const brickW = (W - totalPadding) / BRICK_COLS;
        const brickH = 22;

        // Плотность: на 1 уровне ~70%, дальше чуть плотнее
        const density = Math.min(0.7 + (level - 1) * 0.05, 0.95);
        // Шанс "крепкого" кирпича (2-3 удара) — растёт с уровнем
        const hardChance = Math.min(0.05 + (level - 1) * 0.08, 0.4);

        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < BRICK_COLS; col++) {
                if (Math.random() > density) continue;

                // Симметричный узор: иногда отражаем для красоты
                let hp = 1;
                if (Math.random() < hardChance) {
                    hp = level >= 5 ? 3 : 2;
                }

                // Всегда оставляем минимум 3 кирпича в ряду сверху — иначе неинтересно
                bricks.push({
                    col, row,
                    x: padding + col * (brickW + padding),
                    y: 20 + row * (brickH + padding),
                    w: brickW,
                    h: brickH,
                    alive: true,
                    hp,
                    maxHp: hp,
                    color: BRICK_COLORS[row % BRICK_COLORS.length],
                    // Анимация появления
                    spawnAnim: 0,
                    spawnDelay: row * 0.05 + col * 0.015
                });
            }
        }

        // Гарантируем хотя бы 8 кирпичей — иначе уровень слишком пустой
        if (bricks.length < 8) {
            for (let row = 0; row < 3 && bricks.length < 8; row++) {
                for (let col = 0; col < BRICK_COLS && bricks.length < 8; col++) {
                    if (bricks.some(b => b.row === row && b.col === col)) continue;
                    bricks.push({
                        col, row,
                        x: padding + col * (brickW + padding),
                        y: 20 + row * (brickH + padding),
                        w: brickW,
                        h: brickH,
                        alive: true,
                        hp: 1,
                        maxHp: 1,
                        color: BRICK_COLORS[row % BRICK_COLORS.length],
                        spawnAnim: 0,
                        spawnDelay: 0
                    });
                }
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
            trail: []
        };
    }

    function resetBall() {
        balls.length = 0;
        balls.push(createBall(W / 2, paddle.y - 8));
    }

    function startGame() {
        resumeAudio();
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
        SFX.win();
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
        SFX.lose();
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
        if (Math.random() > 0.15) return;
        const t = pickPowerupType();
        powerups.push({
            x: x - 11, y: y - 11,
            w: 22, h: 22,
            dy: 150,
            color: t.color,
            symbol: t.symbol,
            type: t.type,
            wobble: Math.random() * Math.PI * 2
        });
    }

    function applyPowerup(p) {
        SFX.powerup();
        switch (p.type) {
            case 'widen':
                activeBuffs.widen = 15;
                paddle.w = paddle.baseW * 1.5;
                break;
            case 'life':
                if (lives < 5) { lives++; updateHUD(); }
                break;
            case 'slow':
                activeBuffs.slow = 10;
                break;
            case 'doubleScore':
                activeBuffs.doubleScore = 15;
                break;
            case 'multiBall': {
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
            const speed = 60 + Math.random() * 180;
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

    // ===== Управление пальцем =====
    canvas.addEventListener('pointerdown', (e) => {
        resumeAudio();
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

    window.addEventListener('keydown', (e) => {
        keys[e.key] = true;
        if (e.key === ' ') e.preventDefault();
    });
    window.addEventListener('keyup', (e) => keys[e.key] = false);

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
        time += dt;
        if (state !== 'playing') return;

        // Таймеры бонусов
        let buffsChanged = false;
        for (const key of ['widen', 'slow', 'doubleScore']) {
            if (activeBuffs[key] > 0) {
                activeBuffs[key] -= dt;
                if (activeBuffs[key] <= 0) {
                    activeBuffs[key] = 0;
                    if (key === 'widen') {
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
        if (keys['ArrowLeft'] || keys['a'] || keys['A']) paddle.targetX -= keySpeed * dt;
        if (keys['ArrowRight'] || keys['d'] || keys['D']) paddle.targetX += keySpeed * dt;
        paddle.targetX = Math.max(0, Math.min(W - paddle.w, paddle.targetX));
        paddle.x = paddle.targetX;

        // Анимация появления кирпичей
        for (const b of bricks) {
            if (b.spawnAnim < 1) {
                b.spawnDelay -= dt;
                if (b.spawnDelay <= 0) {
                    b.spawnAnim = Math.min(1, b.spawnAnim + dt * 4);
                }
            }
        }

        // Вспышка платформы затухает
        if (paddle.hitFlash > 0) paddle.hitFlash = Math.max(0, paddle.hitFlash - dt * 4);

        const speedMul = activeBuffs.slow > 0 ? 0.75 : 1.0;
        const steps = 3;
        const subDt = (dt / steps) * speedMul;

        for (let bi = balls.length - 1; bi >= 0; bi--) {
            const ball = balls[bi];

            // Шлейф
            ball.trail.push({ x: ball.x, y: ball.y, life: 0.25 });
            if (ball.trail.length > 12) ball.trail.shift();
            for (let i = ball.trail.length - 1; i >= 0; i--) {
                ball.trail[i].life -= dt;
                if (ball.trail[i].life <= 0) ball.trail.splice(i, 1);
            }

            for (let s = 0; s < steps; s++) {
                ball.x += ball.dx * subDt;
                ball.y += ball.dy * subDt;

                // Стены
                if (ball.x - ball.r < 0) {
                    ball.x = ball.r;
                    ball.dx = Math.abs(ball.dx);
                    SFX.wall();
                }
                if (ball.x + ball.r > W) {
                    ball.x = W - ball.r;
                    ball.dx = -Math.abs(ball.dx);
                    SFX.wall();
                }
                if (ball.y - ball.r < 0) {
                    ball.y = ball.r;
                    ball.dy = Math.abs(ball.dy);
                    SFX.wall();
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
                    paddle.hitFlash = 1;
                    SFX.paddle();
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

                    b.hp--;
                    if (b.hp <= 0) {
                        b.alive = false;
                        const mult = activeBuffs.doubleScore > 0 ? 2 : 1;
                        // За "крепкий" кирпич — больше очков
                        score += 10 * mult * b.maxHp;
                        updateHUD();
                        spawnParticles(b.x + b.w / 2, b.y + b.h / 2, b.color, 10 + b.maxHp * 3);
                        maybeSpawnPowerup(b.x + b.w / 2, b.y + b.h / 2);
                        SFX.brick();
                    } else {
                        // Кирпич треснул, но жив
                        spawnParticles(ball.x, ball.y, b.color, 4);
                        SFX.brickHard();
                    }
                    break;
                }
            }

            if (ball.y - ball.r > H) {
                balls.splice(bi, 1);
            }
        }

        if (balls.length === 0) {
            loseLife();
            return;
        }

        // Бонусы
        for (let i = powerups.length - 1; i >= 0; i--) {
            const p = powerups[i];
            p.y += p.dy * dt;
            p.wobble += dt * 6;

            if (p.y + p.h >= paddle.y &&
                p.y <= paddle.y + paddle.h &&
                p.x + p.w >= paddle.x &&
                p.x <= paddle.x + paddle.w) {
                applyPowerup(p);
                spawnParticles(p.x + p.w / 2, p.y + p.h / 2, p.color, 14);
                powerups.splice(i, 1);
                continue;
            }
            if (p.y > H) powerups.splice(i, 1);
        }

        // Частицы
        for (let i = particles.length - 1; i >= 0; i--) {
            const pt = particles[i];
            pt.life -= dt;
            if (pt.life <= 0) { particles.splice(i, 1); continue; }
            pt.x += pt.vx * dt;
            pt.y += pt.vy * dt;
            pt.vx *= 0.94;
            pt.vy *= 0.94;
            pt.vy += 120 * dt;
        }

        // Победа
        if (bricks.every(b => !b.alive)) {
            nextLevel();
        }
    }

    // ===== Отрисовка =====
    function drawBackground() {
        // Градиентный фон
        const g = ctx.createRadialGradient(W / 2, H * 0.3, 50, W / 2, H * 0.3, Math.max(W, H) * 0.8);
        g.addColorStop(0, '#141433');
        g.addColorStop(1, '#0a0a1a');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);

        // Медленно плывущая сетка
        ctx.strokeStyle = 'rgba(77, 208, 225, 0.06)';
        ctx.lineWidth = 1;
        const grid = 40;
        const ox = (time * 15) % grid;
        const oy = (time * 10) % grid;
        for (let x = -ox; x < W; x += grid) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, H);
            ctx.stroke();
        }
        for (let y = -oy; y < H; y += grid) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(W, y);
            ctx.stroke();
        }

        // Верхняя подсветка "опасной зоны" (где мяч отскакивает от потолка)
        const topGlow = ctx.createLinearGradient(0, 0, 0, 40);
        topGlow.addColorStop(0, 'rgba(77, 208, 225, 0.15)');
        topGlow.addColorStop(1, 'rgba(77, 208, 225, 0)');
        ctx.fillStyle = topGlow;
        ctx.fillRect(0, 0, W, 40);
    }

    function drawBrick(b) {
        const t = b.spawnAnim;
        if (t <= 0) return;
        const scale = 0.4 + 0.6 * easeOutBack(t);
        const alpha = t;

        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(b.x + b.w / 2, b.y + b.h / 2);
        ctx.scale(scale, scale);
        ctx.translate(-b.w / 2, -b.h / 2);

        // Тень/свечение
        ctx.shadowColor = b.color;
        ctx.shadowBlur = 12;

        // Градиент
        const g = ctx.createLinearGradient(0, 0, 0, b.h);
        g.addColorStop(0, lighten(b.color, 0.25));
        g.addColorStop(1, b.color);
        ctx.fillStyle = g;

        roundRect(0, 0, b.w, b.h, 4);
        ctx.fill();
        ctx.shadowBlur = 0;

        // Внутренняя светлая полоска сверху
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        roundRect(2, 2, b.w - 4, 3, 2);
        ctx.fill();

        // Если крепкий — рисуем трещинки по количеству оставшихся hp
        if (b.maxHp > 1) {
            ctx.strokeStyle = 'rgba(0,0,0,0.4)';
            ctx.lineWidth = 1.5;
            const dmg = b.maxHp - b.hp;
            for (let i = 0; i < dmg; i++) {
                ctx.beginPath();
                const cx = b.w * (0.25 + i * 0.25);
                ctx.moveTo(cx, b.h * 0.2);
                ctx.lineTo(cx + 4, b.h * 0.5);
                ctx.lineTo(cx - 2, b.h * 0.8);
                ctx.stroke();
            }
            // Метка с числом оставшихся ударов
            ctx.fillStyle = 'rgba(255,255,255,0.85)';
            ctx.font = 'bold 10px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(b.hp, b.w / 2, b.h / 2 + 1);
        }

        ctx.restore();
    }

    function drawBall(ball) {
        // Шлейф
        for (let i = 0; i < ball.trail.length; i++) {
            const t = ball.trail[i];
            const a = (t.life / 0.25) * 0.4 * (i / ball.trail.length);
            ctx.globalAlpha = a;
            ctx.fillStyle = '#4dd0e1';
            ctx.beginPath();
            ctx.arc(t.x, t.y, ball.r * (0.4 + 0.6 * i / ball.trail.length), 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1;

        // Свечение
        const g = ctx.createRadialGradient(ball.x, ball.y, 0, ball.x, ball.y, ball.r * 3);
        g.addColorStop(0, 'rgba(255, 255, 255, 1)');
        g.addColorStop(0.4, 'rgba(77, 208, 225, 0.8)');
        g.addColorStop(1, 'rgba(77, 208, 225, 0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(ball.x, ball.y, ball.r * 3, 0, Math.PI * 2);
        ctx.fill();

        // Ядро
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
        ctx.fill();
    }

    function drawPaddle() {
        const flash = paddle.hitFlash;
        const g = ctx.createLinearGradient(paddle.x, 0, paddle.x + paddle.w, 0);
        g.addColorStop(0, '#4dd0e1');
        g.addColorStop(1, '#9c27b0');

        ctx.shadowColor = flash > 0 ? '#ffffff' : '#4dd0e1';
        ctx.shadowBlur = 15 + flash * 25;
        ctx.fillStyle = g;
        roundRect(paddle.x, paddle.y, paddle.w, paddle.h, paddle.h / 2);
        ctx.fill();
        ctx.shadowBlur = 0;

        // Блик
        ctx.fillStyle = 'rgba(255,255,255,' + (0.3 + flash * 0.5) + ')';
        roundRect(paddle.x + 4, paddle.y + 2, paddle.w - 8, 3, 2);
        ctx.fill();
    }

    function drawPowerup(p) {
        const wobble = Math.sin(p.wobble) * 0.15;
        ctx.save();
        ctx.translate(p.x + p.w / 2, p.y + p.h / 2);
        ctx.rotate(wobble);

        ctx.shadowColor = p.color;
        ctx.shadowBlur = 18;
        ctx.fillStyle = p.color;
        roundRect(-p.w / 2, -p.h / 2, p.w, p.h, 6);
        ctx.fill();
        ctx.shadowBlur = 0;

        // Обводка
        ctx.strokeStyle = 'rgba(255,255,255,0.6)';
        ctx.lineWidth = 1.5;
        roundRect(-p.w / 2 + 1, -p.h / 2 + 1, p.w - 2, p.h - 2, 5);
        ctx.stroke();

        ctx.fillStyle = '#0a0a1a';
        ctx.font = 'bold 14px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(p.symbol, 0, 1);

        ctx.restore();
    }

    function render() {
        drawBackground();

        // Кирпичи
        for (const b of bricks) {
            if (!b.alive) continue;
            drawBrick(b);
        }

        // Бонусы
        for (const p of powerups) drawPowerup(p);

        // Платформа
        drawPaddle();

        // Мячи
        for (const ball of balls) drawBall(ball);

        // Частицы
        for (const p of particles) {
            const alpha = Math.max(0, p.life / p.maxLife);
            ctx.globalAlpha = alpha;
            ctx.fillStyle = p.color;
            ctx.shadowColor = p.color;
            ctx.shadowBlur = 8;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1;
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

    function easeOutBack(t) {
        const c1 = 1.70158;
        const c3 = c1 + 1;
        return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
    }

    function lighten(hex, amount) {
        const c = hex.replace('#', '');
        const r = parseInt(c.substring(0, 2), 16);
        const g = parseInt(c.substring(2, 4), 16);
        const b = parseInt(c.substring(4, 6), 16);
        const lr = Math.round(r + (255 - r) * amount);
        const lg = Math.round(g + (255 - g) * amount);
        const lb = Math.round(b + (255 - b) * amount);
        return `rgb(${lr},${lg},${lb})`;
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
        }
    });
})();