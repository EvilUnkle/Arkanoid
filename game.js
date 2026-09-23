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
    const soundBtn = document.getElementById('sound-btn');

    let W = 0, H = 0, DPR = 1;

    const paddle = {
        w: 0, h: 0, x: 0, y: 0, targetX: 0, baseW: 0, hitFlash: 0,
        curvature: 0, targetCurvature: 0
    };
    const balls = [];
    const bricks = [];
    const particles = [];
    const powerups = [];
    const bullets = [];   // вражеские снаряды

    const BRICK_COLS = 8;
    const BRICK_ROWS = 5;

    let state = 'idle';
    let score = 0;
    let lives = 3;
    let level = 1;
    let lastTime = 0;
    let animationId = null;
    let time = 0;

    let totalBricksThisLevel = 0;
    let aliveBricksCount = 0;

    const activeBuffs = { widen: 0, slow: 0, doubleScore: 0, shield: 0 };

    const BRICK_COLORS = ['#ff5252', '#ff9800', '#ffeb3b', '#4caf50', '#4dd0e1'];

    const POWERUP_TYPES = [
        { type: 'widen',       color: '#4caf50', symbol: '+',  weight: 25 },
        { type: 'life',        color: '#ff5252', symbol: '♥',  weight: 12 },
        { type: 'slow',        color: '#4dd0e1', symbol: 'S',  weight: 20 },
        { type: 'doubleScore', color: '#ffeb3b', symbol: '×2', weight: 18 },
        { type: 'multiBall',   color: '#9c27b0', symbol: 'M',  weight: 10 },
        { type: 'shield',      color: '#29b6f6', symbol: '⚡', weight: 15 }
    ];

    // ===== Звуки =====
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
        } catch (_) { soundEnabled = false; }
    }

    function resumeAudio() {
        if (!audioCtx) initAudio();
        if (audioCtx && audioCtx.state === 'suspended') {
            audioCtx.resume().catch(() => {});
        }
    }

    function beep({ freq = 440, duration = 0.08, type = 'square', volume = 1, slideTo = null }) {
        if (!soundEnabled) return;
        if (!audioCtx) initAudio();
        if (!audioCtx || audioCtx.state === 'suspended') return;

        const t0 = audioCtx.currentTime;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, t0);
        if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t0 + duration);
        gain.gain.setValueAtTime(0, t0);
        gain.gain.linearRampToValueAtTime(0.6 * volume, t0 + 0.005);
        gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
        osc.connect(gain);
        gain.connect(masterGain);
        osc.start(t0);
        osc.stop(t0 + duration + 0.02);
    }

    const SFX = {
        paddle:   () => beep({ freq: 300, slideTo: 500, duration: 0.07, type: 'square', volume: 0.8 }),
        brick:    () => beep({ freq: 700, slideTo: 1100, duration: 0.05, type: 'square', volume: 0.7 }),
        brickHard:() => beep({ freq: 400, slideTo: 300, duration: 0.06, type: 'sawtooth', volume: 0.7 }),
        wall:     () => beep({ freq: 500, slideTo: 400, duration: 0.04, type: 'triangle', volume: 0.5 }),
        powerup:  () => {
            beep({ freq: 800, slideTo: 1400, duration: 0.12, type: 'square', volume: 0.9 });
            setTimeout(() => beep({ freq: 1200, slideTo: 1800, duration: 0.1, type: 'square', volume: 0.7 }), 70);
        },
        lose:     () => beep({ freq: 300, slideTo: 80, duration: 0.4, type: 'sawtooth', volume: 1 }),
        win:      () => {
            [523, 659, 784, 1047].forEach((f, i) => {
                setTimeout(() => beep({ freq: f, duration: 0.12, type: 'square', volume: 0.8 }), i * 90);
            });
        },
        bend:     () => beep({ freq: 220, slideTo: 440, duration: 0.15, type: 'sine', volume: 0.5 }),
        shoot:    () => beep({ freq: 200, slideTo: 100, duration: 0.1, type: 'sawtooth', volume: 0.5 }),
        hitShield:() => beep({ freq: 900, slideTo: 1600, duration: 0.08, type: 'sine', volume: 0.7 }),
        enemyBreak:() => {
            beep({ freq: 500, slideTo: 200, duration: 0.15, type: 'sawtooth', volume: 0.8 });
            setTimeout(() => beep({ freq: 300, slideTo: 100, duration: 0.1, type: 'square', volume: 0.5 }), 40);
        }
    };

    let lastBendSoundTime = 0;

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

    function createBricks() {
        bricks.length = 0;
        bullets.length = 0;

        const bonusRows = Math.min(level - 1, 3);
        const rows = BRICK_ROWS + bonusRows;
        const padding = 8;
        const totalPadding = padding * (BRICK_COLS + 1);
        const brickW = (W - totalPadding) / BRICK_COLS;
        const brickH = 22;

        const density = Math.min(0.7 + (level - 1) * 0.05, 0.95);
        const hardChance = Math.min(0.05 + (level - 1) * 0.08, 0.4);
        // Шанс врага — с уровня 2, ~7%
        const enemyChance = level >= 2 ? Math.min(0.06 + (level - 2) * 0.02, 0.18) : 0;

        // Враги не могут быть в самом нижнем ряду (иначе сразу стреляют)
        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < BRICK_COLS; col++) {
                if (Math.random() > density) continue;

                // Враг только в верхних рядах (не последний и не предпоследний)
                const canBeEnemy = row < rows - 2;

                if (canBeEnemy && Math.random() < enemyChance) {
                    bricks.push({
                        col, row,
                        x: padding + col * (brickW + padding),
                        y: 20 + row * (brickH + padding),
                        w: brickW,
                        h: brickH,
                        alive: true,
                        hp: 1, maxHp: 1,
                        color: '#ff1744',
                        isEnemy: true,
                        fireCooldown: 2 + Math.random() * 3,   // первый выстрел через 2-5 сек
                        fireInterval: 3 + Math.random() * 2,    // дальше каждые 3-5 сек
                        pulse: Math.random() * Math.PI * 2,
                        spawnAnim: 0,
                        spawnDelay: row * 0.05 + col * 0.015
                    });
                    continue;
                }

                let hp = 1;
                if (Math.random() < hardChance) hp = level >= 5 ? 3 : 2;

                bricks.push({
                    col, row,
                    x: padding + col * (brickW + padding),
                    y: 20 + row * (brickH + padding),
                    w: brickW,
                    h: brickH,
                    alive: true,
                    hp, maxHp: hp,
                    color: BRICK_COLORS[row % BRICK_COLORS.length],
                    isEnemy: false,
                    spawnAnim: 0,
                    spawnDelay: row * 0.05 + col * 0.015
                });
            }
        }

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
                        hp: 1, maxHp: 1,
                        color: BRICK_COLORS[row % BRICK_COLORS.length],
                        isEnemy: false,
                        spawnAnim: 0,
                        spawnDelay: 0
                    });
                }
            }
        }

        totalBricksThisLevel = bricks.length;
        aliveBricksCount = bricks.length;
        paddle.curvature = 0;
        paddle.targetCurvature = 0;
    }

    // Проверка: есть ли между врагом и платформой свободный путь вниз
    function hasClearPathToBottom(brick) {
        // Ищем любой живой кирпич в той же колонке ниже этого
        for (const other of bricks) {
            if (!other.alive) continue;
            if (other.col === brick.col && other.row > brick.row) return false;
        }
        return true;
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
        activeBuffs.shield = 0;
        particles.length = 0;
        powerups.length = 0;
        bullets.length = 0;
        paddle.w = paddle.baseW;
        paddle.curvature = 0;
        paddle.targetCurvature = 0;
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
        activeBuffs.shield = 0;
        paddle.w = paddle.baseW;
        paddle.x = Math.min(paddle.x, W - paddle.w);
        paddle.targetX = paddle.x;
        powerups.length = 0;
        bullets.length = 0;
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
            activeBuffs.shield = 0;
            paddle.w = paddle.baseW;
            paddle.x = Math.min(paddle.x, W - paddle.w);
            paddle.targetX = paddle.x;
            bullets.length = 0;
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
        if (activeBuffs.shield > 0) parts.push(`⚡ ${Math.ceil(activeBuffs.shield)}с`);
        if (paddle.curvature > 0.05) parts.push(`⌒ ${Math.round(paddle.curvature * 100)}%`);
        buffsEl.textContent = parts.join('  ');
    }

    function computeTargetCurvature() {
        if (totalBricksThisLevel === 0) return 0;
        const damage = 1 - aliveBricksCount / totalBricksThisLevel;
        const t = Math.max(0, Math.min(1, damage / 0.7));
        return t;
    }

    function paddleArc() {
        const k = paddle.curvature;
        const baseY = paddle.y + paddle.h / 2;
        const arcHeight = k * paddle.w * 0.5;
        const cx = paddle.x + paddle.w / 2;
        const halfW = paddle.w / 2;
        return {
            heightAt(worldX) {
                if (halfW <= 0) return 0;
                const t = (worldX - cx) / halfW;
                return arcHeight * (1 - t * t);
            },
            slopeAt(worldX) {
                if (halfW <= 0) return 0;
                const t = (worldX - cx) / halfW;
                return arcHeight * 2 * t / halfW;
            },
            baseY
        };
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

    function maybeSpawnPowerup(x, y, forced = false) {
        if (!forced && Math.random() > 0.15) return;
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
            case 'shield':
                activeBuffs.shield = 8;
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

    // ===== Управление =====
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

    if (soundBtn) {
        soundBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            soundEnabled = !soundEnabled;
            soundBtn.textContent = soundEnabled ? '🔊' : '🔇';
            if (soundEnabled) { resumeAudio(); SFX.paddle(); }
        });
    }

    // ===== Обновление =====
    function update(dt) {
        time += dt;
        if (state !== 'playing') return;

        // Таймеры бонусов
        let buffsChanged = false;
        for (const key of ['widen', 'slow', 'doubleScore', 'shield']) {
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

        const keySpeed = W * 0.9;
        if (keys['ArrowLeft'] || keys['a'] || keys['A']) paddle.targetX -= keySpeed * dt;
        if (keys['ArrowRight'] || keys['d'] || keys['D']) paddle.targetX += keySpeed * dt;
        paddle.targetX = Math.max(0, Math.min(W - paddle.w, paddle.targetX));
        paddle.x = paddle.targetX;

        // Кривизна
        paddle.targetCurvature = computeTargetCurvature();
        const bendSpeed = 1.2;
        const prevCurv = paddle.curvature;
        if (paddle.curvature < paddle.targetCurvature) {
            paddle.curvature = Math.min(paddle.targetCurvature, paddle.curvature + dt * bendSpeed);
        } else if (paddle.curvature > paddle.targetCurvature) {
            paddle.curvature = Math.max(paddle.targetCurvature, paddle.curvature - dt * bendSpeed);
        }

        if (Math.abs(paddle.curvature - prevCurv) > 0.005 && time - lastBendSoundTime > 1.5) {
            SFX.bend();
            lastBendSoundTime = time;
        }

        if (buffsChanged || paddle.curvature > 0.05) updateBuffsUI();

        // Анимация появления кирпичей
        for (const b of bricks) {
            if (b.spawnAnim < 1) {
                b.spawnDelay -= dt;
                if (b.spawnDelay <= 0) b.spawnAnim = Math.min(1, b.spawnAnim + dt * 4);
            }
        }

        if (paddle.hitFlash > 0) paddle.hitFlash = Math.max(0, paddle.hitFlash - dt * 4);

        // ===== Враги стреляют =====
        for (const b of bricks) {
            if (!b.alive || !b.isEnemy || b.spawnAnim < 1) continue;
            b.pulse += dt * 4;

            if (!hasClearPathToBottom(b)) continue;

            b.fireCooldown -= dt;
            if (b.fireCooldown <= 0) {
                b.fireCooldown = b.fireInterval;
                // Снаряд летит из центра кирпича
                bullets.push({
                    x: b.x + b.w / 2,
                    y: b.y + b.h,
                    vy: H * 0.55,       // скорость вниз
                    vx: 0,
                    r: 5,
                    life: 4,
                    wobble: Math.random() * Math.PI * 2
                });
                SFX.shoot();
            }
        }

        // ===== Движение снарядов =====
        for (let i = bullets.length - 1; i >= 0; i--) {
            const bl = bullets[i];
            bl.y += bl.vy * dt;
            bl.x += bl.vx * dt;
            bl.life -= dt;
            bl.wobble += dt * 8;

            if (bl.life <= 0 || bl.y > H + 20) {
                bullets.splice(i, 1);
                continue;
            }

            // Проверяем попадание в платформу (с учётом щита)
            const shieldActive = activeBuffs.shield > 0;
            const shieldRadius = 26;

            // Попадание в щит
            if (shieldActive) {
                const cx = paddle.x + paddle.w / 2;
                const cy = paddle.y + paddle.h / 2 - 6;
                const dist = Math.hypot(bl.x - cx, bl.y - cy);
                if (dist < paddle.w / 2 + shieldRadius) {
                    // Погашен щитом
                    spawnParticles(bl.x, bl.y, '#29b6f6', 12);
                    SFX.hitShield();
                    bullets.splice(i, 1);
                    continue;
                }
            }

            // Попадание в платформу
            if (bl.x + bl.r >= paddle.x &&
                bl.x - bl.r <= paddle.x + paddle.w &&
                bl.y + bl.r >= paddle.y &&
                bl.y - bl.r <= paddle.y + paddle.h) {
                bullets.splice(i, 1);
                spawnParticles(bl.x, bl.y, '#ff1744', 14);
                loseLife();
                return;
            }
        }

        // ===== Движение мячей =====
        const speedMul = activeBuffs.slow > 0 ? 0.75 : 1.0;
        const steps = 3;
        const subDt = (dt / steps) * speedMul;

        const arc = paddleArc();

        for (let bi = balls.length - 1; bi >= 0; bi--) {
            const ball = balls[bi];

            ball.trail.push({ x: ball.x, y: ball.y, life: 0.25 });
            if (ball.trail.length > 12) ball.trail.shift();
            for (let i = ball.trail.length - 1; i >= 0; i--) {
                ball.trail[i].life -= dt;
                if (ball.trail[i].life <= 0) ball.trail.splice(i, 1);
            }

            for (let s = 0; s < steps; s++) {
                ball.x += ball.dx * subDt;
                ball.y += ball.dy * subDt;

                if (ball.x - ball.r < 0) { ball.x = ball.r; ball.dx = Math.abs(ball.dx); SFX.wall(); }
                if (ball.x + ball.r > W) { ball.x = W - ball.r; ball.dx = -Math.abs(ball.dx); SFX.wall(); }
                if (ball.y - ball.r < 0) { ball.y = ball.r; ball.dy = Math.abs(ball.dy); SFX.wall(); }

                // Платформа
                if (ball.dy > 0 &&
                    ball.x + ball.r >= paddle.x &&
                    ball.x - ball.r <= paddle.x + paddle.w) {

                    const arcTop = arc.baseY - arc.heightAt(ball.x);
                    const paddleBottom = paddle.y + paddle.h;

                    if (ball.y + ball.r >= arcTop &&
                        ball.y - ball.r <= paddleBottom) {

                        ball.y = arcTop - ball.r;
                        const slope = arc.slopeAt(ball.x);
                        const nLen = Math.hypot(-slope, 1);
                        const nx = -slope / nLen;
                        const ny = 1 / nLen;

                        const dot = ball.dx * nx + ball.dy * ny;
                        ball.dx = ball.dx - 2 * dot * nx;
                        ball.dy = ball.dy - 2 * dot * ny;

                        const hitPos = (ball.x - (paddle.x + paddle.w / 2)) / (paddle.w / 2);
                        const extraAngle = hitPos * 0.25;
                        const cos = Math.cos(extraAngle);
                        const sin = Math.sin(extraAngle);
                        const ndx = ball.dx * cos - ball.dy * sin;
                        const ndy = ball.dx * sin + ball.dy * cos;
                        ball.dx = ndx;
                        ball.dy = ndy;

                        const speed = Math.hypot(ball.dx, ball.dy) * 1.02;
                        const ang = Math.atan2(ball.dy, ball.dx);
                        ball.dx = Math.cos(ang) * speed;
                        ball.dy = Math.sin(ang) * speed;

                        if (ball.dy > 0) ball.dy = -ball.dy;

                        paddle.hitFlash = 1;
                        SFX.paddle();
                    }
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

                    if (b.isEnemy) {
                        // Враг разбивается с одного удара
                        b.alive = false;
                        aliveBricksCount--;
                        const mult = activeBuffs.doubleScore > 0 ? 2 : 1;
                        score += 50 * mult;
                        updateHUD();
                        spawnParticles(b.x + b.w / 2, b.y + b.h / 2, '#ff1744', 20);
                        spawnParticles(b.x + b.w / 2, b.y + b.h / 2, '#ffeb3b', 10);
                        // Враг всегда роняет бонус
                        maybeSpawnPowerup(b.x + b.w / 2, b.y + b.h / 2, true);
                        SFX.enemyBreak();
                    } else {
                        b.hp--;
                        if (b.hp <= 0) {
                            b.alive = false;
                            aliveBricksCount--;
                            const mult = activeBuffs.doubleScore > 0 ? 2 : 1;
                            score += 10 * mult * b.maxHp;
                            updateHUD();
                            spawnParticles(b.x + b.w / 2, b.y + b.h / 2, b.color, 10 + b.maxHp * 3);
                            maybeSpawnPowerup(b.x + b.w / 2, b.y + b.h / 2);
                            SFX.brick();
                        } else {
                            spawnParticles(ball.x, ball.y, b.color, 4);
                            SFX.brickHard();
                        }
                    }
                    break;
                }
            }

            if (ball.y - ball.r > H) balls.splice(bi, 1);
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

        if (aliveBricksCount <= 0) {
            nextLevel();
        }
    }

    // ===== Отрисовка =====
    function drawBackground() {
        const g = ctx.createRadialGradient(W / 2, H * 0.3, 50, W / 2, H * 0.3, Math.max(W, H) * 0.8);
        g.addColorStop(0, '#141433');
        g.addColorStop(1, '#0a0a1a');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);

        ctx.strokeStyle = 'rgba(77, 208, 225, 0.06)';
        ctx.lineWidth = 1;
        const grid = 40;
        const ox = (time * 15) % grid;
        const oy = (time * 10) % grid;
        for (let x = -ox; x < W; x += grid) {
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
        }
        for (let y = -oy; y < H; y += grid) {
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
        }

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

        // Враг — рисуем особо
        if (b.isEnemy) {
            const pulse = 0.5 + 0.5 * Math.sin(b.pulse);
            const ready = hasClearPathToBottom(b) && b.spawnAnim >= 1;

            ctx.shadowColor = ready ? '#ff1744' : '#880e4f';
            ctx.shadowBlur = 12 + pulse * 12;
            const g = ctx.createLinearGradient(0, 0, 0, b.h);
            g.addColorStop(0, '#ff5252');
            g.addColorStop(1, '#880e4f');
            ctx.fillStyle = g;
            roundRect(0, 0, b.w, b.h, 4);
            ctx.fill();
            ctx.shadowBlur = 0;

            // Значок "глаз" или прицел
            ctx.strokeStyle = ready ? '#fff' : 'rgba(255,255,255,0.4)';
            ctx.lineWidth = 1.8;
            ctx.beginPath();
            ctx.arc(b.w / 2, b.h / 2, 5, 0, Math.PI * 2);
            ctx.stroke();
            ctx.fillStyle = ready ? '#fff' : 'rgba(255,255,255,0.4)';
            ctx.beginPath();
            ctx.arc(b.w / 2, b.h / 2, 2.5, 0, Math.PI * 2);
            ctx.fill();

            // Пульсирующее кольцо
            if (ready) {
                ctx.strokeStyle = `rgba(255, 23, 68, ${0.3 + pulse * 0.4})`;
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.arc(b.w / 2, b.h / 2, 5 + pulse * 4, 0, Math.PI * 2);
                ctx.stroke();
            }

            // Индикатор перезарядки — тонкая полоска снизу
            if (ready) {
                const total = b.fireInterval;
                const left = Math.max(0, b.fireCooldown);
                const ratio = 1 - left / total;
                ctx.fillStyle = 'rgba(255,255,255,0.6)';
                ctx.fillRect(2, b.h - 3, (b.w - 4) * ratio, 2);
            }
        } else {
            // Обычный кирпич (старая логика)
            ctx.shadowColor = b.color;
            ctx.shadowBlur = 12;
            const g = ctx.createLinearGradient(0, 0, 0, b.h);
            g.addColorStop(0, lighten(b.color, 0.25));
            g.addColorStop(1, b.color);
            ctx.fillStyle = g;
            roundRect(0, 0, b.w, b.h, 4);
            ctx.fill();
            ctx.shadowBlur = 0;

            ctx.fillStyle = 'rgba(255,255,255,0.25)';
            roundRect(2, 2, b.w - 4, 3, 2);
            ctx.fill();

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
                ctx.fillStyle = 'rgba(255,255,255,0.85)';
                ctx.font = 'bold 10px sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(b.hp, b.w / 2, b.h / 2 + 1);
            }
        }

        ctx.restore();
    }

    function drawBall(ball) {
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

        const g = ctx.createRadialGradient(ball.x, ball.y, 0, ball.x, ball.y, ball.r * 3);
        g.addColorStop(0, 'rgba(255, 255, 255, 1)');
        g.addColorStop(0.4, 'rgba(77, 208, 225, 0.8)');
        g.addColorStop(1, 'rgba(77, 208, 225, 0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(ball.x, ball.y, ball.r * 3, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
        ctx.fill();
    }

    function drawPaddle() {
        const flash = paddle.hitFlash;
        const k = paddle.curvature;

        ctx.shadowColor = flash > 0 ? '#ffffff' : '#4dd0e1';
        ctx.shadowBlur = 15 + flash * 25;

        if (k < 0.02) {
            const g = ctx.createLinearGradient(paddle.x, 0, paddle.x + paddle.w, 0);
            g.addColorStop(0, '#4dd0e1');
            g.addColorStop(1, '#9c27b0');
            ctx.fillStyle = g;
            roundRect(paddle.x, paddle.y, paddle.w, paddle.h, paddle.h / 2);
            ctx.fill();
            ctx.shadowBlur = 0;

            ctx.fillStyle = 'rgba(255,255,255,' + (0.3 + flash * 0.5) + ')';
            roundRect(paddle.x + 4, paddle.y + 2, paddle.w - 8, 3, 2);
            ctx.fill();
        } else {
            const arc = paddleArc();
            const baseY = paddle.y + paddle.h;
            const thickness = paddle.h;
            const N = 24;
            const pts = [];
            const cx = paddle.x + paddle.w / 2;
            const halfW = paddle.w / 2;

            for (let i = 0; i <= N; i++) {
                const x = paddle.x + (paddle.w * i / N);
                const t = (x - cx) / halfW;
                const up = k * paddle.w * 0.5 * (1 - t * t);
                pts.push({ x, y: baseY - up - thickness });
            }
            for (let i = N; i >= 0; i--) {
                const x = paddle.x + (paddle.w * i / N);
                const t = (x - cx) / halfW;
                const up = k * paddle.w * 0.5 * (1 - t * t);
                pts.push({ x, y: baseY - up });
            }

            const g = ctx.createLinearGradient(paddle.x, 0, paddle.x + paddle.w, 0);
            g.addColorStop(0, '#4dd0e1');
            g.addColorStop(1, '#9c27b0');
            ctx.fillStyle = g;

            ctx.beginPath();
            ctx.moveTo(pts[0].x, pts[0].y);
            for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
            ctx.closePath();
            ctx.fill();
            ctx.shadowBlur = 0;

            ctx.strokeStyle = 'rgba(255,255,255,' + (0.4 + flash * 0.5) + ')';
            ctx.lineWidth = 2;
            ctx.beginPath();
            for (let i = 0; i <= N; i++) {
                const x = paddle.x + (paddle.w * i / N);
                const t = (x - cx) / halfW;
                const up = k * paddle.w * 0.5 * (1 - t * t);
                const y = baseY - up - thickness + 2;
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.stroke();
        }

        // ===== Щит =====
        if (activeBuffs.shield > 0) {
            drawShield();
        }
    }

    function drawShield() {
        const cx = paddle.x + paddle.w / 2;
        const cy = paddle.y + paddle.h / 2 - 6;
        const baseR = paddle.w / 2 + 26;
        const pulse = 0.5 + 0.5 * Math.sin(time * 22);
        const lowTime = activeBuffs.shield < 2;
        const alpha = lowTime ? (0.3 + 0.5 * pulse) : (0.55 + 0.25 * pulse);

        // Полупрозрачный купол
        const g = ctx.createRadialGradient(cx, cy, baseR * 0.5, cx, cy, baseR);
        g.addColorStop(0, 'rgba(41, 182, 246, 0)');
        g.addColorStop(0.7, `rgba(41, 182, 246, ${alpha * 0.35})`);
        g.addColorStop(1, `rgba(41, 182, 246, ${alpha * 0.7})`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(cx, cy, baseR, 0, Math.PI * 2);
        ctx.fill();

        // Электрические дуги (зигзаги) — 5 штук, каждый со своим смещением по времени
        const arcs = 5;
        for (let a = 0; a < arcs; a++) {
            const baseAngle = (a / arcs) * Math.PI * 2 + time * 1.5;
            // Слегка дрожит
            const angle = baseAngle + Math.sin(time * 13 + a * 2.1) * 0.15;
            const startR = baseR * (0.75 + 0.15 * Math.sin(time * 5 + a));
            const endR = baseR * (0.95 + 0.05 * Math.sin(time * 7 + a * 1.3));

            const x1 = cx + Math.cos(angle) * startR;
            const y1 = cy + Math.sin(angle) * startR;
            const x2 = cx + Math.cos(angle + 0.2) * endR;
            const y2 = cy + Math.sin(angle + 0.2) * endR;

            ctx.strokeStyle = `rgba(120, 220, 255, ${alpha})`;
            ctx.lineWidth = 1.5 + pulse * 1.5;
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            // Зигзаг из 3 сегментов
            const mx = (x1 + x2) / 2 + (Math.random() - 0.5) * 10;
            const my = (y1 + y2) / 2 + (Math.random() - 0.5) * 10;
            ctx.lineTo(mx + (Math.random() - 0.5) * 6, my + (Math.random() - 0.5) * 6);
            ctx.lineTo(x2, y2);
            ctx.stroke();
        }

        // Внешнее пульсирующее кольцо
        ctx.strokeStyle = `rgba(41, 182, 246, ${alpha * 0.8})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, baseR, 0, Math.PI * 2);
        ctx.stroke();
    }

    function drawBullet(bl) {
        const wob = Math.sin(bl.wobble) * 1.5;
        // Свечение
        const g = ctx.createRadialGradient(bl.x, bl.y, 0, bl.x, bl.y, bl.r * 3);
        g.addColorStop(0, 'rgba(255, 100, 100, 1)');
        g.addColorStop(0.5, 'rgba(255, 23, 68, 0.6)');
        g.addColorStop(1, 'rgba(255, 23, 68, 0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(bl.x, bl.y, bl.r * 3, 0, Math.PI * 2);
        ctx.fill();

        // Ядро
        ctx.fillStyle = '#fff';
        ctx.shadowColor = '#ff1744';
        ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.arc(bl.x + wob, bl.y, bl.r, 0, Math.PI * 2);
        ctx.fill();

        // Хвостик сверху
        ctx.shadowBlur = 0;
        ctx.strokeStyle = 'rgba(255, 100, 100, 0.7)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(bl.x, bl.y - bl.r - 2);
        ctx.lineTo(bl.x, bl.y - bl.r - 10);
        ctx.stroke();
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
        for (const b of bricks) if (b.alive) drawBrick(b);
        for (const p of powerups) drawPowerup(p);

        // Снаряды — под платформой, чтобы щит их "перекрывал"
        for (const bl of bullets) drawBullet(bl);

        drawPaddle();
        for (const ball of balls) drawBall(ball);

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