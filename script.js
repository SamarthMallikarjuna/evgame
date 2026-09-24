// Game Configuration & Constants
const CONFIG = {
    canvasWidth: 480,
    canvasHeight: 800,
    lanes: [100, 240, 380], // X coordinates for Left, Center, Right lanes
    baseSpeed: 400, // pixels per second
    speedCap: 900,
    gravity: 2000,
    jumpPower: -700,
    maxSlideDuration: 4.0, // max 4 seconds
    spawnRateBase: 1.5, // seconds between spawns
    powerupDurations: {
        repairKit: 10,
        circularBoost: 10,
        thriftShield: -1, // -1 means until broken
        upcycleCutter: 2, // instant wave effect duration
        zeroWaste: 8
    }
};

// Load Images
const playerImgStand = new Image();
playerImgStand.src = 'assets/player_stand.png';

const playerImgSlide = new Image();
playerImgSlide.src = 'assets/player_slide.png';

// Game State
let STATE = {
    screen: 'start', // start, playing, paused, gameover, levelup, level3
    level: 1,
    maxLevelReached: 1, // 1: start, 2: level 2 screen reached, 3: level 3 screen reached, 4: level 4 endless mode reached
    score: 0,
    multiplier: 1,
    distance: 0,
    ecoScore: 0,
    sacrificedPowerup: null,
    speed: CONFIG.baseSpeed,
    lastTime: 0,
    deltaTime: 0,
    audioEnabled: true,
    playerName: '',
    lastDeathReason: 'landfill'
};

let currentRunSubmitted = false;

// Canvas & Context
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
let gameLoopId;

// Audio Context (Synthesized Sounds)
let actx;
function initAudio() {
    if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
}

