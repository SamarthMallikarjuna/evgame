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
    score: 0,
    multiplier: 1,
    distance: 0,
    ecoScore: 0,
    sacrificedPowerup: null,
    speed: CONFIG.baseSpeed,
    lastTime: 0,
    deltaTime: 0,
    audioEnabled: true,
    playerName: ''
};

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
    
    switch(type) {
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
    if(STATE.screen !== 'playing') return;
    if(e.repeat) return;
    if(e.key === 'ArrowLeft' || e.key === 'a') { player.switchLane(-1); }
    if(e.key === 'ArrowRight' || e.key === 'd') { player.switchLane(1); }
    if (e.key === ' ' || e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') { player.jump(); }
    if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') { Input.down = true; player.slide(); }
    
    // Developer Shortcut
    if (e.key.toLowerCase() === 'r') {
        activateDevShortcut();
    }
    
    if(e.key === 'Escape' || e.key === 'p') { togglePause(); }
});

window.addEventListener('keyup', (e) => {
    if(STATE.screen !== 'playing') return;
    if(e.key === 'ArrowDown' || e.key === 's') { 
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
}, {passive: true});

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
}, {passive: true});

canvas.addEventListener('touchend', e => {
    if(STATE.screen !== 'playing') return;
    if(touchState.isSlide) {
        player.stopSlide();
    }
}, {passive: true});

