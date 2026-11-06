/* ================================================================
   WISKAS — LINK IN BIO
   Portal hold-to-enter interaction, synchronised music, warp field,
   living background particles and pointer parallax.
   ================================================================ */

(function () {
  "use strict";

  var doc = document;
  var root = doc.documentElement;
  var body = doc.body;
  var intro = doc.getElementById("intro");
  var portal = doc.getElementById("portal");
  var portalValue = doc.getElementById("portal-value");
  var portalHint = doc.getElementById("portal-hint");
  var portalStatus = doc.getElementById("portal-status");
  var audio = doc.getElementById("audio");
  var sound = doc.getElementById("sound");
  var toast = doc.getElementById("toast");
  var toastText = toast ? toast.querySelector(".toast__text") : null;
  var main = doc.getElementById("main");
  var scene = doc.querySelector(".scene");
  var bokeh = doc.querySelector(".scene__bokeh");
  var canvas = doc.getElementById("warp-canvas");
  var ctx = canvas && canvas.getContext ? canvas.getContext("2d") : null;
  var motionQuery = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : { matches: false };

  if (!intro || !portal || !audio || !sound) {
    return;
  }

  var HOLD_MS = 3000;
  var CHARGE_VOLUME = 0.42;
  var RICH_VOLUME = 0.82;
  var AFTER_VOLUME = 0.62;
  var state = {
    started: false,
    warping: false,
    holding: false,
    muted: false,
    unlockBound: false,
    charge: 0,
    holdStart: 0,
    raf: 0,
    lastFrame: 0,
    introActive: true,
    audioTarget: null,
    revealTimer: 0,
    hideTimer: 0,
    toastTimer: 0,
    toastHideTimer: 0,
    lastPercent: -1,
    lastStatus: -1
  };
  var canvasWidth = 0;
  var canvasHeight = 0;
  var canvasDpr = 1;
  var reduceMotion = motionQuery.matches;
  var stars = [];

  function now() {
    return window.performance && window.performance.now ? window.performance.now() : Date.now();
  }

  /* --------------------------------------------------------------
     Audio. The first play() always happens synchronously inside
     the pointerdown gesture; volume follows the portal charge.
     -------------------------------------------------------------- */
  audio.loop = true;
  audio.preload = "auto";
  audio.setAttribute("playsinline", "");
  audio.setAttribute("webkit-playsinline", "");

  try {
    audio.muted = false;
    audio.volume = 0;
  } catch (error) {
    /* iOS may expose volume as read-only; safe to ignore. */
  }

  function setVolume(value) {
    var next = Math.max(0, Math.min(1, value));

    try {
      if (Math.abs(audio.volume - next) > 0.002) {
        audio.volume = next;
      }
    } catch (error) {
      /* noop */
    }
  }

  function safePlay(quiet) {
    var promise;

    try {
      promise = audio.play();
    } catch (error) {
      armUnlock();
      if (!quiet) {
        showToast();
      }
      return;
    }

    if (promise && typeof promise.then === "function") {
      promise.then(function () {
        hideToast();
        syncSound();
      }).catch(function () {
        armUnlock();
        if (!quiet) {
          showToast();
        }
      });
    } else {
      hideToast();
      syncSound();
    }
  }

  function armUnlock() {
    if (state.unlockBound) {
      return;
    }

    state.unlockBound = true;

    var events = ["pointerdown", "touchstart", "keydown"];

    function cleanup() {
      events.forEach(function (eventName) {
        doc.removeEventListener(eventName, unlockHandler, true);
      });
    }

    function unlockHandler() {
      cleanup();
      state.unlockBound = false;

      if (state.holding || state.started) {
        safePlay(true);
      }
    }

    events.forEach(function (eventName) {
      doc.addEventListener(eventName, unlockHandler, true);
    });
  }

  function syncSound() {
    var muted = state.muted || audio.muted;

    sound.classList.toggle("is-muted", muted);
    sound.setAttribute("aria-pressed", muted ? "false" : "true");
    sound.setAttribute("aria-label", muted ? "Музыка выключена. Включить" : "Музыка включена. Выключить");
  }

  function setMuted(nextMuted) {
    state.muted = Boolean(nextMuted);

    try {
      audio.muted = state.muted;
    } catch (error) {
      /* noop */
    }

    syncSound();

    if (state.muted) {
      hideToast();
      return;
    }

    if (!state.started) {
      return;
    }

    if (audio.paused) {
      safePlay(true);
    }

    hideToast();
    state.audioTarget = AFTER_VOLUME;
    ensureLoop();
  }

  function rampAudio(dt) {
    var target = state.audioTarget;

    if (target === null) {
      return;
    }

    var current = audio.volume;
    var next = current + (target - current) * (1 - Math.exp(-3.2 * dt));

    if (Math.abs(target - next) < 0.004) {
      next = target;
      state.audioTarget = null;
    }

    setVolume(next);
  }

  /* --------------------------------------------------------------
     Toast for blocked audio / loading errors.
     -------------------------------------------------------------- */
  function showToast(message) {
    if (!toast) {
      return;
    }

    if (message && toastText) {
      toastText.textContent = message;
    }

    window.clearTimeout(state.toastHideTimer);
    toast.hidden = false;

    window.requestAnimationFrame(function () {
      toast.classList.add("is-visible");
    });

    window.clearTimeout(state.toastTimer);
    state.toastTimer = window.setTimeout(hideToast, 5200);
  }

  function hideToast() {
    if (!toast) {
      return;
    }

    window.clearTimeout(state.toastTimer);
    toast.classList.remove("is-visible");
    window.clearTimeout(state.toastHideTimer);

    state.toastHideTimer = window.setTimeout(function () {
      toast.hidden = true;
    }, 450);
  }

  /* --------------------------------------------------------------
     Warp canvas: a soft star field that accelerates on charge and
     turns into light streaks during the portal jump.
     -------------------------------------------------------------- */
  function resizeCanvas() {
    if (!canvas || !ctx) {
      return;
    }

    canvasWidth = window.innerWidth;
    canvasHeight = window.innerHeight;
    canvasDpr = Math.min(window.devicePixelRatio || 1, 2);

    canvas.width = Math.max(1, Math.round(canvasWidth * canvasDpr));
    canvas.height = Math.max(1, Math.round(canvasHeight * canvasDpr));
    canvas.style.width = canvasWidth + "px";
    canvas.style.height = canvasHeight + "px";

    ctx.setTransform(canvasDpr, 0, 0, canvasDpr, 0, 0);
    initStars();
  }

  function makeStar() {
    return {
      x: Math.random() * 2 - 1,
      y: Math.random() * 2 - 1,
      z: 0.12 + Math.random() * 0.88,
      o: 0.25 + Math.random() * 0.65,
      c: Math.random() < 0.18 ? 1 : 0
    };
  }

  function initStars() {
    var count = canvasWidth < 700 ? 90 : 190;
    var index;

    if (reduceMotion) {
      count = Math.floor(count * 0.6);
    }

    stars = [];

    for (index = 0; index < count; index += 1) {
      stars.push(makeStar());
    }
  }

  function drawStars(dt) {
    if (!ctx || !canvasWidth || !canvasHeight) {
      return;
    }

    var cx = canvasWidth / 2;
    var cy = canvasHeight / 2;
    var focal = Math.min(canvasWidth, canvasHeight) * 0.62;
    var warp = state.warping;
    var charge = state.charge;
    var speed = reduceMotion ? 0 : (warp ? 2.4 + charge * 1.6 : 0.012 + charge * 0.18);
    var trail = reduceMotion ? 0 : (warp ? 0.085 : 0.016 + charge * 0.018);
    var index;
    var star;

    ctx.clearRect(0, 0, canvasWidth, canvasHeight);

    for (index = 0; index < stars.length; index += 1) {
      star = stars[index];

      if (speed > 0) {
        star.z -= speed * dt * (0.65 + star.o * 0.6);

        if (star.z <= 0.05) {
          star.z = 1;
          star.x = Math.random() * 2 - 1;
          star.y = Math.random() * 2 - 1;
          star.o = 0.25 + Math.random() * 0.65;
          star.c = Math.random() < 0.18 ? 1 : 0;
        }
      }

      var z1 = star.z;
      var z2 = Math.min(1.05, z1 + trail);
      var k1 = focal / z1;
      var k2 = focal / z2;
      var x1 = cx + star.x * k1;
      var y1 = cy + star.y * k1;
      var x2 = cx + star.x * k2;
      var y2 = cy + star.y * k2;

      if ((x1 < -80 && x2 < -80) || (x1 > canvasWidth + 80 && x2 > canvasWidth + 80) || (y1 < -80 && y2 < -80) || (y1 > canvasHeight + 80 && y2 > canvasHeight + 80)) {
        continue;
      }

      var alpha = warp ? (0.55 + star.o * 0.4) : (0.16 + charge * 0.55) * star.o;
      var width = warp ? 1.4 + star.o * 1.2 : 0.7 + (1 - z1) * 1.5;

      if (alpha <= 0.01) {
        continue;
      }

      ctx.beginPath();
      ctx.strokeStyle = star.c ? "rgba(255, 214, 246, " + alpha.toFixed(3) + ")" : "rgba(188, 241, 255, " + alpha.toFixed(3) + ")";
      ctx.lineWidth = width;
      ctx.lineCap = "round";
      ctx.moveTo(x2, y2);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    }

    if (charge > 0.01 && !warp) {
      var radius = Math.min(canvasWidth, canvasHeight) * (0.2 + charge * 0.26);
      var glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);

      glow.addColorStop(0, "rgba(154, 238, 255, " + (charge * 0.14).toFixed(3) + ")");
      glow.addColorStop(1, "rgba(154, 238, 255, 0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /* --------------------------------------------------------------
     Charge loop. The displayed value is the real hold progress
     while pressed and eases back to zero after an early release.
     -------------------------------------------------------------- */
  function renderCharge() {
    var charge = state.charge;
    var percent = Math.round(charge * 100);
    var statusBucket = Math.floor(percent / 25) * 25;

    root.style.setProperty("--charge", charge.toFixed(4));

    if (portalValue && percent !== state.lastPercent) {
      portalValue.textContent = percent + "%";
      state.lastPercent = percent;
    }

    if (portalStatus && statusBucket !== state.lastStatus) {
      state.lastStatus = statusBucket;
      portalStatus.textContent = percent >= 100 ? "Портал открыт" : "Заряд " + percent + "%";
    }
  }

  function ensureLoop() {
    if (state.raf) {
      return;
    }

    state.lastFrame = now();
    state.raf = window.requestAnimationFrame(frame);
  }

  function frame(timestamp) {
    var current = typeof timestamp === "number" ? timestamp : now();
    var dt = (current - state.lastFrame) / 1000;

    if (!isFinite(dt) || dt <= 0) {
      dt = 1 / 60;
    }

    dt = Math.min(dt, 0.08);
    state.lastFrame = current;

    if (state.warping) {
      state.charge = 1;
    } else if (state.holding) {
      state.charge = Math.min(1, Math.max(0, (current - state.holdStart) / HOLD_MS));

      if (state.charge >= 1) {
        completePortal();
      }
    } else if (!state.started) {
      if (state.charge > 0.0015) {
        state.charge *= Math.exp(-4.8 * dt);

        if (state.charge < 0.0015) {
          state.charge = 0;
        }
      } else {
        state.charge = 0;
      }
    }

    if (state.warping) {
      rampAudio(dt);
    } else if (state.holding) {
      state.audioTarget = null;
      setVolume(state.charge * CHARGE_VOLUME);
    } else if (!state.started) {
      if (state.charge > 0) {
        setVolume(state.charge * CHARGE_VOLUME);
      }

      if (!audio.paused && state.charge < 0.01) {
        try {
          setVolume(0);
          audio.pause();
          audio.currentTime = 0;
        } catch (error) {
          /* noop */
        }
      }
    } else if (state.audioTarget !== null) {
      rampAudio(dt);
    }

    renderCharge();
    drawStars(dt);

    if (state.introActive || state.warping || state.holding || state.charge > 0.001 || state.audioTarget !== null) {
      state.raf = window.requestAnimationFrame(frame);
    } else {
      state.raf = 0;
    }
  }

  function beginCharge(event) {
    if (state.started || state.warping || state.holding) {
      return;
    }

    if (event && event.type === "pointerdown") {
      if (event.pointerType === "mouse" && event.button !== 0) {
        return;
      }

      event.preventDefault();

      try {
        portal.setPointerCapture(event.pointerId);
      } catch (error) {
        /* noop */
      }
    }

    state.holding = true;
    state.holdStart = now() - state.charge * HOLD_MS;

    if (state.charge < 0.01) {
      try {
        audio.currentTime = 0;
      } catch (error) {
        /* noop */
      }
    }

    safePlay(false);
    setVolume(state.charge * CHARGE_VOLUME);

    portal.classList.add("is-charging");
    portal.classList.remove("is-complete");
    body.classList.add("is-charging");

    if (portalHint) {
      portalHint.textContent = "не отпускай";
    }

    ensureLoop();
  }

  function releaseCharge() {
    if (!state.holding || state.warping) {
      return;
    }

    if (now() - state.holdStart >= HOLD_MS) {
      state.charge = 1;
      completePortal();
      return;
    }

    state.holding = false;
    portal.classList.remove("is-charging");
    body.classList.remove("is-charging");

    if (portalHint) {
      portalHint.textContent = "зажми на 3 секунды";
    }

    ensureLoop();
  }

  function completePortal() {
    if (state.warping || state.started) {
      return;
    }

    state.warping = true;
    state.holding = false;
    state.charge = 1;
    state.audioTarget = RICH_VOLUME;

    portal.classList.remove("is-charging");
    portal.classList.add("is-complete");
    portal.disabled = true;
    portal.setAttribute("aria-label", "Портал открыт");

    body.classList.remove("is-charging");
    body.classList.add("is-warping");
    intro.classList.add("is-warping");

    if (portalHint) {
      portalHint.textContent = "переход";
    }

    if (portalStatus) {
      portalStatus.textContent = "Портал открыт";
    }

    if (audio.paused) {
      safePlay(true);
    }

    ensureLoop();

    window.clearTimeout(state.revealTimer);
    state.revealTimer = window.setTimeout(revealPage, 2000);

    window.clearTimeout(state.hideTimer);
    state.hideTimer = window.setTimeout(function () {
      intro.hidden = true;
      state.introActive = false;
      state.charge = 0;
      root.style.setProperty("--charge", "0");
    }, 3700);
  }

  function revealPage() {
    if (!state.warping) {
      return;
    }

    state.warping = false;
    state.started = true;

    body.classList.add("page--started");
    body.classList.remove("is-warping");
    intro.classList.add("is-leaving");
    intro.setAttribute("aria-hidden", "true");

    if (portalHint) {
      portalHint.textContent = "добро пожаловать";
    }

    state.audioTarget = AFTER_VOLUME;
    ensureLoop();

    window.setTimeout(function () {
      if (!main) {
        return;
      }

      try {
        main.focus({ preventScroll: true });
      } catch (error) {
        main.focus();
      }
    }, 900);
  }

  /* --------------------------------------------------------------
     Pointer / keyboard hold handling.
     -------------------------------------------------------------- */
  portal.addEventListener("pointerdown", beginCharge);
  window.addEventListener("pointerup", releaseCharge, { passive: true });
  window.addEventListener("pointercancel", releaseCharge, { passive: true });
  portal.addEventListener("lostpointercapture", releaseCharge);
  portal.addEventListener("contextmenu", function (event) {
    event.preventDefault();
  });
  portal.addEventListener("dragstart", function (event) {
    event.preventDefault();
  });

  doc.addEventListener("keydown", function (event) {
    if (event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }

    var key = event.key;

    if (!state.started && !state.warping && (key === " " || key === "Spacebar" || key === "Enter")) {
      if (event.repeat) {
        return;
      }

      event.preventDefault();
      beginCharge();
      return;
    }

    if (state.started && (key === "m" || key === "M" || key === "ь" || key === "Ь")) {
      if (event.repeat) {
        return;
      }

      event.preventDefault();
      setMuted(!state.muted);
    }
  });

  doc.addEventListener("keyup", function (event) {
    if (state.warping) {
      return;
    }

    var key = event.key;

    if (!state.started && (key === " " || key === "Spacebar" || key === "Enter")) {
      event.preventDefault();
      releaseCharge();
    }
  });

  sound.addEventListener("click", function (event) {
    event.preventDefault();
    event.stopPropagation();

    if (!state.started) {
      return;
    }

    setMuted(!state.muted);
  });

  audio.addEventListener("playing", function () {
    hideToast();
    syncSound();
  });

  audio.addEventListener("pause", function () {
    syncSound();
  });

  audio.addEventListener("ended", function () {
    /* Safety net for browsers that ignore the loop attribute. */
    if (state.muted) {
      return;
    }

    try {
      audio.currentTime = 0;
    } catch (error) {
      /* noop */
    }

    safePlay(true);
  });

  audio.addEventListener("error", function () {
    showToast("Не удалось загрузить музыку");
  });

  doc.addEventListener("visibilitychange", function () {
    if (doc.hidden) {
      if (!state.started) {
        releaseCharge();
        setVolume(0);

        try {
          audio.pause();
        } catch (error) {
          /* noop */
        }
      }

      return;
    }

    if (state.started && !state.muted && audio.paused) {
      safePlay(true);
      state.audioTarget = AFTER_VOLUME;
      ensureLoop();
    }
  });

  window.addEventListener("pageshow", function (event) {
    if (event.persisted && state.started && !state.muted && audio.paused) {
      safePlay(true);
      state.audioTarget = AFTER_VOLUME;
      ensureLoop();
    }
  });

  window.addEventListener("blur", function () {
    if (!state.started) {
      releaseCharge();
    }
  });

  window.addEventListener("resize", resizeCanvas, { passive: true });
  window.addEventListener("orientationchange", function () {
    window.setTimeout(resizeCanvas, 240);
  });

  /* --------------------------------------------------------------
     Bokeh particles. Positions, sizes and speeds are random,
     but motion itself stays in CSS for smooth compositing.
     -------------------------------------------------------------- */
  function initBokeh() {
    if (!bokeh || motionQuery.matches) {
      return;
    }

    var count = window.innerWidth < 700 ? 12 : 20;
    var fragment = doc.createDocumentFragment();

    for (var index = 0; index < count; index += 1) {
      var dot = doc.createElement("span");
      var size = 2 + Math.random() * 6;

      dot.className = "scene__dot";
      dot.style.setProperty("--x", (Math.random() * 100).toFixed(2) + "%");
      dot.style.setProperty("--y", (Math.random() * 100).toFixed(2) + "%");
      dot.style.setProperty("--s", size.toFixed(1) + "px");
      dot.style.setProperty("--d", (14 + Math.random() * 16).toFixed(1) + "s");
      dot.style.setProperty("--delay", (-Math.random() * 20).toFixed(1) + "s");
      dot.style.setProperty("--drift", (-45 + Math.random() * 90).toFixed(0) + "px");
      dot.style.setProperty("--rise", (90 + Math.random() * 150).toFixed(0) + "px");
      dot.style.setProperty("--o", (0.15 + Math.random() * 0.5).toFixed(2));
      fragment.appendChild(dot);
    }

    bokeh.appendChild(fragment);
  }

  /* --------------------------------------------------------------
     Pointer parallax for the whole living background (desktop).
     The CSS drift animation keeps running on top of it.
     -------------------------------------------------------------- */
  function initParallax() {
    if (!scene || motionQuery.matches) {
      return;
    }

    var finePointer = window.matchMedia ? window.matchMedia("(pointer: fine)").matches : true;

    if (!finePointer) {
      return;
    }

    var targetX = 0;
    var targetY = 0;
    var currentX = 0;
    var currentY = 0;
    var frameId = 0;
    var running = false;

    function tick() {
      if (!running) {
        return;
      }

      currentX += (targetX - currentX) * 0.06;
      currentY += (targetY - currentY) * 0.06;

      scene.style.setProperty("--mx", currentX.toFixed(3));
      scene.style.setProperty("--my", currentY.toFixed(3));

      frameId = window.requestAnimationFrame(tick);
    }

    function play() {
      if (running) {
        return;
      }

      running = true;
      frameId = window.requestAnimationFrame(tick);
    }

    function pause() {
      running = false;
      window.cancelAnimationFrame(frameId);
    }

    window.addEventListener("pointermove", function (event) {
      targetX = (event.clientX / window.innerWidth - 0.5) * 2;
      targetY = (event.clientY / window.innerHeight - 0.5) * 2;
    }, { passive: true });

    window.addEventListener("mouseout", function (event) {
      if (!event.relatedTarget) {
        targetX = 0;
        targetY = 0;
      }
    }, { passive: true });

    doc.addEventListener("visibilitychange", function () {
      if (doc.hidden) {
        pause();
      } else {
        play();
      }
    });

    play();
  }

  syncSound();
  setVolume(0);
  resizeCanvas();
  ensureLoop();
  initBokeh();
  initParallax();
})();