function playSound(type) {
    if (!STATE.audioEnabled || !actx) return;
    const osc = actx.createOscillator();
    const gain = actx.createGain();
    osc.connect(gain);
    gain.connect(actx.destination);

    const now = actx.currentTime;

    switch (type) {
        case 'jump':
            osc.type = 'sine';
            osc.frequency.setValueAtTime(300, now);
            osc.frequency.exponentialRampToValueAtTime(600, now + 0.2);
            gain.gain.setValueAtTime(0.3, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
            osc.start(now);
            osc.stop(now + 0.2);
            break;
        case 'slide':
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(200, now);
            osc.frequency.linearRampToValueAtTime(100, now + 0.3);
            gain.gain.setValueAtTime(0.3, now);
            gain.gain.linearRampToValueAtTime(0.01, now + 0.3);
            osc.start(now);
            osc.stop(now + 0.3);
            break;
        case 'collectGood': // Reusable
            osc.type = 'square';
            osc.frequency.setValueAtTime(440, now);
            osc.frequency.setValueAtTime(554, now + 0.1);
            osc.frequency.setValueAtTime(659, now + 0.2);
            gain.gain.setValueAtTime(0.1, now);
            gain.gain.linearRampToValueAtTime(0.01, now + 0.3);
            osc.start(now);
            osc.stop(now + 0.3);
            break;
        case 'collectOkay': // Repairable/Recyclable
            osc.type = 'sine';
            osc.frequency.setValueAtTime(440, now);
            gain.gain.setValueAtTime(0.2, now);
            gain.gain.linearRampToValueAtTime(0.01, now + 0.2);
            osc.start(now);
            osc.stop(now + 0.2);
            break;
        case 'hit':
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(150, now);
            osc.frequency.exponentialRampToValueAtTime(40, now + 0.3);
            gain.gain.setValueAtTime(0.4, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
            osc.start(now);
            osc.stop(now + 0.3);
            break;
        case 'powerup':
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(400, now);
            osc.frequency.linearRampToValueAtTime(800, now + 0.2);
            osc.frequency.linearRampToValueAtTime(600, now + 0.4);
            osc.frequency.linearRampToValueAtTime(1200, now + 0.6);
            gain.gain.setValueAtTime(0.2, now);
            gain.gain.linearRampToValueAtTime(0.01, now + 0.6);
            osc.start(now);
            osc.stop(now + 0.6);
            break;
        case 'roboticDeath':
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(200, now);
            osc.frequency.exponentialRampToValueAtTime(20, now + 1.5);

            // glitch effect modulation
            let mod = actx.createOscillator();
            mod.type = 'square';
            mod.frequency.value = 15;
            let modGain = actx.createGain();
            modGain.gain.value = 100;
            mod.connect(modGain);
            modGain.connect(osc.frequency);
            mod.start(now);
            mod.stop(now + 1.5);

            gain.gain.setValueAtTime(0.5, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 1.5);
            osc.start(now);
            osc.stop(now + 1.5);
            break;
        case 'levelUpWarning':
            osc.type = 'square';
            osc.frequency.setValueAtTime(400, now);
            osc.frequency.linearRampToValueAtTime(600, now + 0.5);
            osc.frequency.setValueAtTime(400, now + 1.0);
            osc.frequency.linearRampToValueAtTime(600, now + 1.5);
            gain.gain.setValueAtTime(0.1, now);
            gain.gain.setValueAtTime(0.01, now + 2.0);
            osc.start(now);
            osc.stop(now + 2.0);
            break;
    }
}

function speakWarning() {
    if (!STATE.audioEnabled) return;
    let msg = new SpeechSynthesisUtterance("Cement kilns detected");
    msg.rate = 0.8;
    msg.pitch = 0.3; // Robotic pitch
    window.speechSynthesis.speak(msg);
}

// Input Handling
const Input = {
    left: false, right: false, up: false, down: false,
    swipeX: 0, swipeY: 0, touchStartX: 0, touchStartY: 0
};

window.addEventListener('keydown', (e) => {
    if (STATE.screen !== 'playing') return;
    if (e.repeat) return;
    if (e.key === 'ArrowLeft' || e.key === 'a') { player.switchLane(-1); }
    if (e.key === 'ArrowRight' || e.key === 'd') { player.switchLane(1); }
    if (e.key === ' ' || e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') { player.jump(); }
    if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') { Input.down = true; player.slide(); }

    // Developer Shortcut
    if (e.key.toLowerCase() === 'r') {
        activateDevShortcut();
    }

    if (e.key === 'Escape' || e.key === 'p') { togglePause(); }
});

window.addEventListener('keyup', (e) => {
    if (STATE.screen !== 'playing') return;
    if (e.key === 'ArrowDown' || e.key === 's') {
        Input.down = false;
        if (player) player.stopSlide();
    }
});

// Touch controls
let touchState = { startX: 0, startY: 0, handled: false, isSlide: false };

canvas.addEventListener('touchstart', e => {
    touchState.startX = e.changedTouches[0].screenX;
    touchState.startY = e.changedTouches[0].screenY;
    touchState.handled = false;
    touchState.isSlide = false;
}, { passive: true });

canvas.addEventListener('touchmove', e => {
    if (STATE.screen !== 'playing' || touchState.handled) return;
    const currentX = e.changedTouches[0].screenX;
    const currentY = e.changedTouches[0].screenY;
    const diffX = currentX - touchState.startX;
    const diffY = currentY - touchState.startY;

    if (Math.abs(diffX) > Math.abs(diffY)) {
        if (Math.abs(diffX) > 40) {
            if (diffX > 0) player.switchLane(1);
            else player.switchLane(-1);
            touchState.handled = true;
        }
    } else {
        if (Math.abs(diffY) > 40) {
            if (diffY < 0) {
                player.jump();
                touchState.handled = true;
            } else {
                player.slide();
                touchState.handled = true;
                touchState.isSlide = true;
            }
        }
    }
}, { passive: true });

canvas.addEventListener('touchend', e => {
    if (STATE.screen !== 'playing') return;
    if (touchState.isSlide) {
        player.stopSlide();
    }
}, { passive: true });

// HUD Elements
const UI = {
    score: document.getElementById('score-val'),
    pauseBtn: document.getElementById('pause-btn'),
    distance: document.getElementById('distance-val'),
    ecoScore: document.getElementById('eco-score-val'),
    toast: document.getElementById('eco-toast'),
    toastIcon: document.getElementById('toast-icon'),
    toastText: document.getElementById('toast-text'),
    powerupBar: document.getElementById('powerup-bar'),
    startScreen: document.getElementById('start-screen'),
    tutorialScreen: document.getElementById('tutorial-screen'),
    tutTimerRing: document.getElementById('tut-timer-ring'),
    tutCloseBtn: document.getElementById('tut-close-wrapper'),
    pauseScreen: document.getElementById('pause-screen'),
    levelUpScreen: document.getElementById('level-up-screen'),
    level3Screen: document.getElementById('level3-screen'),
    level4Screen: document.getElementById('level4-screen'),
    level4FollowText: document.getElementById('level4-follow-text'),
    level4ProceedBtn: document.getElementById('level4-proceed-btn'),
    devTimerScreen: document.getElementById('dev-timer-screen'),
    devCountdownText: document.getElementById('dev-countdown-text'),
    deathTransitionScreen: document.getElementById('death-transition-screen'),
    deathReasonText: document.getElementById('death-reason-text'),
    gameOverTitle: document.getElementById('game-over-title'),
    gameOverScreen: document.getElementById('game-over-screen'),
    hud: document.getElementById('hud')
};

// Game Objects
let entities = [];
let particles = [];
let roadOffset = 0;
let nextSpawnTime = 0;

class Player {
    constructor() {
        this.laneIndex = 1;
        this.targetX = CONFIG.lanes[this.laneIndex];
        this.x = this.targetX;
        this.y = CONFIG.canvasHeight - 150;
        this.z = 0; // Altitude for jumping
        this.zVel = 0;
        this.width = 50;
        this.height = 80;
        this.state = 'run'; // run, jump, slide
        this.slideTimer = 0;
        this.powerups = {};
        this.powerupOrder = [];
    }

    switchLane(dir) {
        if (this.state === 'slide') return; // Can't switch while sliding
        this.laneIndex = Math.max(0, Math.min(2, this.laneIndex + dir));
        this.targetX = CONFIG.lanes[this.laneIndex];
        playSound('jump');
    }

    jump() {
        if (this.z === 0 && this.state !== 'slide') {
            this.zVel = CONFIG.jumpPower;
            this.state = 'jump';
            playSound('jump');
        }
    }

    slide() {
        if (this.z === 0 && this.state !== 'slide') {
            this.state = 'slide';
            this.slideTimer = CONFIG.maxSlideDuration;
            playSound('slide');
        }
    }

    stopSlide() {
        if (this.state === 'slide') {
            this.state = 'run';
        }
    }

    update(dt) {
        // Lane interpolation
        this.x += (this.targetX - this.x) * 15 * dt;

        // Jump Physics
        if (this.state === 'jump') {
            this.z += this.zVel * dt;
            this.zVel += CONFIG.gravity * dt;
            if (this.z > 0) {
                this.z = 0;
                this.zVel = 0;
                this.state = 'run';
            }
        }

        // Slide logic
        if (this.state === 'slide') {
            this.slideTimer -= dt;
            if (this.slideTimer <= 0) {
                this.state = 'run';
            }
        }

        // Update powerups
        for (let p in this.powerups) {
            if (this.powerups[p] > 0) {
                this.powerups[p] -= dt;
                if (this.powerups[p] <= 0) {
                    delete this.powerups[p];
                    this.powerupOrder = (this.powerupOrder || []).filter(t => t !== p);
                    updatePowerupUI();
                    if (p === 'zeroWaste') document.getElementById('game-container').classList.remove('zero-waste-glow');
                }
            }
        }
    }

    draw(ctx) {
        let drawY = this.y + this.z;
        let drawScale = 1;
        if (this.state === 'jump') drawScale = 1 - (this.z / 1500); // gets bigger slightly when jumping

        ctx.save();
        ctx.translate(this.x, drawY);
        ctx.scale(drawScale, drawScale);

        // Shadow
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.beginPath();
        ctx.ellipse(0, this.height / 2 - this.z, this.width / 2, this.width / 4, 0, 0, Math.PI * 2);
        ctx.fill();

        // Aura
        if (this.hasPowerup('zeroWaste')) {
            ctx.shadowColor = '#00ff88';
            ctx.shadowBlur = 20;
        }

        // Check if any powerup is expiring (<= 1.0s)
        let isBlinking = false;
        for (let p in this.powerups) {
            if (this.powerups[p] > 0 && this.powerups[p] <= 1.0) {
                isBlinking = true;
                break;
            }
        }

        let drawRobot = true;
        if (isBlinking) {
            // Blink 5 times in the last second (10 state changes = 100ms per change)
            if (Math.floor(performance.now() / 100) % 2 === 0) {
                drawRobot = false;
            }
        }

        // Body variables
        let img = this.state === 'slide' ? playerImgSlide : playerImgStand;
        let imgW = 90;
        let imgH = 90;
        let imgYOff = this.state === 'slide' ? 10 : -10; // offset down if sliding

        if (drawRobot) {
            // Character drawing
            if (img.complete) {
                ctx.drawImage(img, -imgW / 2, -this.height / 2 + imgYOff, imgW, imgH);
            } else {
                // Fallback before image loads
                let h = this.state === 'slide' ? this.height / 2 : this.height;
                let yOff = this.state === 'slide' ? this.height / 2 : 0;
                ctx.fillStyle = this.hasPowerup('zeroWaste') ? '#00ff88' : '#fff';
                ctx.beginPath();
                ctx.roundRect(-this.width / 2, -this.height / 2 + yOff, this.width, h, 20);
                ctx.fill();
            }
        }

        if (this.hasPowerup('thriftShield')) {
            ctx.strokeStyle = '#00d4ff';
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.arc(0, -this.height / 2 + imgYOff + imgH / 2, imgH / 2 + 5, 0, Math.PI * 2);
            ctx.stroke();
        }

        // Reset shadow/aura so it remains on the robot body but does not affect the floating box above
        ctx.shadowBlur = 0;

        // Draw sleek powerup box & white progress bar over the robot
        const powerupEmojis = {
            'repairKit': '🪡',
            'circularBoost': '🧲',
            'zeroWaste': '🌱'
        };

        const timelineTypes = ['repairKit', 'circularBoost', 'zeroWaste'];
        const activeList = (this.powerupOrder || []).filter(p => this.powerups[p] > 0 && timelineTypes.includes(p));

        activeList.forEach((p, index) => {
            let max = CONFIG.powerupDurations[p];
            let cur = this.powerups[p];
            let pct = Math.max(0, Math.min(1, cur / max));
            let emoji = powerupEmojis[p];

            // Most recent powerup is below (stackPos = 0), oldest powerup is on top (stackPos = activeList.length - 1 - index)
            let stackPos = (activeList.length - 1) - index;

            let boxW = 76;
            let boxH = 20;
            let boxX = -boxW / 2;
            let boxY = -this.height / 2 + imgYOff - 42 - (stackPos * 25);

            // Sleek dark rectangular box background over robot
            ctx.fillStyle = 'rgba(12, 18, 28, 0.85)';
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            if (typeof ctx.roundRect === 'function') {
                ctx.roundRect(boxX, boxY, boxW, boxH, 6);
            } else {
                ctx.rect(boxX, boxY, boxW, boxH);
            }
            ctx.fill();
            ctx.stroke();

            // Small emoji corresponding to the powerup
            ctx.font = '12px Arial, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(emoji, boxX + 13, boxY + boxH / 2 + 1);

            // Progress track (background slot)
            let barX = boxX + 25;
            let barY = boxY + 7;
            let barW = boxW - 31; // 45px
            let barH = 6;

            ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
            ctx.beginPath();
            if (typeof ctx.roundRect === 'function') {
                ctx.roundRect(barX, barY, barW, barH, 3);
            } else {
                ctx.rect(barX, barY, barW, barH);
            }
            ctx.fill();

            // Decreasing white fill line only
            let fillW = barW * pct;
            if (fillW > 0) {
                ctx.fillStyle = '#ffffff';
                ctx.shadowColor = '#ffffff';
                ctx.shadowBlur = 6;
                ctx.beginPath();
                if (typeof ctx.roundRect === 'function') {
                    ctx.roundRect(barX, barY, fillW, barH, 3);
                } else {
                    ctx.rect(barX, barY, fillW, barH);
                }
                ctx.fill();
                ctx.shadowBlur = 0; // reset shadow
            }
        });

        ctx.restore();
    }

    hasPowerup(type) {
        return this.powerups[type] !== undefined;
    }

    activatePowerup(type) {
        const pData = CONFIG.powerupDurations[type];
        this.powerups[type] = pData;
        if (!this.powerupOrder) this.powerupOrder = [];
        this.powerupOrder = this.powerupOrder.filter(t => t !== type);
        this.powerupOrder.push(type);
        playSound('powerup');
        updatePowerupUI();

        if (type === 'repairKit') showToast('🪡', "FIX IT. DON'T BIN IT.");
        if (type === 'circularBoost') showToast('🧲', "MAGNET ACTIVATED");
        if (type === 'thriftShield') showToast('🛡️', "SHIELD EQUIPPED");
        if (type === 'upcycleCutter') {
            showToast('✂️', "UPCYCLE WAVE!");
            spawnUpcycleWave();
        }
        if (type === 'zeroWaste') {
            showToast('🌱', "ZERO WASTE MODE!");
            document.getElementById('game-container').classList.add('zero-waste-glow');
        }
    }
}

class Entity {
    constructor(laneIndex, type, subtype) {
        this.laneIndex = laneIndex;
        this.x = CONFIG.lanes[laneIndex];
        this.y = -100;
        this.type = type; // 'collectable', 'obstacle', 'powerup'
        this.subtype = subtype;
        this.width = 50;
        this.height = 50;
        this.active = true;
        this.magnetized = false;

        // Height profiles for collisions
        this.zHeight = 0; // How high it reaches
        this.zBase = 0; // Where it starts from ground

        if (type === 'obstacle') {
            if (subtype === 'landfill') { this.zHeight = 40; this.width = 70; this.height = 70; } // Ground
            if (subtype === 'microplastic') { this.zHeight = 5; this.width = 80; this.height = 80; } // Ground
            if (subtype === 'ad') { this.zBase = 60; this.zHeight = 120; this.width = 80; this.height = 20; } // High
            if (subtype === 'powerline') { this.zBase = 60; this.zHeight = 80; this.width = 140; this.height = 20; } // High, spans lanes
            if (subtype === 'cementKiln') { this.zHeight = 40; this.width = 55; this.height = 55; } // Red square
        }
    }

    update(dt) {
        this.y += STATE.speed * dt;

        // Circular Boost (Magnet) Logic
        if (player.hasPowerup('circularBoost') && (this.type === 'collectable' || this.type === 'powerup')) {
            const dy = player.y - this.y;
            const dx = player.x - this.x;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < 400 && this.y < player.y) {
                this.magnetized = true;
                this.x += (dx / dist) * CONFIG.baseSpeed * 1.5 * dt;
                this.y += (dy / dist) * CONFIG.baseSpeed * 0.5 * dt;
            }
        }

        if (this.y > CONFIG.canvasHeight + 100) {
            this.active = false;
        }
    }

    draw(ctx) {
        ctx.save();
        ctx.translate(this.x, this.y);

        if (this.type === 'collectable') {
            let icon = '👕';
            if (this.subtype === 'repairable') { icon = '🧵'; }
            if (this.subtype === 'recyclable') { icon = '♻️'; }

            // Repair kit active logic
            if (this.subtype === 'repairable' && player.hasPowerup('repairKit')) {
                icon = '👕+';
            }
            if (player.hasPowerup('zeroWaste')) {
                ctx.shadowColor = '#00ff88';
                ctx.shadowBlur = 20;
            }

            ctx.font = '48px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(icon, 0, 0);
            ctx.shadowBlur = 0; // reset
        }
        else if (this.type === 'obstacle') {
            if (player.hasPowerup('zeroWaste')) {
                // Obstacles turn into glowing zero-waste collectables
                ctx.shadowColor = '#00ff88';
                ctx.shadowBlur = 25;
                ctx.font = '45px Arial';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText('♻️', 0, 0);
                ctx.shadowBlur = 0; // reset
            } else {
                if (this.subtype === 'landfill') {
                    ctx.fillStyle = '#8b5a2b';
                    ctx.beginPath();
                    ctx.moveTo(-this.width / 2, this.height / 2);
                    ctx.lineTo(0, -this.height / 2);
                    ctx.lineTo(this.width / 2, this.height / 2);
                    ctx.fill();
                }
                else if (this.subtype === 'microplastic') {
                    ctx.fillStyle = 'rgba(0, 100, 255, 0.5)';
                    ctx.beginPath();
                    ctx.ellipse(0, 0, this.width / 2, this.height / 4, 0, 0, Math.PI * 2);
                    ctx.fill();
                }
                else if (this.subtype === 'ad') {
                    ctx.fillStyle = '#ff3366'; // neon pink
                    ctx.fillRect(-this.width / 2, -this.height / 2, this.width, this.height);
                    ctx.shadowColor = '#ff3366';
                    ctx.shadowBlur = 10;
                    ctx.fillStyle = '#fff';
                    ctx.font = '10px Arial';
                    ctx.textAlign = 'center';
                    ctx.fillText("BUY NOW", 0, 3);
                }
                else if (this.subtype === 'powerline') {
                    ctx.fillStyle = '#222';
                    ctx.fillRect(-this.width / 2, -this.height / 2, this.width, this.height);
                    ctx.fillStyle = '#ffaa00'; // warning stripes
                    for (let i = -this.width / 2; i < this.width / 2; i += 20) {
                        ctx.fillRect(i, -this.height / 2, 10, this.height);
                    }
                }
                else if (this.subtype === 'cementKiln') {
                    ctx.fillStyle = '#ff0000'; // Red square
                    if (typeof ctx.roundRect === 'function') {
                        ctx.beginPath();
                        ctx.roundRect(-this.width / 2, -this.height / 2, this.width, this.height, 6);
                        ctx.fill();
                    } else {
                        ctx.fillRect(-this.width / 2, -this.height / 2, this.width, this.height);
                    }
                }
            }
        }
        else if (this.type === 'powerup') {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
            ctx.beginPath();
            ctx.arc(0, 0, 30, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 2;
            ctx.stroke();

            let icon = '❓';
            if (this.subtype === 'repairKit') icon = '🪡';
            if (this.subtype === 'circularBoost') icon = '🧲';
            if (this.subtype === 'thriftShield') icon = '🛡️';
            if (this.subtype === 'upcycleCutter') icon = '✂️';
            if (this.subtype === 'zeroWaste') icon = '🌱';

            ctx.fillStyle = '#fff';
            ctx.font = '30px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(icon, 0, 0);
        }

        ctx.restore();
    }
}

class Particle {
    constructor(x, y, color) {
        this.x = x;
        this.y = y;
        this.vx = (Math.random() - 0.5) * 200;
        this.vy = (Math.random() - 0.5) * 200 - 100;
        this.life = 1.0;
        this.color = color;
    }
    update(dt) {
        this.x += this.vx * dt;
        this.y += this.vy * dt;
        this.life -= dt * 2;
    }
    draw(ctx) {
        ctx.globalAlpha = Math.max(0, this.life);
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.arc(this.x, this.y, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
    }
}

let player;
let upcycleWaveActive = false;
let upcycleWaveY = 0;

function spawnUpcycleWave() {
    upcycleWaveActive = true;
    upcycleWaveY = player.y;
}

function initGame() {
    initAudio();
    player = new Player();
    entities = [];
    particles = [];
    STATE.level = 1;
    STATE.maxLevelReached = 1;
    STATE.score = 0;
    STATE.multiplier = 1;
    STATE.distance = 0;
    STATE.ecoScore = 0;
    STATE.sacrificedPowerup = null;
    CONFIG.baseSpeed = 400; // Reset speed
    CONFIG.speedCap = 900;
    STATE.speed = CONFIG.baseSpeed;
    roadOffset = 0;
    nextSpawnTime = 0;
    upcycleWaveActive = false;

    UI.startScreen.classList.add('hidden');
    UI.tutorialScreen.classList.add('hidden');
    UI.pauseScreen.classList.add('hidden');
    if (UI.pauseBtn) UI.pauseBtn.classList.remove('is-paused');
    UI.levelUpScreen.classList.add('hidden');
    UI.level3Screen.classList.add('hidden');
    UI.level4Screen.classList.add('hidden');
    UI.devTimerScreen.classList.add('hidden');
    UI.gameOverScreen.classList.add('hidden');
    UI.hud.classList.remove('hidden');
    document.getElementById('game-container').classList.remove('zero-waste-glow');

    STATE.screen = 'playing';
    STATE.lastTime = performance.now();
    cancelAnimationFrame(gameLoopId);
    gameLoopId = requestAnimationFrame(gameLoop);
}

function gameOver(reason) {
    STATE.screen = 'gameover';
    STATE.lastDeathReason = reason || 'landfill';
    playSound('roboticDeath');
    UI.hud.classList.add('hidden');

    let reasonText = "LANDFILL OVERFLOW!";
    if (reason === 'landfill') reasonText = "BURIED WITH THE WASTE";
    if (reason === 'microplastic') reasonText = "CLOGGED BY PLASTIC PARTICLES";
    if (reason === 'ad') reasonText = "ATTRACTED BY FAST FASHION";
    if (reason === 'powerline') reasonText = "SYSTEM ELECTROCUTED";
    if (reason === 'cementKiln') reasonText = "COMPONENTS INCINERATED";

    UI.deathReasonText.innerText = "";
    UI.gameOverTitle.innerText = reasonText;

    // Setup fade in
    UI.deathTransitionScreen.style.opacity = '0';
    UI.deathTransitionScreen.classList.remove('hidden');
    void UI.deathTransitionScreen.offsetWidth; // Trigger reflow for CSS transition
    UI.deathTransitionScreen.style.opacity = '1';

    // Typewriter effect
    let charIndex = 0;
    function typeWriter() {
        if (charIndex < reasonText.length) {
            UI.deathReasonText.innerText += reasonText.charAt(charIndex);
            charIndex++;
            setTimeout(typeWriter, 60); // Type speed
        }
    }
    setTimeout(typeWriter, 1000); // Wait for fade in before typing

    setTimeout(() => {
        UI.deathTransitionScreen.style.opacity = '0';
        setTimeout(() => {
            UI.deathTransitionScreen.classList.add('hidden');
            UI.gameOverScreen.classList.remove('hidden');
        }, 1500); // Wait for fade out
    }, 3500); // Show death text for 3.5s total (compensating for delay)

    document.getElementById('final-score').innerText = Math.floor(STATE.score);
    document.getElementById('final-clothes').innerText = STATE.ecoScore;
    document.getElementById('final-distance').innerText = Math.floor(STATE.distance) + 'm';

    let high = localStorage.getItem('ecoRunnerHigh') || 0;
    if (STATE.score > high) {
        high = STATE.score;
        localStorage.setItem('ecoRunnerHigh', high);
    }
    document.getElementById('high-score').innerText = Math.floor(high);

    const finalScoreVal = Math.floor(STATE.score);
    const finalDistVal = Math.floor(STATE.distance);

    const impactScoreEl = document.getElementById('impact-score');
    if (impactScoreEl) impactScoreEl.innerText = finalScoreVal.toLocaleString();

    const impactDistEl = document.getElementById('impact-distance');
    if (impactDistEl) impactDistEl.innerText = finalDistVal.toLocaleString() + 'm';

    document.getElementById('impact-landfills').innerText = (STATE.ecoScore * 0.5).toFixed(1) + ' kg';
    document.getElementById('impact-microplastics').innerText = (STATE.ecoScore * 25) + ' g';

    let grade = 'F';
    let sub = "Waste Novice";
    let gradeColor = '#ff3366';

    if (STATE.score < 2000) {
        grade = 'F';
        sub = "Waste Novice";
        gradeColor = '#ff3366'; // Red
    } else if (STATE.maxLevelReached < 2 && STATE.score < 5000) {
        grade = 'D';
        sub = "Eco Apprentice";
        gradeColor = '#ff5500'; // Orangish Red
    } else if (STATE.score < 10000) {
        grade = 'C';
        sub = "Thrift Collector";
        gradeColor = '#ffaa00'; // Yellow Orange
    } else if (STATE.maxLevelReached < 3) {
        grade = 'B';
        sub = "Sustainability Hero";
        gradeColor = '#ffd700'; // Yellow
    } else if (STATE.maxLevelReached < 4 && STATE.level < 4) {
        grade = 'A';
        sub = "Circular Fashionista";
        gradeColor = '#00ff88'; // Green
    } else {
        grade = 'S';
        sub = "Master EcoSurfer";
        gradeColor = '#00d4ff'; // Blue
    }

    const ecoGradeEl = document.getElementById('eco-grade');
    ecoGradeEl.innerText = grade;
    ecoGradeEl.style.color = gradeColor;

    const ecoSubEl = document.getElementById('eco-grade-subtitle');
    ecoSubEl.innerText = sub;
    ecoSubEl.style.color = gradeColor;

    document.getElementById('player-name-display').innerHTML = `Great job, <span>${STATE.playerName}</span>! Here's what you achieved:`;

    // Lock leaderboard name input to active account real name
    const lbNameInput = document.getElementById('leaderboard-name-input');
    const activeAcc = getActiveAccount();
    const lockedName = (activeAcc && activeAcc.realName) ? activeAcc.realName : (STATE.playerName || 'EcoSurfer');
    if (lbNameInput) {
        lbNameInput.value = lockedName;
        lbNameInput.readOnly = true;
        lbNameInput.disabled = true;
    }

    // Reset leaderboard submit button for new run
    currentRunSubmitted = false;
    const submitLbBtn = document.getElementById('submit-leaderboard-btn');
    if (submitLbBtn) {
        submitLbBtn.innerHTML = '🏆 SUBMIT SCORE';
        submitLbBtn.disabled = false;
    }
}

function togglePause() {
    if (STATE.screen === 'playing') {
        STATE.screen = 'paused';
        UI.pauseScreen.classList.remove('hidden');
        if (UI.pauseBtn) UI.pauseBtn.classList.add('is-paused');
    } else if (STATE.screen === 'paused') {
        STATE.screen = 'counting';
        UI.pauseScreen.classList.add('hidden');
        if (UI.pauseBtn) UI.pauseBtn.classList.remove('is-paused');
        runLevelCountdown(() => {
            STATE.screen = 'playing';
            STATE.lastTime = performance.now();
            gameLoopId = requestAnimationFrame(gameLoop);
        });
    }
}

function spawnEntities() {
    // Determine spawn complexity based on speed/distance
    let pattern = Math.random();

    if (pattern < 0.2) {
        // Spawn Powerup
        let types = ['repairKit', 'circularBoost', 'thriftShield', 'upcycleCutter', 'zeroWaste'];
        if (STATE.sacrificedPowerup) {
            types = types.filter(t => t !== STATE.sacrificedPowerup);
        }
        let type = types[Math.floor(Math.random() * types.length)];
        entities.push(new Entity(Math.floor(Math.random() * 3), 'powerup', type));
    } else if (pattern < 0.6) {
        // Scattered collectables (one per lane, staggered along the run)
        let availableLanes = [0, 1, 2].sort(() => Math.random() - 0.5);
        for (let i = 0; i < 3; i++) {
            let t = Math.random();
            let sub = t < 0.5 ? 'reusable' : (t < 0.8 ? 'repairable' : 'recyclable');
            let e = new Entity(availableLanes[i], 'collectable', sub);
            e.y = -100 - (i * 120) - (Math.random() * 60);
            entities.push(e);
        }
    } else {
        // Obstacles
        let obsType = Math.random();
        let sub = 'landfill';
        if (obsType > 0.4) sub = 'microplastic';
        if (obsType > 0.7) sub = 'ad';
        if (obsType > 0.9) sub = 'powerline';
        if (STATE.level >= 2 && Math.random() > 0.7) sub = 'cementKiln'; // Level 2 adds cement kilns

        let lane1 = Math.floor(Math.random() * 3);
        entities.push(new Entity(lane1, 'obstacle', sub));

        // Sometimes spawn 2 obstacles blocking lanes
        if (Math.random() > 0.5 && sub !== 'powerline') {
            let lane2 = (lane1 + 1 + Math.floor(Math.random() * 2)) % 3;
            entities.push(new Entity(lane2, 'obstacle', sub));
        }
    }
}

function checkCollisions() {
    // Player hitboxes based on state
    let pZBottom = player.z; // jump moves this negative (up)
    let pZTop = pZBottom - (player.state === 'slide' ? player.height / 2 : player.height); // pseudo 3D top height

    let pRect = {
        left: player.x - player.width / 2 + 10,
        right: player.x + player.width / 2 - 10,
        top: player.y - player.height / 2 + 10,
        bottom: player.y + player.height / 2 - 10
    };

    entities.forEach(ent => {
        if (!ent.active) return;

        let eRect = {
            left: ent.x - ent.width / 2,
            right: ent.x + ent.width / 2,
            top: ent.y - ent.height / 2,
            bottom: ent.y + ent.height / 2
        };

        // 2D box collision first
        if (pRect.left < eRect.right && pRect.right > eRect.left &&
            pRect.top < eRect.bottom && pRect.bottom > eRect.top) {

            // Check Z (height) collision
            let hit = false;

            if (ent.type === 'obstacle' && !player.hasPowerup('zeroWaste')) {
                // Obstacle Z bounds
                let eZBottom = -ent.zBase;
                let eZTop = -ent.zBase - ent.zHeight;

                // If player bottom is higher than obstacle top (jump over) -> NO HIT
                // If player top is lower than obstacle bottom (slide under) -> NO HIT
                if (pZBottom <= eZTop || pZTop >= eZBottom) {
                    hit = false;
                } else {
                    hit = true;
                }

                if (hit) {
                    if (player.hasPowerup('thriftShield')) {
                        delete player.powerups['thriftShield'];
                        ent.active = false;
                        playSound('powerup');
                        createParticles(ent.x, ent.y, '#00d4ff', 20);
                        updatePowerupUI();
                    } else {
                        gameOver(ent.subtype);
                    }
                }
            } else {
                // Collection collision (collectables, powerups, or obstacles in zero waste mode)
                hit = true;
            }

            if (hit && ent.type === 'collectable') {
                ent.active = false;
                STATE.ecoScore++;

                let pts = 50;
                if (ent.subtype === 'reusable') pts = 100;
                if (ent.subtype === 'repairable' && player.hasPowerup('repairKit')) pts = 200;
                if (ent.subtype === 'recyclable') pts = 75;

                let mult = STATE.multiplier;
                if (player.hasPowerup('thriftShield')) mult *= 2;
                if (player.hasPowerup('zeroWaste')) mult *= 3;

                STATE.score += pts * mult;
                playSound(pts >= 100 ? 'collectGood' : 'collectOkay');
                createParticles(ent.x, ent.y, '#00ff88', 10);
            }

            if (hit && ent.type === 'obstacle' && player.hasPowerup('zeroWaste')) {
                // Collected obstacle in zero waste!
                ent.active = false;
                STATE.ecoScore += 2;
                STATE.score += 300 * STATE.multiplier;
                playSound('collectGood');
                createParticles(ent.x, ent.y, '#00ff88', 20);
            }

            if (hit && ent.type === 'powerup') {
                ent.active = false;
                player.activatePowerup(ent.subtype);
                createParticles(ent.x, ent.y, '#fff', 15);
            }
        }
    });
}

function createParticles(x, y, color, count) {
    for (let i = 0; i < count; i++) {
        particles.push(new Particle(x, y, color));
    }
}

function updatePowerupUI() {
    if (UI.powerupBar) {
        UI.powerupBar.innerHTML = '';
    }
}

let toastTimer;
function showToast(icon, text) {
    UI.toastIcon.innerText = icon;
    UI.toastText.innerText = text;
    UI.toast.classList.remove('hidden');

    // reset animation
    UI.toast.style.animation = 'none';
    UI.toast.offsetHeight; // trigger reflow
    UI.toast.style.animation = null;

    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
        UI.toast.classList.add('hidden');
    }, 2000);
}

function renderBackground(dt) {
    // Draw road base
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, CONFIG.canvasWidth, CONFIG.canvasHeight);

    // Draw lane lines
    roadOffset = (roadOffset + STATE.speed * dt) % 100;

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 4;
    ctx.setLineDash([40, 60]);

    const mid1 = (CONFIG.lanes[0] + CONFIG.lanes[1]) / 2;
    const mid2 = (CONFIG.lanes[1] + CONFIG.lanes[2]) / 2;

    ctx.beginPath();
    ctx.moveTo(mid1, -100 + roadOffset);
    ctx.lineTo(mid1, CONFIG.canvasHeight);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(mid2, -100 + roadOffset);
    ctx.lineTo(mid2, CONFIG.canvasHeight);
    ctx.stroke();

    ctx.setLineDash([]);
}

function gameLoop(timestamp) {
    if (STATE.screen !== 'playing') return;

    // Check level transition
    if (STATE.score >= 5000 && STATE.level === 1) {
        STATE.screen = 'levelup';
        STATE.maxLevelReached = Math.max(STATE.maxLevelReached, 2);
        playSound('levelUpWarning');
        speakWarning();
        STATE.warningInterval = setInterval(() => {
            playSound('levelUpWarning');
            speakWarning();
        }, 2000);
        UI.levelUpScreen.classList.remove('hidden');

        // Typewriter effect specifically for Cement Kilns title text inside the box
        let typeEl = document.getElementById('cement-kilns-title-text');
        if (typeEl) {
            let msg = "Cement Kilns";
            typeEl.innerText = "";
            let charIdx = 0;
            if (STATE.level2TypewriterTimer) clearInterval(STATE.level2TypewriterTimer);
            STATE.level2TypewriterTimer = setInterval(() => {
                if (charIdx < msg.length) {
                    typeEl.innerText += msg.charAt(charIdx);
                    charIdx++;
                } else {
                    clearInterval(STATE.level2TypewriterTimer);
                }
            }, 80);
        }
        return;
    }

    // Check level 3 transition
    if (STATE.ecoScore >= 100 && STATE.level === 2) {
        STATE.screen = 'level3';
        STATE.maxLevelReached = Math.max(STATE.maxLevelReached, 3);
        playSound('levelUpWarning'); // Use same warning or new one
        UI.level3Screen.classList.remove('hidden');
        return;
    }

    // Check Level 4 transition (Endless Mode trigger)
    if (STATE.ecoScore >= 175 && STATE.level === 3) {
        STATE.screen = 'level4';
        STATE.maxLevelReached = Math.max(STATE.maxLevelReached, 4);
        playSound('levelUpWarning');

        if (STATE.audioEnabled && window.speechSynthesis) {
            let msg = new SpeechSynthesisUtterance("Level 4 Reached. Endless mode engaged.");
            msg.pitch = 0.6;
            msg.rate = 1.0;
            window.speechSynthesis.speak(msg);
        }

        UI.level4Screen.classList.remove('hidden');
        startLevel4Countdown();
        return;
    }

    const dt = (timestamp - STATE.lastTime) / 1000;
    STATE.lastTime = timestamp;

    // Cap dt to prevent massive jumps on lag/tab switch
    const safeDt = Math.min(dt, 0.1);

    // Update game state
    STATE.speed = Math.min(CONFIG.speedCap, CONFIG.baseSpeed + (STATE.distance * 0.1));
    STATE.distance += (STATE.speed / 100) * safeDt;
    STATE.score += STATE.multiplier * safeDt * 10;

    // Spawning
    nextSpawnTime -= safeDt;
    if (nextSpawnTime <= 0) {
        spawnEntities();
        nextSpawnTime = CONFIG.spawnRateBase * (CONFIG.baseSpeed / STATE.speed);
    }

    // Upcycle Wave logic
    if (upcycleWaveActive) {
        upcycleWaveY -= STATE.speed * 2 * safeDt;
        entities.forEach(ent => {
            if (ent.type === 'obstacle' && ent.y > upcycleWaveY) {
                ent.type = 'collectable';
                ent.subtype = 'reusable';
                createParticles(ent.x, ent.y, '#00ff88', 5);
            }
        });
        if (upcycleWaveY < -100) upcycleWaveActive = false;
    }

    // Update entities
    player.update(safeDt);
    entities.forEach(e => e.update(safeDt));
    particles.forEach(p => p.update(safeDt));

    // Remove inactive
    entities = entities.filter(e => e.active);
    particles = particles.filter(p => p.life > 0);

    // Collisions
    checkCollisions();

    // Render
    renderBackground(safeDt);

    // Draw Upcycle Wave
    if (upcycleWaveActive) {
        ctx.fillStyle = 'rgba(0, 255, 136, 0.5)';
        ctx.fillRect(0, upcycleWaveY, CONFIG.canvasWidth, 20);
        ctx.shadowColor = '#00ff88';
        ctx.shadowBlur = 10;
    }
    ctx.shadowBlur = 0; // reset

    // Draw entities (sort by Y to draw top-down perspective correctly)
    let sortedEntities = entities.slice().sort((a, b) => a.y - b.y);

    let behindEntities = [];
    let frontEntities = [];

    sortedEntities.forEach(e => {
        let isHighObstacle = e.type === 'obstacle' && (e.subtype === 'powerline' || e.subtype === 'ad');
        // If the player is sliding and the high obstacle is close to or past the player, draw it in front
        if (player.state === 'slide' && isHighObstacle && e.y >= player.y - 40) {
            frontEntities.push(e);
        } else {
            behindEntities.push(e);
        }
    });

    behindEntities.forEach(e => e.draw(ctx));
    player.draw(ctx);
    frontEntities.forEach(e => e.draw(ctx));

    particles.forEach(p => p.draw(ctx));

    // Update UI
    UI.score.innerText = Math.floor(STATE.score);
    UI.distance.innerText = Math.floor(STATE.distance) + 'm';
    UI.ecoScore.innerText = STATE.ecoScore;

    let curMult = STATE.multiplier;
    if (player.hasPowerup('thriftShield')) curMult *= 2;
    if (player.hasPowerup('zeroWaste')) curMult *= 3;

    // Continually update powerup UI bars
    if (Object.keys(player.powerups).length > 0) updatePowerupUI();

    gameLoopId = requestAnimationFrame(gameLoop);
}

// Cloud Storage Configuration & Real-Time Global Sync Engine
const CLOUD_CONFIG = {
    primaryUrl: 'https://api.restful-api.dev/objects/ff808181a09d98f701a0d25372170528',
    backupUrl: 'https://api.restful-api.dev/objects/ff808181a09d98f701a0d253b84e052a',
    syncing: false,
    lastSyncTime: 0
};

async function syncCloudDatabase() {
    if (CLOUD_CONFIG.syncing) return;
    CLOUD_CONFIG.syncing = true;
    try {
        let remoteData = null;
        try {
            const res = await fetch(CLOUD_CONFIG.primaryUrl);
            if (res.ok) {
                const json = await res.json();
                remoteData = json.data;
            }
        } catch (err) {
            console.warn('Primary cloud sync failed, trying backup...', err);
        }

        if (!remoteData) {
            try {
                const res = await fetch(CLOUD_CONFIG.backupUrl);
                if (res.ok) {
                    const json = await res.json();
                    remoteData = json.data;
                }
            } catch (err) {}
        }

        if (remoteData) {
            const localAccounts = getAllAccounts();
            const localLb = getLeaderboard();

            const mergedAccounts = mergeAccounts(localAccounts, remoteData.accounts || []);
            const mergedLb = mergeLeaderboard(localLb, remoteData.leaderboard || []);

            saveAllAccounts(mergedAccounts, false);
            saveLeaderboard(mergedLb, false);

            const needsPush = mergedAccounts.length > (remoteData.accounts || []).length ||
                              mergedLb.length > (remoteData.leaderboard || []).length;

            if (needsPush) {
                pushCloudDatabase(mergedAccounts, mergedLb);
            }

            updateWeeklyResetSubtext();
            const modal = document.getElementById('leaderboard-modal');
            if (modal && !modal.classList.contains('hidden')) {
                updateLeaderboardUI();
            }
            updateAccountUI();
        }
    } catch (e) {
        console.error('Cloud DB Sync Error:', e);
    } finally {
        CLOUD_CONFIG.syncing = false;
        CLOUD_CONFIG.lastSyncTime = Date.now();
    }
}

async function pushCloudDatabase(accountsList, leaderboardList) {
    const accs = accountsList || getAllAccounts();
    const lb = leaderboardList || getLeaderboard();
    const bodyPayload = JSON.stringify({
        name: 'EcoRunner_Global_Game_Database_v1',
        data: { accounts: accs, leaderboard: lb }
    });

    const headers = { 'Content-Type': 'application/json' };

    try {
        fetch(CLOUD_CONFIG.primaryUrl, { method: 'PUT', headers, body: bodyPayload }).catch(() => {});
        fetch(CLOUD_CONFIG.backupUrl, { method: 'PUT', headers, body: bodyPayload }).catch(() => {});
    } catch (e) {}
}

function mergeAccounts(localAccs, remoteAccs) {
    const map = new Map();
    (remoteAccs || []).forEach(acc => {
        if (acc && acc.username) map.set(acc.username.trim().toLowerCase(), acc);
    });
    (localAccs || []).forEach(acc => {
        if (acc && acc.username) {
            const key = acc.username.trim().toLowerCase();
            if (!map.has(key)) map.set(key, acc);
        }
    });
    return Array.from(map.values());
}

function mergeLeaderboard(localLb, remoteLb) {
    const map = new Map();
    const all = [...(remoteLb || []), ...(localLb || [])];
    all.forEach(entry => {
        if (!entry || !entry.name) return;
        const key = entry.name.trim().toLowerCase();
        if (!map.has(key)) {
            map.set(key, entry);
        } else {
            const existing = map.get(key);
            if ((entry.score || 0) > (existing.score || 0)) {
                map.set(key, entry);
            }
        }
    });
    const merged = Array.from(map.values());
    merged.sort((a, b) => (b.score || 0) - (a.score || 0));
    return merged;
}

// Account Storage Helpers (Local + Cloud Sync)
function getAllAccounts() {
    try {
        const d = localStorage.getItem('ecoRunnerAccountsList');
        return d ? JSON.parse(d) : [];
    } catch (e) {
        return [];
    }
}

function saveAllAccounts(list, triggerPush = true) {
    try {
        localStorage.setItem('ecoRunnerAccountsList', JSON.stringify(list));
        if (triggerPush) {
            pushCloudDatabase(list, getLeaderboard());
        }
    } catch (e) {}
}

function getActiveAccount() {
    try {
        const d = localStorage.getItem('ecoRunnerAccount');
        return d ? JSON.parse(d) : null;
    } catch (e) {
        return null;
    }
}

function setActiveAccount(acc) {
    try {
        if (acc) {
            localStorage.setItem('ecoRunnerAccount', JSON.stringify(acc));
        } else {
            localStorage.removeItem('ecoRunnerAccount');
        }
    } catch (e) {}
}

function isUsernameTaken(username) {
    const list = getAllAccounts();
    return list.some(a => a.username && a.username.trim().toLowerCase() === username.trim().toLowerCase());
}

function updateAccountUI(preferredView) {
    const acc = getActiveAccount();
    const signupContainer = document.getElementById('account-signup-container');
    const loginContainer = document.getElementById('account-login-container');
    const profileContainer = document.getElementById('active-user-profile');
    const titleEl = document.getElementById('account-box-title');
    const closeTabBtn = document.getElementById('close-account-tab-btn');
    const takenNote = document.getElementById('username-taken-note');
    const tickEl = document.getElementById('username-avail-tick');

    if (takenNote) {
        takenNote.classList.add('hidden');
        takenNote.style.display = 'none';
    }
    if (tickEl) {
        tickEl.classList.add('hidden');
    }

    if (acc && acc.realName) {
        STATE.playerName = acc.realName;

        if (signupContainer) signupContainer.classList.add('hidden');
        if (loginContainer) loginContainer.classList.add('hidden');
        if (profileContainer) profileContainer.classList.remove('hidden');
        if (titleEl) titleEl.innerText = 'ACCOUNT PROFILE';
        if (closeTabBtn) closeTabBtn.classList.add('hidden');

        const nameEl = document.getElementById('user-profile-name');
        const tagEl = document.getElementById('user-profile-tag');
        const avatarEl = document.getElementById('user-profile-avatar');
        const lbNameInput = document.getElementById('leaderboard-name-input');

        if (nameEl) nameEl.innerText = acc.realName;
        if (tagEl) tagEl.innerText = `@${acc.username || 'player'}`;
        if (avatarEl) avatarEl.innerText = acc.realName.charAt(0).toUpperCase();
        if (lbNameInput) lbNameInput.value = acc.realName;
    } else {
        if (profileContainer) profileContainer.classList.add('hidden');
        if (closeTabBtn) closeTabBtn.classList.add('hidden');

        if (preferredView === 'signup') {
            if (signupContainer) signupContainer.classList.remove('hidden');
            if (loginContainer) loginContainer.classList.add('hidden');
            if (titleEl) titleEl.innerText = 'CREATE AN ACCOUNT';
        } else {
            if (loginContainer) loginContainer.classList.remove('hidden');
            if (signupContainer) signupContainer.classList.add('hidden');
            if (titleEl) titleEl.innerText = 'LOG IN TO ACCOUNT';
        }
    }
}

// Inline Username Real-Time Availability & Tick Listener
const accountUInput = document.getElementById('account-username');
if (accountUInput) {
    accountUInput.addEventListener('input', () => {
        const val = accountUInput.value.trim();
        const note = document.getElementById('username-taken-note');
        const tickEl = document.getElementById('username-avail-tick');

        if (!val) {
            if (tickEl) tickEl.classList.add('hidden');
            if (note) { note.classList.add('hidden'); note.style.display = 'none'; }
            return;
        }

        if (isUsernameTaken(val)) {
            if (tickEl) tickEl.classList.add('hidden');
            if (note) {
                note.classList.remove('hidden');
                note.style.display = 'block';
            }
        } else {
            if (note) { note.classList.add('hidden'); note.style.display = 'none'; }
            if (tickEl) {
                const wasHidden = tickEl.classList.contains('hidden');
                tickEl.classList.remove('hidden');

                if (wasHidden) {
                    const svg = tickEl.querySelector('.animated-check-svg');
                    if (svg) {
                        svg.style.animation = 'none';
                        svg.offsetHeight; // trigger reflow
                        svg.style.animation = 'drawCheck 0.35s cubic-bezier(0.65, 0, 0.45, 1) forwards';
                    }
                }
            }
        }
    });
}

// Password Eye Toggles
document.querySelectorAll('.toggle-password-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        e.preventDefault();
        const targetId = btn.getAttribute('data-target');
        const input = document.getElementById(targetId);
        if (!input) return;

        const eyeOpen = btn.querySelector('.eye-open');
        const eyeClosed = btn.querySelector('.eye-closed');

        if (input.type === 'password') {
            input.type = 'text';
            if (eyeOpen) eyeOpen.classList.add('hidden');
            if (eyeClosed) eyeClosed.classList.remove('hidden');
        } else {
            input.type = 'password';
            if (eyeOpen) eyeOpen.classList.remove('hidden');
            if (eyeClosed) eyeClosed.classList.add('hidden');
        }
    });
});