// HUD Elements
const UI = {
    score: document.getElementById('score-val'),
    multiplier: document.getElementById('multiplier-val'),
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
                    updatePowerupUI();
                    if(p === 'zeroWaste') document.getElementById('game-container').classList.remove('zero-waste-glow');
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
        ctx.ellipse(0, this.height/2 - this.z, this.width/2, this.width/4, 0, 0, Math.PI*2);
        ctx.fill();

        // Aura
        if (this.hasPowerup('zeroWaste')) {
            ctx.shadowColor = '#00ff88';
            ctx.shadowBlur = 20;
        }

        // Body
        let img = this.state === 'slide' ? playerImgSlide : playerImgStand;
        
        // The images are roughly square, so we'll draw them wider than the hitbox
        let imgW = 90;
        let imgH = 90;
        let imgYOff = this.state === 'slide' ? 10 : -10; // offset down if sliding
        
        // Character drawing
        if (img.complete) {
            ctx.drawImage(img, -imgW/2, -this.height/2 + imgYOff, imgW, imgH);
            
            // Zero-waste aura is drawn as a glowing shadow behind the robot
        } else {
            // Fallback before image loads
            let h = this.state === 'slide' ? this.height/2 : this.height;
            let yOff = this.state === 'slide' ? this.height/2 : 0;
            ctx.fillStyle = this.hasPowerup('zeroWaste') ? '#00ff88' : '#fff';
            ctx.beginPath();
            ctx.roundRect(-this.width/2, -this.height/2 + yOff, this.width, h, 20);
            ctx.fill();
        }
        
        if (this.hasPowerup('thriftShield')) {
            ctx.strokeStyle = '#00d4ff';
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.arc(0, -this.height/2 + imgYOff + imgH/2, imgH/2 + 5, 0, Math.PI*2);
            ctx.stroke();
        }

        ctx.restore();
    }

    hasPowerup(type) {
        return this.powerups[type] !== undefined;
    }

    activatePowerup(type) {
        const pData = CONFIG.powerupDurations[type];
        this.powerups[type] = pData;
        playSound('powerup');
        updatePowerupUI();
        
        if(type === 'repairKit') showToast('🪡', "FIX IT. DON'T BIN IT.");
        if(type === 'circularBoost') showToast('🧲', "MAGNET ACTIVATED");
        if(type === 'thriftShield') showToast('🛡️', "SHIELD EQUIPPED");
        if(type === 'upcycleCutter') {
            showToast('✂️', "UPCYCLE WAVE!");
            spawnUpcycleWave();
        }
        if(type === 'zeroWaste') {
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
            if (subtype === 'landfill') { this.zHeight = 40; this.width=70; this.height=70; } // Ground
            if (subtype === 'microplastic') { this.zHeight = 5; this.width=80; this.height=80; } // Ground
            if (subtype === 'ad') { this.zBase = 60; this.zHeight = 120; this.width=80; this.height=20; } // High
            if (subtype === 'powerline') { this.zBase = 60; this.zHeight = 80; this.width=140; this.height=20; } // High, spans lanes
            if (subtype === 'cementKiln') { this.zHeight = 40; this.width=75; this.height=75; } // Solid red square
        }
    }

    update(dt) {
        this.y += STATE.speed * dt;
        
        // Circular Boost (Magnet) Logic
        if (player.hasPowerup('circularBoost') && (this.type === 'collectable' || this.type === 'powerup')) {
            const dy = player.y - this.y;
            const dx = player.x - this.x;
            const dist = Math.sqrt(dx*dx + dy*dy);
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
                    ctx.moveTo(-this.width/2, this.height/2);
                    ctx.lineTo(0, -this.height/2);
                    ctx.lineTo(this.width/2, this.height/2);
                    ctx.fill();
                }
                else if (this.subtype === 'microplastic') {
                    ctx.fillStyle = 'rgba(0, 100, 255, 0.5)';
                    ctx.beginPath();
                    ctx.ellipse(0, 0, this.width/2, this.height/4, 0, 0, Math.PI*2);
                    ctx.fill();
                }
                else if (this.subtype === 'ad') {
                    ctx.fillStyle = '#ff3366'; // neon pink
                    ctx.fillRect(-this.width/2, -this.height/2, this.width, this.height);
                    ctx.shadowColor = '#ff3366';
                    ctx.shadowBlur = 10;
                    ctx.fillStyle = '#fff';
                    ctx.font = '10px Arial';
                    ctx.textAlign = 'center';
                    ctx.fillText("BUY NOW", 0, 3);
                }
                else if (this.subtype === 'powerline') {
                    ctx.fillStyle = '#222';
                    ctx.fillRect(-this.width/2, -this.height/2, this.width, this.height);
                    ctx.fillStyle = '#ffaa00'; // warning stripes
                    for(let i=-this.width/2; i<this.width/2; i+=20) {
                        ctx.fillRect(i, -this.height/2, 10, this.height);
                    }
                }
                else if (this.subtype === 'cementKiln') {
                    ctx.fillStyle = '#ff0000'; // Simple red square
                    ctx.fillRect(-this.width/2, -this.height/2, this.width, this.height);
                }
            }
        }
        else if (this.type === 'powerup') {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
            ctx.beginPath();
            ctx.arc(0, 0, 30, 0, Math.PI*2);
            ctx.fill();
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 2;
            ctx.stroke();
            
            let icon = '❓';
            if(this.subtype === 'repairKit') icon = '🪡';
            if(this.subtype === 'circularBoost') icon = '🧲';
            if(this.subtype === 'thriftShield') icon = '🛡️';
            if(this.subtype === 'upcycleCutter') icon = '✂️';
            if(this.subtype === 'zeroWaste') icon = '🌱';
            
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
        ctx.arc(this.x, this.y, 4, 0, Math.PI*2);
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
    playSound('roboticDeath');
    UI.hud.classList.add('hidden');
    
    let reasonText = "LANDFILL OVERFLOW!";
    if(reason === 'landfill') reasonText = "BURIED WITH THE CLOTHES";
    if(reason === 'microplastic') reasonText = "CLOGGED BY PLASTIC";
    if(reason === 'ad') reasonText = "ATTRACTED BY FAST FASHION";
    if(reason === 'powerline') reasonText = "SYSTEM ELECTROCUTED";
    if(reason === 'cementKiln') reasonText = "COMPONENTS INCINERATED";
    
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
    
    document.getElementById('impact-landfills').innerText = (STATE.ecoScore * 0.5).toFixed(1) + ' kg';
    document.getElementById('impact-microplastics').innerText = (STATE.ecoScore * 25) + ' g';
    
    let grade = 'C';
    let sub = "Eco-Beginner";
    if(STATE.score > 1000) { grade = 'B'; sub = "Thrift Shopper"; }
    if(STATE.score > 3000) { grade = 'A'; sub = "Sustainability Hero"; }
    if(STATE.score > 6000) { grade = 'S'; sub = "Master Circular Fashionista"; }
    
    document.getElementById('eco-grade').innerText = grade;
    document.getElementById('eco-grade-subtitle').innerText = sub;
    
    document.getElementById('player-name-display').innerHTML = `Great job, <span>${STATE.playerName}</span>! Here's what you achieved:`;
}

