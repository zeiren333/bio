/* ================================================================
   WISKAS — LINK IN BIO
   Start screen, music unlock (iOS/Android/desktop friendly),
   living background particles and pointer parallax.
   ================================================================ */

(function () {
  "use strict";

  var doc = document;
  var body = doc.body;
  var intro = doc.getElementById("intro");
  var introButton = doc.getElementById("intro-button");
  var audio = doc.getElementById("audio");
  var sound = doc.getElementById("sound");
  var toast = doc.getElementById("toast");
  var toastText = toast ? toast.querySelector(".toast__text") : null;
  var main = doc.getElementById("main");
  var scene = doc.querySelector(".scene");
  var bokeh = doc.querySelector(".scene__bokeh");
  var motionQuery = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : { matches: false };

  if (!intro || !audio || !sound) {
    return;
  }

  var TARGET_VOLUME = 0.65;
  var state = {
    started: false,
    muted: false,
    unlockBound: false,
    fadeTimer: 0,
    toastTimer: 0,
    hideTimer: 0
  };

  /* --------------------------------------------------------------
     Audio: HTMLAudioElement + loop + gesture unlock.
     iOS needs playsinline, Android Chrome needs a user gesture,
     Safari may reject play() until the next touch — we re-arm then.
     -------------------------------------------------------------- */
  audio.loop = true;
  audio.preload = "auto";
  audio.setAttribute("playsinline", "");
  audio.setAttribute("webkit-playsinline", "");

  try {
    audio.muted = false;
    audio.volume = 0;
  } catch (error) {
    /* Some iOS versions expose volume as read-only; safe to ignore. */
  }

  function fadeVolumeIn() {
    window.clearInterval(state.fadeTimer);
    state.fadeTimer = 0;

    if (state.muted) {
      return;
    }

    var volume = 0;

    try {
      audio.volume = 0;
    } catch (error) {
      /* noop */
    }

    state.fadeTimer = window.setInterval(function () {
      volume += 0.045;

      if (volume >= TARGET_VOLUME) {
        volume = TARGET_VOLUME;
        window.clearInterval(state.fadeTimer);
        state.fadeTimer = 0;
      }

      try {
        audio.volume = volume;
      } catch (error) {
        /* noop */
      }
    }, 100);
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
        fadeVolumeIn();
        syncSound();
      }).catch(function () {
        armUnlock();
        if (!quiet) {
          showToast();
        }
      });
    } else {
      fadeVolumeIn();
      syncSound();
    }
  }

  function armUnlock() {
    if (state.unlockBound) {
      return;
    }

    state.unlockBound = true;

    var events = ["pointerdown", "touchstart", "touchend", "keydown"];

    function cleanup() {
      events.forEach(function (eventName) {
        doc.removeEventListener(eventName, unlockHandler, true);
      });
    }

    function unlockHandler() {
      cleanup();
      state.unlockBound = false;
      safePlay(true);
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

    if (audio.paused) {
      safePlay(true);
    } else {
      hideToast();
      try {
        if (audio.volume < 0.05) {
          fadeVolumeIn();
        }
      } catch (error) {
        /* noop */
      }
    }
  }

  /* --------------------------------------------------------------
     Toast for blocked autoplay / audio errors.
     -------------------------------------------------------------- */
  function showToast(message) {
    if (!toast) {
      return;
    }

    if (message && toastText) {
      toastText.textContent = message;
    }

    window.clearTimeout(state.hideTimer);
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
    window.clearTimeout(state.hideTimer);

    state.hideTimer = window.setTimeout(function () {
      toast.hidden = true;
    }, 450);
  }

  /* --------------------------------------------------------------
     Start screen.
     play() is called synchronously inside the user's click gesture.
     -------------------------------------------------------------- */
  function startExperience() {
    if (state.started) {
      return;
    }

    state.started = true;
    safePlay(false);

    body.classList.add("page--started");
    intro.classList.add("is-leaving");
    intro.setAttribute("aria-hidden", "true");

    if (introButton) {
      introButton.disabled = true;
    }

    window.setTimeout(function () {
      intro.hidden = true;
    }, 1100);

    window.setTimeout(function () {
      if (!main) {
        return;
      }

      try {
        main.focus({ preventScroll: true });
      } catch (error) {
        main.focus();
      }
    }, 1200);
  }

  intro.addEventListener("click", startExperience);

  sound.addEventListener("click", function (event) {
    event.preventDefault();
    event.stopPropagation();

    if (!state.started) {
      return;
    }

    setMuted(!state.muted);
  });

  doc.addEventListener("keydown", function (event) {
    if (!state.started || event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }

    var key = event.key;

    if (key === "m" || key === "M" || key === "ь" || key === "Ь") {
      setMuted(!state.muted);
    }
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
    if (doc.visibilityState !== "visible" || !state.started || state.muted) {
      return;
    }

    if (audio.paused) {
      safePlay(true);
    }
  });

  window.addEventListener("pageshow", function (event) {
    if (event.persisted && state.started && !state.muted && audio.paused) {
      safePlay(true);
    }
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
    var frame = 0;
    var running = false;

    function tick() {
      if (!running) {
        return;
      }

      currentX += (targetX - currentX) * 0.06;
      currentY += (targetY - currentY) * 0.06;

      scene.style.setProperty("--mx", currentX.toFixed(3));
      scene.style.setProperty("--my", currentY.toFixed(3));

      frame = window.requestAnimationFrame(tick);
    }

    function play() {
      if (running) {
        return;
      }

      running = true;
      frame = window.requestAnimationFrame(tick);
    }

    function pause() {
      running = false;
      window.cancelAnimationFrame(frame);
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
  initBokeh();
  initParallax();
})();