// Helper to transition into tutorial & game
let tutorialAnimFrame = null;
function launchTutorialAndGame() {
    UI.startScreen.classList.add('hidden');
    UI.tutorialScreen.classList.remove('hidden');

    let startTime = performance.now();
    const duration = 20000;

    cancelAnimationFrame(tutorialAnimFrame);

    function updateTutTimer(now) {
        let elapsed = now - startTime;
        let progress = elapsed / duration;
        if (progress > 1) progress = 1;

        let offset = 113.1 * (1 - progress);
        UI.tutTimerRing.style.strokeDashoffset = offset;

        if (progress < 1) {
            tutorialAnimFrame = requestAnimationFrame(updateTutTimer);
        } else {
            initGame();
        }
    }
    tutorialAnimFrame = requestAnimationFrame(updateTutTimer);
}

// Sign Up Handler: Creates Account & Syncs Globally
const createAccBtn = document.getElementById('create-account-btn');
if (createAccBtn) {
    createAccBtn.addEventListener('click', async () => {
        const uInput = document.getElementById('account-username');
        const rInput = document.getElementById('account-realname');
        const pInput = document.getElementById('account-password');
        const takenNote = document.getElementById('username-taken-note');

        const username = uInput ? uInput.value.trim() : '';
        const realName = rInput ? rInput.value.trim() : '';
        const password = pInput ? pInput.value : '';

        let valid = true;
        if (!username && uInput) {
            uInput.classList.add('error-shake');
            setTimeout(() => uInput.classList.remove('error-shake'), 400);
            valid = false;
        }
        if (!realName && rInput) {
            rInput.classList.add('error-shake');
            setTimeout(() => rInput.classList.remove('error-shake'), 400);
            valid = false;
        }
        if (!password && pInput) {
            pInput.classList.add('error-shake');
            setTimeout(() => pInput.classList.remove('error-shake'), 400);
            valid = false;
        }

        if (!valid) return;

        // Sync with cloud first to double-check username availability across devices
        await syncCloudDatabase();

        if (isUsernameTaken(username)) {
            if (uInput) {
                uInput.classList.add('error-shake');
                setTimeout(() => uInput.classList.remove('error-shake'), 400);
            }
            if (takenNote) {
                takenNote.classList.remove('hidden');
                takenNote.style.display = 'block';
            }
            showToast('⚠️', 'USERNAME IS ALREADY TAKEN!');
            return;
        }

        const newAcc = { username, realName, password, createdAt: Date.now() };
        let allAccs = getAllAccounts();
        allAccs.push(newAcc);
        saveAllAccounts(allAccs, true); // Save locally & push to global cloud

        const loginUInput = document.getElementById('login-username');
        if (loginUInput) loginUInput.value = username;

        if (uInput) uInput.value = '';
        if (rInput) rInput.value = '';
        if (pInput) pInput.value = '';

        showToast('🎉', 'ACCOUNT CREATED & SYNCED GLOBALLY!');
        updateAccountUI('login');
    });
}

