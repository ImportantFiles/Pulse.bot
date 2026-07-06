/**
 * Pulse.bot interactive background.
 *
 * Self-contained canvas animation: drifting data nodes with neural-network
 * style connections, an animated grid, scan lines, mouse reactivity, click
 * pulses, idle ambience, and a hidden "Pulse Mode" easter egg.
 *
 * Isolated from script.js on purpose — this module never touches OCR state,
 * form state, or calculations, and degrades itself (or turns off) rather
 * than risk slowing the rest of the app down.
 */
(() => {
  "use strict";

  const canvas = document.getElementById("bgCanvas");
  if (!canvas || !canvas.getContext) return;

  const ctx = canvas.getContext("2d", { alpha: true });
  const reduceMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

  const COLORS = {
    cyan: [94, 234, 255],
    blue: [84, 156, 255],
    purple: [176, 132, 255],
    white: [244, 248, 255]
  };
  const PARTICLE_PALETTE = [COLORS.blue, COLORS.cyan, COLORS.blue, COLORS.purple];
  const PULSE_SYMBOLS = ["$", "%", "▲", "▼", "↑"];
  const KONAMI_SEQUENCE = [
    "arrowup", "arrowup", "arrowdown", "arrowdown",
    "arrowleft", "arrowright", "arrowleft", "arrowright",
    "b", "a"
  ];

  const config = {
    baseDensity: 1 / 16000, // particles per px^2, scaled by viewport area
    minParticles: 16,
    maxParticles: 95,
    pulseMaxParticles: 150,
    connectionDistance: 128,
    mouseRadius: 170,
    mouseForce: 0.018,
    maxSpeed: 0.22,
    idleAfterMs: 20000,
    pulseModeDurationMs: 30000,
    gridSpacing: 68
  };

  const state = {
    width: 0,
    height: 0,
    dpr: Math.min(window.devicePixelRatio || 1, 2),
    particles: [],
    ripples: [],
    bursts: [],
    symbols: [],
    beams: [],
    idleWaves: [],
    targetParticleCount: config.minParticles,
    speedMultiplier: 1,
    networkBoost: 0,
    mouse: { x: null, y: null, active: false },
    lastRippleAt: 0,
    lastRippleX: 0,
    lastRippleY: 0,
    lastInteractionAt: performance.now(),
    idle: false,
    lastIdleEffectAt: 0,
    pulseMode: false,
    pulseModeUntil: 0,
    lastSymbolSpawnAt: 0,
    frameTimes: [],
    lastPerfCheckAt: 0,
    running: true,
    reducedMotion: reduceMotionQuery.matches,
    time: 0
  };

  // ---------------------------------------------------------------------
  // Particle: a single drifting "data node"
  // ---------------------------------------------------------------------
  class Particle {
    constructor(width, height) {
      this.reset(width, height, true);
    }

    reset(width, height, initial) {
      this.x = Math.random() * width;
      this.y = Math.random() * height;
      const angle = Math.random() * Math.PI * 2;
      const speed = 0.02 + Math.random() * 0.05;
      this.vx = Math.cos(angle) * speed;
      this.vy = Math.sin(angle) * speed;
      this.baseRadius = 1.1 + Math.random() * 1.6;
      this.color = PARTICLE_PALETTE[(Math.random() * PARTICLE_PALETTE.length) | 0];
      this.twinklePhase = Math.random() * Math.PI * 2;
      this.activatedUntil = initial ? 0 : 0;
    }

    update(dt, width, height, mouse, speedMultiplier) {
      // Ambient drift with a very light spring back to cruising velocity so
      // mouse attraction always eases off instead of accumulating forever.
      const cruise = 0.03;
      this.vx += (Math.cos(this.twinklePhase) * cruise - this.vx) * 0.004 * dt;
      this.vy += (Math.sin(this.twinklePhase * 0.8) * cruise - this.vy) * 0.004 * dt;

      if (mouse.active) {
        const dx = mouse.x - this.x;
        const dy = mouse.y - this.y;
        const dist = Math.hypot(dx, dy);
        if (dist < config.mouseRadius && dist > 0.01) {
          const pull = (1 - dist / config.mouseRadius) * config.mouseForce;
          this.vx += (dx / dist) * pull * dt;
          this.vy += (dy / dist) * pull * dt;
        }
      }

      const speed = Math.hypot(this.vx, this.vy);
      const maxSpeed = config.maxSpeed * speedMultiplier;
      if (speed > maxSpeed) {
        this.vx = (this.vx / speed) * maxSpeed;
        this.vy = (this.vy / speed) * maxSpeed;
      }

      this.x += this.vx * dt * speedMultiplier;
      this.y += this.vy * dt * speedMultiplier;

      const margin = 40;
      if (this.x < -margin) this.x = width + margin;
      if (this.x > width + margin) this.x = -margin;
      if (this.y < -margin) this.y = height + margin;
      if (this.y > height + margin) this.y = -margin;

      this.twinklePhase += 0.0006 * dt;
    }

    draw(ctx, now) {
      const twinkle = 0.55 + Math.sin(this.twinklePhase + now * 0.001) * 0.25;
      const activated = this.activatedUntil > now;
      const radius = activated ? this.baseRadius * 1.9 : this.baseRadius;
      const alpha = activated ? 0.95 : 0.6 * twinkle + 0.24;
      const [r, g, b] = this.color;

      ctx.beginPath();
      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${(alpha * 0.4).toFixed(3)})`;
      ctx.arc(this.x, this.y, radius * 2.4, 0, Math.PI * 2);
      ctx.fill();

      ctx.beginPath();
      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;
      ctx.arc(this.x, this.y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ---------------------------------------------------------------------
  // Sizing / lifecycle helpers
  // ---------------------------------------------------------------------
  function computeParticleBudget(width, height) {
    const area = width * height;
    const raw = Math.round(area * config.baseDensity);
    const hardwareFactor = navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4 ? 0.6 : 1;
    const cap = (state.pulseMode ? config.pulseMaxParticles : config.maxParticles);
    return Math.max(config.minParticles, Math.min(cap, Math.round(raw * hardwareFactor)));
  }

  function resizeCanvas() {
    state.width = window.innerWidth;
    state.height = window.innerHeight;
    state.dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(state.width * state.dpr);
    canvas.height = Math.round(state.height * state.dpr);
    ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
    state.targetParticleCount = computeParticleBudget(state.width, state.height);
  }

  function syncParticleCount() {
    while (state.particles.length < state.targetParticleCount) {
      state.particles.push(new Particle(state.width, state.height));
    }
    if (state.particles.length > state.targetParticleCount) {
      state.particles.length = state.targetParticleCount;
    }
  }

  // ---------------------------------------------------------------------
  // Drawing: grid, scan line, connections, transient effects
  // ---------------------------------------------------------------------
  function drawGrid(now) {
    const spacing = config.gridSpacing;
    const drift = (now * 0.006) % spacing;
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(94, 156, 255, 0.07)";

    ctx.beginPath();
    for (let x = -spacing + drift; x < state.width + spacing; x += spacing) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, state.height);
    }
    for (let y = -spacing + drift; y < state.height + spacing; y += spacing) {
      ctx.moveTo(0, y);
      ctx.lineTo(state.width, y);
    }
    ctx.stroke();
  }

  function drawScanLine(now) {
    const cycle = 9000;
    const progress = (now % cycle) / cycle;
    const y = progress * (state.height + 200) - 100;
    const gradient = ctx.createLinearGradient(0, y - 60, 0, y + 60);
    gradient.addColorStop(0, "rgba(94, 234, 255, 0)");
    gradient.addColorStop(0.5, "rgba(94, 234, 255, 0.05)");
    gradient.addColorStop(1, "rgba(94, 234, 255, 0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, y - 60, state.width, 120);
  }

  function drawConnections() {
    const particles = state.particles;
    const maxDist = config.connectionDistance;
    const mouse = state.mouse;

    for (let i = 0; i < particles.length; i += 1) {
      for (let j = i + 1; j < particles.length; j += 1) {
        const a = particles[i];
        const b = particles[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dist = Math.hypot(dx, dy);
        if (dist >= maxDist) continue;

        let alpha = (1 - dist / maxDist) * 0.24;

        if (mouse.active) {
          const midX = (a.x + b.x) / 2;
          const midY = (a.y + b.y) / 2;
          const mouseDist = Math.hypot(mouse.x - midX, mouse.y - midY);
          if (mouseDist < config.mouseRadius) {
            alpha += (1 - mouseDist / config.mouseRadius) * 0.4;
          }
        }

        alpha += state.networkBoost;

        ctx.beginPath();
        ctx.strokeStyle = `rgba(120, 190, 255, ${Math.min(alpha, 0.65).toFixed(3)})`;
        ctx.lineWidth = 1;
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }
  }

  function drawCursorGlow() {
    if (!state.mouse.active) return;
    const gradient = ctx.createRadialGradient(
      state.mouse.x, state.mouse.y, 0,
      state.mouse.x, state.mouse.y, 210
    );
    gradient.addColorStop(0, "rgba(120, 200, 255, 0.15)");
    gradient.addColorStop(1, "rgba(120, 200, 255, 0)");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(state.mouse.x, state.mouse.y, 210, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawRipples(now, dt) {
    for (let i = state.ripples.length - 1; i >= 0; i -= 1) {
      const ripple = state.ripples[i];
      ripple.age += dt;
      const progress = ripple.age / ripple.duration;
      if (progress >= 1) {
        state.ripples.splice(i, 1);
        continue;
      }
      const radius = ripple.startRadius + progress * ripple.growth;
      const alpha = ripple.alpha * (1 - progress);
      ctx.beginPath();
      ctx.strokeStyle = `rgba(148, 210, 255, ${alpha.toFixed(3)})`;
      ctx.lineWidth = 1.4;
      ctx.arc(ripple.x, ripple.y, radius, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  function drawBursts(dt) {
    for (let i = state.bursts.length - 1; i >= 0; i -= 1) {
      const p = state.bursts[i];
      p.age += dt;
      if (p.age >= p.life) {
        state.bursts.splice(i, 1);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.96;
      p.vy *= 0.96;
      const alpha = (1 - p.age / p.life) * 0.9;
      const [r, g, b] = p.color;
      ctx.beginPath();
      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawSymbols(dt) {
    if (!state.symbols.length) return;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (let i = state.symbols.length - 1; i >= 0; i -= 1) {
      const s = state.symbols[i];
      s.age += dt;
      s.y += s.vy * dt;
      s.x += Math.sin(s.age * 0.002 + s.phase) * 0.15 * dt;
      const lifeProgress = s.age / s.life;
      if (lifeProgress >= 1) {
        state.symbols.splice(i, 1);
        continue;
      }
      const alpha = lifeProgress < 0.15 ? lifeProgress / 0.15 : 1 - (lifeProgress - 0.15) / 0.85;
      ctx.font = `${s.size}px ${getComputedStyle(document.body).fontFamily}`;
      ctx.fillStyle = `rgba(148, 210, 255, ${(alpha * 0.55).toFixed(3)})`;
      ctx.fillText(s.char, s.x, s.y);
    }
  }

  function drawIdleWaves(dt) {
    for (let i = state.idleWaves.length - 1; i >= 0; i -= 1) {
      const wave = state.idleWaves[i];
      wave.age += dt;
      const progress = wave.age / wave.duration;
      if (progress >= 1) {
        state.idleWaves.splice(i, 1);
        continue;
      }
      const radius = wave.startRadius + progress * wave.growth;
      const alpha = wave.alpha * (1 - progress);
      ctx.beginPath();
      ctx.strokeStyle = `rgba(176, 132, 255, ${alpha.toFixed(3)})`;
      ctx.lineWidth = 1;
      ctx.arc(wave.x, wave.y, radius, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // ---------------------------------------------------------------------
  // Interaction spawners
  // ---------------------------------------------------------------------
  function spawnRipple(x, y) {
    state.ripples.push({ x, y, age: 0, duration: 1100, startRadius: 4, growth: 90, alpha: 0.38 });
  }

  function spawnClickBurst(x, y) {
    state.ripples.push({ x, y, age: 0, duration: 900, startRadius: 2, growth: 130, alpha: 0.5 });
    const count = 10 + Math.round(Math.random() * 6);
    for (let i = 0; i < count; i += 1) {
      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.4;
      const speed = 0.05 + Math.random() * 0.12;
      state.bursts.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        radius: 1 + Math.random() * 1.6,
        age: 0,
        life: 700 + Math.random() * 400,
        color: PARTICLE_PALETTE[(Math.random() * PARTICLE_PALETTE.length) | 0]
      });
    }
  }

  function spawnIdleWave() {
    const x = Math.random() * state.width;
    const y = Math.random() * state.height;
    state.idleWaves.push({ x, y, age: 0, duration: 3400, startRadius: 6, growth: 220, alpha: 0.22 });
  }

  function activateRandomNode(now) {
    if (!state.particles.length) return;
    const particle = state.particles[(Math.random() * state.particles.length) | 0];
    particle.activatedUntil = now + 1500;
  }

  function spawnPulseSymbol() {
    state.symbols.push({
      char: PULSE_SYMBOLS[(Math.random() * PULSE_SYMBOLS.length) | 0],
      x: Math.random() * state.width,
      y: state.height + 20,
      vy: -(0.03 + Math.random() * 0.03),
      size: 14 + Math.random() * 10,
      phase: Math.random() * Math.PI * 2,
      age: 0,
      life: 9000 + Math.random() * 3000
    });
  }

  // ---------------------------------------------------------------------
  // Idle detection
  // ---------------------------------------------------------------------
  function registerInteraction(now) {
    state.lastInteractionAt = now;
    if (state.idle) {
      state.idle = false;
      state.idleWaves.length = 0;
    }
  }

  function updateIdleState(now) {
    if (!state.idle && now - state.lastInteractionAt > config.idleAfterMs) {
      state.idle = true;
      state.lastIdleEffectAt = now;
    }
    if (state.idle && now - state.lastIdleEffectAt > 2600) {
      state.lastIdleEffectAt = now;
      spawnIdleWave();
      activateRandomNode(now);
    }
  }

  // ---------------------------------------------------------------------
  // Pulse Mode (easter egg)
  // ---------------------------------------------------------------------
  let pulseToastEl = null;
  let pulseToastTimer = null;

  function showPulseToast(text) {
    if (!pulseToastEl) {
      pulseToastEl = document.createElement("div");
      pulseToastEl.className = "pulse-toast";
      document.body.appendChild(pulseToastEl);
    }
    pulseToastEl.textContent = text;
    requestAnimationFrame(() => pulseToastEl.classList.add("is-visible"));
    clearTimeout(pulseToastTimer);
    pulseToastTimer = setTimeout(() => {
      pulseToastEl.classList.remove("is-visible");
    }, 2200);
  }

  let pulseModeTimeout = null;

  function activatePulseMode() {
    if (state.reducedMotion) return;

    if (state.pulseMode) {
      deactivatePulseMode();
      return;
    }

    state.pulseMode = true;
    state.pulseModeUntil = performance.now() + config.pulseModeDurationMs;
    state.speedMultiplier = 1.6;
    state.networkBoost = 0.12;
    state.targetParticleCount = computeParticleBudget(state.width, state.height);
    showPulseToast("Pulse Mode Activated");

    clearTimeout(pulseModeTimeout);
    pulseModeTimeout = setTimeout(deactivatePulseMode, config.pulseModeDurationMs);
  }

  function deactivatePulseMode() {
    if (!state.pulseMode) return;
    state.pulseMode = false;
    state.speedMultiplier = 1;
    state.networkBoost = 0;
    state.targetParticleCount = computeParticleBudget(state.width, state.height);
    clearTimeout(pulseModeTimeout);
  }

  const konamiBuffer = [];
  function handleKonamiKey(event) {
    const key = event.key.toLowerCase();
    konamiBuffer.push(key);
    if (konamiBuffer.length > KONAMI_SEQUENCE.length) konamiBuffer.shift();
    if (
      konamiBuffer.length === KONAMI_SEQUENCE.length &&
      konamiBuffer.every((k, i) => k === KONAMI_SEQUENCE[i])
    ) {
      konamiBuffer.length = 0;
      activatePulseMode();
    }
  }

  // ---------------------------------------------------------------------
  // Performance adaptation
  // ---------------------------------------------------------------------
  function trackPerformance(now, dt) {
    state.frameTimes.push(dt);
    if (state.frameTimes.length > 45) state.frameTimes.shift();
    if (now - state.lastPerfCheckAt < 1200) return;
    state.lastPerfCheckAt = now;

    const avg = state.frameTimes.reduce((sum, t) => sum + t, 0) / state.frameTimes.length;
    const cap = state.pulseMode ? config.pulseMaxParticles : config.maxParticles;

    if (avg > 30 && state.targetParticleCount > config.minParticles) {
      state.targetParticleCount = Math.max(config.minParticles, Math.round(state.targetParticleCount * 0.85));
    } else if (avg < 18 && state.targetParticleCount < computeParticleBudget(state.width, state.height)) {
      state.targetParticleCount = Math.min(cap, state.targetParticleCount + 4);
    }
  }

  // ---------------------------------------------------------------------
  // Main loop
  // ---------------------------------------------------------------------
  let rafId = null;
  let lastFrameAt = 0;

  function frame(now) {
    if (!state.running) return;
    const dt = Math.min(now - lastFrameAt, 48) || 16;
    lastFrameAt = now;
    state.time = now;

    if (state.pulseMode && now >= state.pulseModeUntil) {
      deactivatePulseMode();
    }

    updateIdleState(now);
    syncParticleCount();

    for (const particle of state.particles) {
      particle.update(dt, state.width, state.height, state.mouse, state.speedMultiplier);
    }

    if (state.pulseMode && now - state.lastSymbolSpawnAt > 420) {
      state.lastSymbolSpawnAt = now;
      spawnPulseSymbol();
    }

    ctx.clearRect(0, 0, state.width, state.height);
    drawGrid(now);
    drawScanLine(now);
    drawIdleWaves(dt);
    drawConnections();
    drawCursorGlow();
    for (const particle of state.particles) particle.draw(ctx, now);
    drawRipples(now, dt);
    drawBursts(dt);
    drawSymbols(dt);

    trackPerformance(now, dt);
    rafId = requestAnimationFrame(frame);
  }

  function start() {
    if (rafId !== null) return;
    lastFrameAt = performance.now();
    rafId = requestAnimationFrame(frame);
  }

  function stop() {
    if (rafId === null) return;
    cancelAnimationFrame(rafId);
    rafId = null;
  }

  // ---------------------------------------------------------------------
  // Reduced motion: single static frame, no interaction wiring
  // ---------------------------------------------------------------------
  function renderStaticFrame() {
    resizeCanvas();
    syncParticleCount();
    ctx.clearRect(0, 0, state.width, state.height);
    drawGrid(0);
    for (const particle of state.particles) particle.draw(ctx, 0);
  }

  // ---------------------------------------------------------------------
  // Wiring
  // ---------------------------------------------------------------------
  function handlePointerMove(event) {
    const now = performance.now();
    state.mouse.x = event.clientX;
    state.mouse.y = event.clientY;
    state.mouse.active = true;
    registerInteraction(now);

    const moved = Math.hypot(event.clientX - state.lastRippleX, event.clientY - state.lastRippleY);
    if (moved > 55 && now - state.lastRippleAt > 260) {
      state.lastRippleAt = now;
      state.lastRippleX = event.clientX;
      state.lastRippleY = event.clientY;
      spawnRipple(event.clientX, event.clientY);
    }
  }

  function handlePointerLeave() {
    state.mouse.active = false;
  }

  function handleClick(event) {
    registerInteraction(performance.now());
    spawnClickBurst(event.clientX, event.clientY);
  }

  function handleResize() {
    resizeCanvas();
  }

  function handleVisibilityChange() {
    if (document.hidden) {
      stop();
    } else if (!state.reducedMotion) {
      start();
    }
  }

  function init() {
    resizeCanvas();
    syncParticleCount();

    if (state.reducedMotion) {
      renderStaticFrame();
      reduceMotionQuery.addEventListener("change", (event) => {
        state.reducedMotion = event.matches;
        if (state.reducedMotion) {
          stop();
          renderStaticFrame();
        } else {
          start();
        }
      });
      window.addEventListener("resize", () => renderStaticFrame(), { passive: true });
      return;
    }

    window.addEventListener("mousemove", handlePointerMove, { passive: true });
    window.addEventListener("mouseleave", handlePointerLeave, { passive: true });
    window.addEventListener("click", handleClick, { passive: true });
    window.addEventListener("resize", handleResize, { passive: true });
    document.addEventListener("visibilitychange", handleVisibilityChange);
    document.addEventListener("keydown", handleKonamiKey);

    const logo = document.getElementById("appLogo");
    if (logo) logo.addEventListener("dblclick", activatePulseMode);

    start();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