function togglePause() {
    if (STATE.screen === 'playing') {
        STATE.screen = 'paused';
        UI.pauseScreen.classList.remove('hidden');
    } else if (STATE.screen === 'paused') {
        STATE.screen = 'playing';
        UI.pauseScreen.classList.add('hidden');
        STATE.lastTime = performance.now();
        gameLoopId = requestAnimationFrame(gameLoop);
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
        let type = types[Math.floor(Math.random()*types.length)];
        entities.push(new Entity(Math.floor(Math.random()*3), 'powerup', type));
    } else if (pattern < 0.6) {
        // Scattered collectables (one per lane, staggered along the run)
        let availableLanes = [0, 1, 2].sort(() => Math.random() - 0.5);
        for(let i=0; i<3; i++) {
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
        if(obsType > 0.4) sub = 'microplastic';
        if(obsType > 0.7) sub = 'ad';
        if(obsType > 0.9) sub = 'powerline';
        if(STATE.level >= 2 && Math.random() > 0.7) sub = 'cementKiln'; // Level 2 adds cement kilns
        
        let lane1 = Math.floor(Math.random()*3);
        entities.push(new Entity(lane1, 'obstacle', sub));
        
        // Sometimes spawn 2 obstacles blocking lanes
        if (Math.random() > 0.5 && sub !== 'powerline') {
            let lane2 = (lane1 + 1 + Math.floor(Math.random()*2)) % 3;
            entities.push(new Entity(lane2, 'obstacle', sub));
        }
    }
}

function checkCollisions() {
    // Player hitboxes based on state
    let pZBottom = player.z; // jump moves this negative (up)
    let pZTop = pZBottom - (player.state === 'slide' ? player.height/2 : player.height); // pseudo 3D top height
    
    let pRect = {
        left: player.x - player.width/2 + 10,
        right: player.x + player.width/2 - 10,
        top: player.y - player.height/2 + 10,
        bottom: player.y + player.height/2 - 10
    };

    entities.forEach(ent => {
        if (!ent.active) return;

        let eRect = {
            left: ent.x - ent.width/2,
            right: ent.x + ent.width/2,
            top: ent.y - ent.height/2,
            bottom: ent.y + ent.height/2
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
    for(let i=0; i<count; i++) {
        particles.push(new Particle(x, y, color));
    }
}

function updatePowerupUI() {
    UI.powerupBar.innerHTML = '';
    for(let p in player.powerups) {
        let max = CONFIG.powerupDurations[p];
        if (max === -1) {
            UI.powerupBar.innerHTML += `<div class="powerup-indicator"><div class="p-icon">🛡️</div><div class="p-label" style="color:white;font-size:12px;font-weight:bold;">ACTIVE</div></div>`;
            continue;
        }
        let cur = player.powerups[p];
        let pct = (cur / max) * 100;
        let icon = '❓';
        if(p === 'repairKit') icon = '🪡';
        if(p === 'circularBoost') icon = '🧲';
        if(p === 'upcycleCutter') icon = '✂️';
        if(p === 'zeroWaste') icon = '🌱';
        
        UI.powerupBar.innerHTML += `<div class="powerup-indicator"><div class="p-icon">${icon}</div><div class="p-timer"><div class="p-fill" style="width:${pct}%"></div></div></div>`;
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
        playSound('levelUpWarning');
        speakWarning();
        STATE.warningInterval = setInterval(() => {
            playSound('levelUpWarning');
            speakWarning();
        }, 2000);
        UI.levelUpScreen.classList.remove('hidden');
        return;
    }
    
    // Check level 3 transition
    if (STATE.ecoScore >= 100 && STATE.level === 2) {
        STATE.screen = 'level3';
        playSound('levelUpWarning'); // Use same warning or new one
        UI.level3Screen.classList.remove('hidden');
        return;
    }
    
    // Check Level 4 transition (Endless Mode trigger)
    if (STATE.ecoScore >= 175 && STATE.level === 3) {
        STATE.screen = 'level4';
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
    let sortedEntities = entities.slice().sort((a,b) => a.y - b.y);
    
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
    UI.multiplier.innerText = curMult + 'x';
    
    // Continually update powerup UI bars
    if(Object.keys(player.powerups).length > 0) updatePowerupUI();

    gameLoopId = requestAnimationFrame(gameLoop);
}

// Bind Buttons
let tutorialAnimFrame = null;

document.getElementById('start-btn').addEventListener('click', () => {
    const inputEl = document.getElementById('player-name-input');
    const nameInput = inputEl.value.trim();
    
    if (!nameInput) {
        inputEl.classList.add('error-shake');
        setTimeout(() => inputEl.classList.remove('error-shake'), 400);
        return; // Don't start game if name is empty
    }
    
    STATE.playerName = nameInput;

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

document.getElementById('share-btn').addEventListener('click', async () => {
    const score = Math.floor(STATE.score);
    const landfills = (STATE.ecoScore * 0.5).toFixed(1);
    const textToShare = `I just scored ${score} and diverted ${landfills} kg of textile waste in EcoSurfer! 🌍👕\n\nPlay now and tag @projectevara26! 🌱`;
    
    if (navigator.share) {
        try {
            await navigator.share({
                title: 'EcoSurfer Impact',
                text: textToShare
            });
        } catch (err) {
            console.log('Error sharing:', err);
        }
    } else {
        // Fallback if Web Share API is not supported
        try {
            await navigator.clipboard.writeText(textToShare);
            showToast('📋', 'COPIED FOR YOUR STORY!');
        } catch (err) {
            showToast('❌', 'FAILED TO COPY');
        }
    }
});

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
document.getElementById('proceed-level-btn').addEventListener('click', () => {
    clearInterval(STATE.warningInterval);
    window.speechSynthesis.cancel();
    STATE.level = 2;
    STATE.screen = 'playing';
    CONFIG.baseSpeed += 200;
    CONFIG.speedCap += 300;
    UI.levelUpScreen.classList.add('hidden');
    STATE.lastTime = performance.now();
    gameLoopId = requestAnimationFrame(gameLoop);
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
        STATE.level = 3;
        STATE.screen = 'playing';
        CONFIG.baseSpeed += 250; // Gets even faster
        CONFIG.speedCap += 300;
        
        // Remove powerup from current active state if player happens to have it
        if (player.powerups[powerupType]) {
            delete player.powerups[powerupType];
            updatePowerupUI();
        }
        
        UI.level3Screen.classList.add('hidden');
        STATE.lastTime = performance.now();
        gameLoopId = requestAnimationFrame(gameLoop);
    });
});

document.getElementById('win-menu-btn').addEventListener('click', () => {
    UI.winScreen.classList.add('hidden');
    STATE.screen = 'start';
    UI.startScreen.classList.remove('hidden');
    cancelAnimationFrame(gameLoopId);
});

document.getElementById('level4-proceed-btn').addEventListener('click', () => {
    if (level4TimerId) {
        clearInterval(level4TimerId);
        level4TimerId = null;
    }
    UI.level4Screen.classList.add('hidden');
    STATE.screen = 'playing';
    STATE.level = 4;
    
    CONFIG.baseSpeed = 850;
    CONFIG.speedCap = 1600;
    STATE.speed = CONFIG.baseSpeed;
    
    STATE.lastTime = performance.now();
    gameLoopId = requestAnimationFrame(gameLoop);
});

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
    if(window.speechSynthesis) window.speechSynthesis.cancel();
    
    STATE.screen = 'playing'; 
    STATE.level = 3;
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
        const vx = Math.cos(angle * Math.PI/180) * velocity * (isLeft ? 1 : -1);
        const vy = Math.sin(angle * Math.PI/180) * velocity - 500; // Shoot upward
        
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