// Login Handler: Authenticates Account across any device
const loginAccBtn = document.getElementById('login-account-btn');
if (loginAccBtn) {
    loginAccBtn.addEventListener('click', async () => {
        const uInput = document.getElementById('login-username');
        const pInput = document.getElementById('login-password');

        const username = uInput ? uInput.value.trim() : '';
        const password = pInput ? pInput.value : '';

        let valid = true;
        if (!username && uInput) {
            uInput.classList.add('error-shake');
            setTimeout(() => uInput.classList.remove('error-shake'), 400);
            valid = false;
        }
        if (!password && pInput) {
            pInput.classList.add('error-shake');
            setTimeout(() => pInput.classList.remove('error-shake'), 400);
            valid = false;
        }

        if (!valid) return;

        let allAccs = getAllAccounts();
        let existing = allAccs.find(a => a.username && a.username.trim().toLowerCase() === username.toLowerCase());

        // If not found locally, sync with global cloud in case account was created on another device
        if (!existing) {
            await syncCloudDatabase();
            allAccs = getAllAccounts();
            existing = allAccs.find(a => a.username && a.username.trim().toLowerCase() === username.toLowerCase());
        }

        if (!existing) {
            if (uInput) {
                uInput.classList.add('error-shake');
                setTimeout(() => uInput.classList.remove('error-shake'), 400);
            }
            showToast('⚠️', 'USERNAME NOT FOUND! PLEASE SIGN UP.');
            return;
        }

        if (existing.password !== password) {
            if (pInput) {
                pInput.classList.add('error-shake');
                setTimeout(() => pInput.classList.remove('error-shake'), 400);
            }
            showToast('❌', 'INCORRECT PASSWORD!');
            return;
        }

        setActiveAccount(existing);
        STATE.playerName = existing.realName;

        if (pInput) pInput.value = '';

        showToast('🔓', `LOGGED IN AS ${existing.realName.toUpperCase()}`);
        updateAccountUI();
    });
}

// Log Out Handler
const logoutAccBtn = document.getElementById('logout-account-btn');
if (logoutAccBtn) {
    logoutAccBtn.addEventListener('click', () => {
        setActiveAccount(null);
        STATE.playerName = '';
        showToast('🔓', 'LOGGED OUT. LOG IN OR CREATE AN ACCOUNT.');
        updateAccountUI('login');
    });
}

// Navigation links between Sign In and Sign Up
const gotoSigninBtn = document.getElementById('goto-signin-btn');
if (gotoSigninBtn) {
    gotoSigninBtn.addEventListener('click', () => {
        updateAccountUI('login');
    });
}

const gotoSignupBtn = document.getElementById('goto-signup-btn');
if (gotoSignupBtn) {
    gotoSignupBtn.addEventListener('click', () => {
        updateAccountUI('signup');
    });
}

// Initial Sync
updateAccountUI('login');

// Play Game Button Handler: Ensures account is logged in before starting game!
document.getElementById('start-btn').addEventListener('click', () => {
    let acc = getActiveAccount();

    if (!acc || !acc.realName) {
        const box = document.querySelector('.account-card-box');
        if (box) {
            box.classList.add('error-shake');
            setTimeout(() => box.classList.remove('error-shake'), 400);
        }
        showToast('⚠️', 'PLEASE CREATE AN ACCOUNT & LOG IN FIRST!');
        return;
    }

    STATE.playerName = acc.realName;
    launchTutorialAndGame();
});

UI.tutCloseBtn.addEventListener('click', () => {
    cancelAnimationFrame(tutorialAnimFrame);
    initGame();
});

document.getElementById('restart-btn').addEventListener('click', () => {
    initGame();
});

document.getElementById('restart-pause-btn').addEventListener('click', () => {
    initGame();
});

document.getElementById('menu-btn').addEventListener('click', () => {
    STATE.screen = 'start';
    UI.gameOverScreen.classList.add('hidden');
    UI.hud.classList.add('hidden');
    UI.startScreen.classList.remove('hidden');
});

document.getElementById('resume-btn').addEventListener('click', () => {
    togglePause();
});

if (UI.pauseBtn) {
    UI.pauseBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        togglePause();
    });
}

// Leaderboard Storage Helpers (Local + Cloud Sync)
function getLeaderboard() {
    try {
        const data = localStorage.getItem('ecoRunnerLeaderboard');
        return data ? JSON.parse(data) : [];
    } catch (e) {
        return [];
    }
}

function saveLeaderboard(lb, triggerPush = true) {
    try {
        localStorage.setItem('ecoRunnerLeaderboard', JSON.stringify(lb));
        if (triggerPush) {
            pushCloudDatabase(getAllAccounts(), lb);
        }
    } catch (e) {}
}

function getGradeColor(g) {
    if (g === 'F') return '#ff3366'; // Red
    if (g === 'D') return '#ff5500'; // Orangish Red
    if (g === 'C') return '#ffaa00'; // Yellow Orange
    if (g === 'B') return '#ffd700'; // Yellow
    if (g === 'A') return '#00ff88'; // Green
    if (g === 'S') return '#00d4ff'; // Blue
    return '#00d4ff';
}

const causeDetails = {
    ad: { emoji: '👗', text: 'Attracted to fast fashion' },
    landfill: { emoji: '🗑️', text: 'Buried under landfill waste' },
    microplastic: { emoji: '🧴', text: 'Clogged by microplastics' },
    powerline: { emoji: '⚡', text: 'Electrocuted by power line' },
    cementKiln: { emoji: '🏭', text: 'Incinerated by cement kiln' }
};

// Sunday Midnight Leaderboard Reset Helper
function getLastSundayMidnight() {
    const d = new Date();
    const day = d.getDay(); // 0 = Sunday, 1 = Monday...
    d.setHours(0, 0, 0, 0); // Reset to 12 Midnight 00:00:00
    d.setDate(d.getDate() - day); // Roll back to current week's Sunday midnight
    return d.getTime();
}

function updateWeeklyResetSubtext() {
    const el = document.getElementById('weekly-reset-subtext');
    if (!el) return;

    const now = new Date();
    const day = now.getDay(); // 0 = Sun, 1 = Mon, 2 = Tue, 3 = Wed, 4 = Thu, 5 = Fri, 6 = Sat
    const daysLeft = (7 - day) % 7;

    if (daysLeft === 0) {
        el.innerText = '⏱️ Resets in 0 days (Tonight at Midnight!)';
    } else if (daysLeft === 1) {
        el.innerText = '⏱️ Resets in 1 day';
    } else {
        el.innerText = `⏱️ Resets in ${daysLeft} days`;
    }
}

function updateLeaderboardUI(highlightEntry) {
    updateWeeklyResetSubtext();
    const listEl = document.getElementById('leaderboard-list');
    if (!listEl) return;

    const lb = getLeaderboard();
    const weekStart = getLastSundayMidnight();

    // Filter entries submitted on or after the most recent Sunday 12 midnight reset
    let filtered = lb.filter(entry => {
        if (!entry.timestamp) return false;
        return entry.timestamp >= weekStart;
    });

    filtered.sort((a, b) => (b.score || 0) - (a.score || 0));
    const topEntries = filtered.slice(0, 10);

    listEl.innerHTML = '';

    if (topEntries.length === 0) {
        listEl.innerHTML = `<div style="text-align:center; color:#8b9bb4; padding:2.5rem 1rem; font-weight:600; font-family:'Outfit',sans-serif;">No scores submitted this week yet!<br>Be the first to claim 1st place! 🏆</div>`;
        return;
    }

    const avatarSolidColors = ['#00d4ff', '#ffaa00', '#00ff88', '#a855f7', '#ff3366', '#ff9900'];

    topEntries.forEach((entry, idx) => {
        const cardWrapper = document.createElement('div');
        cardWrapper.className = 'duo-card-wrapper';

        let isCurrentRun = highlightEntry && entry.score === highlightEntry.score && entry.timestamp === highlightEntry.timestamp;

        let rankDisplay = `${idx + 1}`;
        if (idx === 0) rankDisplay = '🏆';
        else if (idx === 1) rankDisplay = '🥈';
        else if (idx === 2) rankDisplay = '🥉';

        const initial = entry.name ? entry.name.charAt(0).toUpperCase() : 'E';
        const avatarBg = avatarSolidColors[idx % avatarSolidColors.length];
        const deathInfo = causeDetails[entry.reason] || causeDetails['landfill'];

        const distVal = entry.distance !== undefined ? entry.distance : Math.floor(entry.score * 0.75);
        const clothesVal = entry.clothes || 0;

        cardWrapper.innerHTML = `
            <div class="duo-player-row ${isCurrentRun ? 'highlight-run' : ''}">
                <div class="duo-rank-badge">${rankDisplay}</div>
                <div class="duo-avatar" style="background: ${avatarBg}; color: #0d0f14;">${initial}</div>
                <div class="duo-player-info">
                    <div class="duo-player-name">
                        ${entry.name}
                        ${isCurrentRun ? '<span class="duo-you-badge">YOU</span>' : ''}
                    </div>
                </div>
                <div class="duo-score-box">
                    <span class="duo-score-num">${entry.score.toLocaleString()}</span>
                </div>
            </div>
            <div class="duo-death-drawer">
                <div class="death-cause-box">
                    <span class="death-emoji">${deathInfo.emoji}</span>
                    <span class="death-text">${deathInfo.text}</span>
                </div>
                <div class="drawer-stats-group">
                    <span class="death-stat-pill">📏 ${distVal.toLocaleString()}m</span>
                    <span class="death-stat-pill">👕 ${clothesVal.toLocaleString()} clothes</span>
                </div>
            </div>
        `;

        const rowEl = cardWrapper.querySelector('.duo-player-row');
        const drawerEl = cardWrapper.querySelector('.duo-death-drawer');

        rowEl.addEventListener('click', () => {
            const isCurrentlyExpanded = drawerEl.classList.contains('expanded');

            // Close any currently open drawers on the leaderboard
            document.querySelectorAll('.duo-death-drawer.expanded').forEach(openDrawer => {
                openDrawer.classList.remove('expanded');
            });

            // Toggle clicked drawer
            if (!isCurrentlyExpanded) {
                drawerEl.classList.add('expanded');
            }
        });

        if (idx === 3) {
            const shoutoutDivider = document.createElement('div');
            shoutoutDivider.className = 'lb-shoutout-divider';
            shoutoutDivider.innerHTML = `
                <div class="shoutout-line"></div>
                <span class="shoutout-text">SHOUT OUT ZONE</span>
                <div class="shoutout-line"></div>
            `;
            listEl.appendChild(shoutoutDivider);
        }

        listEl.appendChild(cardWrapper);

        if (idx === 2 && topEntries.length === 3) {
            const shoutoutDivider = document.createElement('div');
            shoutoutDivider.className = 'lb-shoutout-divider';
            shoutoutDivider.innerHTML = `
                <div class="shoutout-line"></div>
                <span class="shoutout-text">SHOUT OUT ZONE</span>
                <div class="shoutout-line"></div>
            `;
            listEl.appendChild(shoutoutDivider);
        }
    });
}

const submitLbBtn = document.getElementById('submit-leaderboard-btn');
if (submitLbBtn) {
    submitLbBtn.addEventListener('click', () => {
        if (currentRunSubmitted) return;

        const activeAcc = getActiveAccount();
        const enteredName = (activeAcc && activeAcc.realName) ? activeAcc.realName : (STATE.playerName || 'EcoSurfer');
        STATE.playerName = enteredName;
        const score = Math.floor(STATE.score);
        const distance = Math.floor(STATE.distance);
        const grade = document.getElementById('eco-grade').innerText;
        const reason = STATE.lastDeathReason || 'landfill';
        const timestamp = Date.now();

        const newEntry = { name: enteredName, score, clothes: STATE.ecoScore, distance, grade, reason, timestamp };

        let lb = getLeaderboard();
        const existingIdx = lb.findIndex(item => item.name && item.name.trim().toLowerCase() === enteredName.toLowerCase());

        if (existingIdx !== -1) {
            if (newEntry.score >= lb[existingIdx].score) {
                lb[existingIdx] = newEntry;
            } else {
                lb[existingIdx].timestamp = timestamp;
            }
        } else {
            lb.push(newEntry);
        }

        saveLeaderboard(lb, true); // Local save + instant global cloud push

        currentRunSubmitted = true;

        submitLbBtn.innerHTML = '✅ SUBMITTED TO LEADERBOARD! 🌟';
        submitLbBtn.disabled = true;

        showToast('🏆', 'SCORE SYNCED TO GLOBAL LEADERBOARD!');
        updateLeaderboardUI(newEntry);
        document.getElementById('leaderboard-modal').classList.remove('hidden');
    });
}

const closeLbBtn = document.getElementById('close-leaderboard-btn');
if (closeLbBtn) {
    closeLbBtn.addEventListener('click', () => {
        document.getElementById('leaderboard-modal').classList.add('hidden');
    });
}

const closeLbActionsBtn = document.getElementById('close-leaderboard-actions-btn');
if (closeLbActionsBtn) {
    closeLbActionsBtn.addEventListener('click', () => {
        document.getElementById('leaderboard-modal').classList.add('hidden');
    });
}

const startLbBtn = document.getElementById('view-leaderboard-start-btn');
if (startLbBtn) {
    startLbBtn.addEventListener('click', () => {
        syncCloudDatabase();
        updateLeaderboardUI();
        document.getElementById('leaderboard-modal').classList.remove('hidden');
    });
}

// Launch initial cloud synchronization & background sync loop
syncCloudDatabase();
setInterval(syncCloudDatabase, 8000);

document.getElementById('sound-btn').addEventListener('click', (e) => {
    STATE.audioEnabled = !STATE.audioEnabled;
    const btn = e.currentTarget;
    if (STATE.audioEnabled) {
        btn.innerHTML = '<span id="sound-icon">🔊</span> Sound: ON';
        initAudio();
    } else {
        btn.innerHTML = '<span id="sound-icon">🔇</span> Sound: OFF';
    }
});

// Initial draw to show background before start
ctx.fillStyle = '#111';
ctx.fillRect(0, 0, CONFIG.canvasWidth, CONFIG.canvasHeight);

// Eco Impact Card Canvas Renderer (Sleek EcoSurfer Green Box Style)
function generateEcoImpactCardCanvas() {
    const canvas = document.createElement('canvas');
    canvas.width = 600;
    canvas.height = 640;
    const c = canvas.getContext('2d');

    // Polyfill roundRect for older canvas contexts
    if (!c.roundRect) {
        c.roundRect = function (x, y, w, h, r) {
            let radius = typeof r === 'number' ? r : 12;
            c.beginPath();
            c.moveTo(x + radius, y);
            c.lineTo(x + w - radius, y);
            c.quadraticCurveTo(x + w, y, x + w, y + radius);
            c.lineTo(x + w, y + h - radius);
            c.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
            c.lineTo(x + radius, y + h);
            c.quadraticCurveTo(x, y + h, x, y + h - radius);
            c.lineTo(x, y + radius);
            c.quadraticCurveTo(x, y, x + radius, y);
            c.closePath();
        };
    }

    const acc = getActiveAccount();
    const playerName = (acc && acc.realName) ? acc.realName : (STATE.playerName || 'EcoSurfer Player');
    const scoreVal = Math.floor(STATE.score);
    const distVal = Math.floor(STATE.distance);
    const landfillsVal = (STATE.ecoScore * 0.5).toFixed(1);
    const microplasticsVal = (STATE.ecoScore * 25);

    // 1. Clean Dark Background
    c.fillStyle = '#0b131f';
    c.fillRect(0, 0, 600, 640);

    // 2. Main EcoSurfer Green Impact Box (Matching in-game .eco-impact-box)
    c.fillStyle = 'rgba(0, 255, 136, 0.08)';
    c.beginPath();
    c.roundRect(30, 30, 540, 480, 16);
    c.fill();
    c.strokeStyle = 'rgba(0, 255, 136, 0.35)';
    c.lineWidth = 2;
    c.stroke();

    // Box Header
    c.textAlign = 'center';
    c.fillStyle = '#00ff88';
    c.font = '800 24px "Space Grotesk", sans-serif';
    c.fillText('🌍 YOUR ECO IMPACT', 300, 75);

    // Player Greeting Message
    c.fillStyle = '#ffffff';
    c.font = '700 20px "Space Grotesk", sans-serif';
    c.fillText(`Great job, ${playerName}!`, 300, 115);

    c.fillStyle = 'rgba(255, 255, 255, 0.7)';
    c.font = '600 15px "Space Grotesk", sans-serif';
    c.fillText("Here's what you achieved in this run:", 300, 142);

    // Stats List
    const items = [
        { label: '⭐ Score Achieved:', val: scoreVal.toLocaleString() },
        { label: '📏 Distance Traveled:', val: `${distVal.toLocaleString()}m` },
        { label: '🗑️ Landfills Diverted:', val: `${landfillsVal} kg` },
        { label: '🧴 Microplastics Prevented:', val: `${microplasticsVal} g` }
    ];

    let startY = 175;
    items.forEach((item) => {
        c.fillStyle = 'rgba(0, 0, 0, 0.35)';
        c.beginPath();
        c.roundRect(55, startY, 490, 56, 10);
        c.fill();
        c.strokeStyle = 'rgba(255, 255, 255, 0.08)';
        c.lineWidth = 1;
        c.stroke();

        // Label
        c.textAlign = 'left';
        c.fillStyle = '#e2ebf0';
        c.font = '600 17px "Space Grotesk", sans-serif';
        c.fillText(item.label, 75, startY + 34);

        // Value in EcoSurfer Green
        c.textAlign = 'right';
        c.fillStyle = '#00ff88';
        c.font = '800 20px "Space Grotesk", sans-serif';
        c.fillText(item.val, 525, startY + 34);

        startY += 72;
    });

    // 3. Simple Drafted Footer
    c.textAlign = 'center';
    c.fillStyle = '#ffffff';
    c.font = '700 16px "Space Grotesk", sans-serif';
    c.fillText('Check out this game developed by Project Evāra!', 300, 550);

    c.fillStyle = 'rgba(255, 255, 255, 0.8)';
    c.font = '600 14px "Space Grotesk", sans-serif';
    c.fillText('Beat the high scores and get featured on their Instagram Page!', 300, 578);

    c.fillStyle = '#00ff88';
    c.font = '800 17px "Space Grotesk", sans-serif';
    c.fillText('#ProjectEvāra', 300, 608);

    return canvas;
}

// Top Corner Download Impact PNG Handler
const downloadImpactBtn = document.getElementById('download-impact-btn');
if (downloadImpactBtn) {
    downloadImpactBtn.addEventListener('click', () => {
        const canvas = generateEcoImpactCardCanvas();
        const acc = getActiveAccount();
        const pName = (acc && acc.realName) ? acc.realName : (STATE.playerName || 'Player');
        const filename = `EcoSurfer_Impact_${pName.replace(/\s+/g, '_')}.png`;

        const link = document.createElement('a');
        link.download = filename;
        link.href = canvas.toDataURL('image/png');
        link.click();

        showToast('📥', 'ECO IMPACT PNG DOWNLOADED!');
    });
}

// Share Button Handler with Drafted Text & PNG Image Attachment
const shareBtn = document.getElementById('share-btn');
if (shareBtn) {
    shareBtn.addEventListener('click', async () => {
        const draftText = `Check out this game developed by Project Evāra!\nBeat the high scores and get featured on their Instagram Page!\n#ProjectEvāra`;
        const canvas = generateEcoImpactCardCanvas();
        const acc = getActiveAccount();
        const pName = (acc && acc.realName) ? acc.realName : (STATE.playerName || 'Player');
        const filename = `EcoSurfer_Impact_${pName.replace(/\s+/g, '_')}.png`;

        canvas.toBlob(async (blob) => {
            if (!blob) return;
            const file = new File([blob], filename, { type: 'image/png' });

            if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
                try {
                    await navigator.share({
                        title: 'EcoSurfer Impact - Project Evāra',
                        text: draftText,
                        files: [file]
                    });
                    showToast('🎉', 'SHARED SUCCESSFULLY!');
                    return;
                } catch (err) {
                    console.log('Share error/canceled:', err);
                }
            }

            // Fallback: Download PNG & copy drafted text to clipboard
            const link = document.createElement('a');
            link.download = filename;
            link.href = canvas.toDataURL('image/png');
            link.click();

            try {
                await navigator.clipboard.writeText(draftText);
                showToast('📋', 'PNG DOWNLOADED & TEXT COPIED!');
            } catch (err) {
                showToast('📥', 'PNG CARD DOWNLOADED!');
            }
        }, 'image/png');
    });
}

// Powerup Popup Logic
const popup = document.getElementById('powerup-popup');
const popupTitle = popup.querySelector('.popup-title');
const popupDesc = popup.querySelector('.popup-desc');
const popupTimer = popup.querySelector('.popup-timer-line');
const popupClose = popup.querySelector('.popup-close-btn');
const pills = document.querySelectorAll('.powerup-pills .pill');

let popupState = {
    isClicked: false,
    timer: null
};

function closePopup() {
    popupState.isClicked = false;
    popup.classList.remove('active');
    popupTimer.classList.remove('timer-active');
    popupClose.classList.remove('visible');
    clearTimeout(popupState.timer);
}

popupClose.addEventListener('click', (e) => {
    e.stopPropagation();
    closePopup();
});

pills.forEach(pill => {
    pill.addEventListener('mouseenter', () => {
        if (popupState.isClicked) return;

        popupTitle.innerText = pill.getAttribute('data-title');
        popupDesc.innerText = pill.getAttribute('data-desc');
        popup.classList.add('active');
        popupTimer.classList.remove('timer-active');
        popupClose.classList.remove('visible');
    });

    pill.addEventListener('mouseleave', () => {
        if (popupState.isClicked) return;
        popup.classList.remove('active');
    });

    pill.addEventListener('click', () => {
        // Reset everything for a fresh click
        clearTimeout(popupState.timer);
        popupTimer.classList.remove('timer-active');

        // Force reflow to restart CSS animation
        void popupTimer.offsetWidth;

        popupState.isClicked = true;
        popupTitle.innerText = pill.getAttribute('data-title');
        popupDesc.innerText = pill.getAttribute('data-desc');

        popup.classList.add('active');
        popupTimer.classList.add('timer-active');
        popupClose.classList.add('visible');

        popupState.timer = setTimeout(() => {
            closePopup();
        }, 7000);
    });
});

// Level Up Listeners
function runLevelCountdown(callback) {
    if (devTimerId) clearInterval(devTimerId);
    let count = 3;
    UI.devCountdownText.innerText = count;
    UI.devCountdownText.classList.remove('pop-anim');
    void UI.devCountdownText.offsetWidth;
    UI.devCountdownText.classList.add('pop-anim');
    UI.devTimerScreen.classList.remove('hidden');

    devTimerId = setInterval(() => {
        count--;
        if (count > 0) {
            UI.devCountdownText.innerText = count;
            UI.devCountdownText.classList.remove('pop-anim');
            void UI.devCountdownText.offsetWidth;
            UI.devCountdownText.classList.add('pop-anim');
        } else {
            clearInterval(devTimerId);
            devTimerId = null;
            UI.devTimerScreen.classList.add('hidden');
            callback();
        }
    }, 1000);
}

document.getElementById('proceed-level-btn').addEventListener('click', () => {
    clearInterval(STATE.warningInterval);
    window.speechSynthesis.cancel();
    UI.levelUpScreen.classList.add('hidden');
    runLevelCountdown(() => {
        STATE.level = 2;
        STATE.screen = 'playing';
        CONFIG.baseSpeed += 200;
        CONFIG.speedCap += 300;
        STATE.lastTime = performance.now();
        gameLoopId = requestAnimationFrame(gameLoop);
    });
});

document.getElementById('quit-level-btn').addEventListener('click', () => {
    clearInterval(STATE.warningInterval);
    window.speechSynthesis.cancel();
    UI.levelUpScreen.classList.add('hidden');
    gameOver('cementKiln'); // Cement kiln defeat line when quitting at Level 2 transition
});

// Level 3 Listeners
document.getElementById('quit-level3-btn').addEventListener('click', () => {
    UI.level3Screen.classList.add('hidden');
    gameOver('landfill'); // Default or specific reason
});

document.querySelectorAll('.sacrifice-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        let powerupType = btn.getAttribute('data-powerup');
        STATE.sacrificedPowerup = powerupType;

        UI.level3Screen.classList.add('hidden');
        runLevelCountdown(() => {
            STATE.level = 3;
            STATE.screen = 'playing';
            CONFIG.baseSpeed += 250; // Gets even faster
            CONFIG.speedCap += 300;

            // Remove powerup from current active state if player happens to have it
            if (player.powerups[powerupType]) {
                delete player.powerups[powerupType];
                updatePowerupUI();
            }

            STATE.lastTime = performance.now();
            gameLoopId = requestAnimationFrame(gameLoop);
        });
    });
});

const winBtn = document.getElementById('win-menu-btn');
if (winBtn) {
    winBtn.addEventListener('click', () => {
        UI.winScreen.classList.add('hidden');
        STATE.screen = 'start';
        UI.startScreen.classList.remove('hidden');
        cancelAnimationFrame(gameLoopId);
    });
}

const level4Proceed = document.getElementById('level4-proceed-btn');
if (level4Proceed) {
    level4Proceed.addEventListener('click', () => {
        if (level4TimerId) {
            clearInterval(level4TimerId);
            level4TimerId = null;
        }
        UI.level4Screen.classList.add('hidden');
        runLevelCountdown(() => {
            STATE.screen = 'playing';
            STATE.level = 4;

            let newBaseSpeed = Math.min(950, Math.max(850, Math.round(STATE.speed + 50)));
            CONFIG.baseSpeed = newBaseSpeed;
            CONFIG.speedCap = Math.min(1150, newBaseSpeed + 200);
            STATE.speed = CONFIG.baseSpeed;

            STATE.lastTime = performance.now();
            cancelAnimationFrame(gameLoopId);
            gameLoopId = requestAnimationFrame(gameLoop);
        });
    });
}

let level4TimerId = null;

function startLevel4Countdown() {
    let timeLeft = 15;

    // Clear any existing just in case
    if (level4TimerId) clearInterval(level4TimerId);

    level4TimerId = setInterval(() => {
        timeLeft--;
        if (timeLeft <= 0) {
            document.getElementById('level4-proceed-btn').click();
        }
    }, 1000);
}

let devTimerId = null;

// Developer Shortcut
function activateDevShortcut() {
    // Hide active screens
    UI.startScreen.classList.add('hidden');
    UI.tutorialScreen.classList.add('hidden');
    UI.pauseScreen.classList.add('hidden');
    UI.levelUpScreen.classList.add('hidden');
    UI.level3Screen.classList.add('hidden');
    UI.level4Screen.classList.add('hidden');
    UI.gameOverScreen.classList.add('hidden');
    UI.deathTransitionScreen.classList.add('hidden');
    UI.devTimerScreen.classList.add('hidden');

    clearInterval(STATE.warningInterval);
    if (window.speechSynthesis) window.speechSynthesis.cancel();

    STATE.screen = 'playing';
    STATE.level = 3;
    STATE.maxLevelReached = 3;
    STATE.score = 15000; // Arbitrary score 
    STATE.ecoScore = 174; // One cloth away from level 4

    STATE.lastTime = performance.now();
    gameLoop(STATE.lastTime); // Instantly hits the Win condition in gameLoop
}

// Confetti logic
function createConfetti() {
    const colors = ['#00ff88', '#00d4ff', '#ff3366', '#ffaa00', '#ffffff'];
    for (let i = 0; i < 80; i++) {
        let conf = document.createElement('div');
        conf.className = 'confetti';
        conf.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];

        // Randomly choose left or right side
        const isLeft = Math.random() > 0.5;
        conf.style.left = isLeft ? '-10px' : '100vw';
        conf.style.top = (Math.random() * 50 + 20) + 'vh'; // Shoot from middle height

        document.body.appendChild(conf);

        const angle = isLeft ? (Math.random() * 45 - 20) : (Math.random() * -45 + 20);
        const velocity = Math.random() * 600 + 400;
        const vx = Math.cos(angle * Math.PI / 180) * velocity * (isLeft ? 1 : -1);
        const vy = Math.sin(angle * Math.PI / 180) * velocity - 500; // Shoot upward

        let startTime = performance.now();
        function animateConfetti(time) {
            let t = (time - startTime) / 1000;
            if (t > 4) { conf.remove(); return; } // remove after 4 seconds

            let currentX = vx * t;
            let currentY = vy * t + 0.5 * 1000 * t * t; // gravity
            let rotation = t * 360 * 2;

            conf.style.transform = `translate(${currentX}px, ${currentY}px) rotate(${rotation}deg)`;
            requestAnimationFrame(animateConfetti);
        }
        requestAnimationFrame(animateConfetti);
    }
}
