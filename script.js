(() => {
  'use strict';

  // Icons. Guarded so a CDN failure doesn't take the carousels down with it.
  window.lucide?.createIcons();

  const yearEl = document.getElementById('year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  const DRAG_MULTIPLIER = 1.6; // how far the track moves per px of mouse drag
  const DRAG_THRESHOLD = 4;    // px before a press counts as a drag (not a click)
  const RESUME_DELAY = 1500;   // ms of quiet after touch/scroll before autoplay resumes

  /* ------------------------------------------------------------------ *
   * Shared motion state (reduced-motion preference + manual toggle)
   * ------------------------------------------------------------------ */
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const motion = { paused: reduceMotion.matches };
  const motionListeners = new Set();
  const toggle = document.getElementById('motion-toggle');

  function setPaused(value) {
    motion.paused = value;
    if (toggle) toggle.dataset.paused = String(value);
    motionListeners.forEach((fn) => fn());
  }

  if (toggle) {
    toggle.dataset.paused = String(motion.paused);
    toggle.addEventListener('click', () => setPaused(!motion.paused));
  }
  reduceMotion.addEventListener?.('change', (e) => setPaused(e.matches));

  /* ------------------------------------------------------------------ *
   * Videos: only play what's actually on screen
   * ------------------------------------------------------------------ */
  const videos = new Set();

  function syncVideo(video) {
    const shouldPlay = !motion.paused && video.dataset.inView === 'true';
    if (shouldPlay) video.play().catch(() => {});
    else video.pause();
  }

  const videoObserver = 'IntersectionObserver' in window
    ? new IntersectionObserver((entries) => {
        for (const { target, isIntersecting } of entries) {
          target.dataset.inView = String(isIntersecting);
          syncVideo(target);
        }
      }, { threshold: 0.25 })
    : null;

  function watchVideo(video) {
    // cloneNode() copies the `muted` attribute but not the muted *property*,
    // and browsers refuse to autoplay unmuted video.
    video.muted = true;
    videos.add(video);
    if (videoObserver) {
      videoObserver.observe(video);
    } else {
      video.dataset.inView = 'true';
      syncVideo(video);
    }
  }

  motionListeners.add(() => videos.forEach(syncVideo));

  /* ------------------------------------------------------------------ *
   * Auto-scrolling, draggable, seamlessly looping tracks
   * ------------------------------------------------------------------ */
  function initTrack(track) {
    const content = track.querySelector('.track-content');
    if (!content) return;

    const originals = Array.from(content.children);
    if (!originals.length) return;

    // data-speed is authored as px per frame at 60fps; convert to px/second
    const speed = (parseFloat(track.dataset.speed) || 0.8) * 60;

    let sets = 1;        // how many copies of the original cards exist
    let period = 0;      // exact px distance covering one full set of cards
    let pos = 0;         // float scroll position (scrollLeft can't hold fractions)
    let raf = 0;
    let last = 0;
    let pausedUntil = 0;
    let hovered = false;
    let focused = false;
    let dragging = false;
    let visible = false;
    let moved = false;
    let suppressClick = false;
    let startX = 0;
    let lastX = 0;
    let idleTimer = 0;
    let layoutRaf = 0;

    content.querySelectorAll('video').forEach(watchVideo);

    function addSet() {
      for (const card of originals) {
        const clone = card.cloneNode(true);
        // Clones are visual only: hide from assistive tech and keyboard.
        clone.setAttribute('aria-hidden', 'true');
        clone.querySelectorAll('a, button, [tabindex]').forEach((el) => el.setAttribute('tabindex', '-1'));
        clone.querySelectorAll('video').forEach(watchVideo);
        content.appendChild(clone);
      }
      sets += 1;
    }

    // Keep pos inside [period, 2*period). Content repeats every `period`px, so
    // jumping by whole periods is invisible.
    function wrapPos() {
      pos = period + ((((pos - period) % period) + period) % period);
    }

    function write() {
      track.scrollLeft = pos;
    }

    function layout() {
      while (sets < 2) addSet();

      // Measure the real distance between card 0 and its first clone. Dividing
      // scrollWidth by 3 (the old approach) ignores padding and gaps, which
      // caused a visible jump every loop.
      const newPeriod = content.children[originals.length].offsetLeft - content.children[0].offsetLeft;
      if (newPeriod <= 0) return; // styles not applied yet, or track hidden

      // Wide screens need more copies so the right edge never runs out of cards.
      const needed = Math.ceil(track.clientWidth / newPeriod) + 2;
      while (sets < needed) addSet();

      pos = period === 0 ? newPeriod : (pos / period) * newPeriod;
      period = newPeriod;
      wrapPos();
      write();
    }

    function scheduleLayout() {
      cancelAnimationFrame(layoutRaf);
      layoutRaf = requestAnimationFrame(layout);
    }

    function frame(now) {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(now - last, 64) / 1000; // clamp so tab-switches don't cause jumps
      last = now;
      if (dragging || hovered || focused || now < pausedUntil || period <= 0) return;
      pos += speed * dt;
      wrapPos();
      write();
    }

    // Run the animation loop only while the row is on screen and motion is allowed.
    function syncLoop() {
      const shouldRun = visible && !motion.paused;
      if (shouldRun && !raf) {
        last = performance.now();
        raf = requestAnimationFrame(frame);
      } else if (!shouldRun && raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    }

    /* ---- native scrolling (touch, trackpad, keyboard) ---- */
    track.addEventListener('scroll', () => {
      if (Math.abs(track.scrollLeft - pos) < 1.5) return; // our own write
      pos = track.scrollLeft;
      pausedUntil = performance.now() + RESUME_DELAY;

      // Hitting a hard edge: wrap right away. Otherwise wait until scrolling
      // settles so we don't interrupt touch momentum.
      const max = track.scrollWidth - track.clientWidth;
      if (pos < 1 || pos > max - 1) {
        wrapPos();
        write();
        return;
      }
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        wrapPos();
        write();
      }, 150);
    }, { passive: true });

    /* ---- pause on hover / keyboard focus / touch ---- */
    track.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') hovered = true; });
    track.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') hovered = false; });
    track.addEventListener('focusin', (e) => {
      // :focus-visible ignores focus from mouse clicks, so clicking the
      // track doesn't pause it forever.
      if (e.target.matches(':focus-visible')) focused = true;
    });
    track.addEventListener('focusout', (e) => {
      if (!track.contains(e.relatedTarget)) focused = false;
    });

    /* ---- mouse drag (touch and pen use native scrolling) ---- */
    function onMove(e) {
      const dx = e.clientX - lastX;
      lastX = e.clientX;
      if (!moved && Math.abs(e.clientX - startX) > DRAG_THRESHOLD) moved = true;
      if (!moved) return;
      pos -= dx * DRAG_MULTIPLIER;
      wrapPos();
      write();
    }

    function onUp() {
      dragging = false;
      track.classList.remove('is-dragging');
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      suppressClick = moved;
      if (moved) setTimeout(() => { suppressClick = false; }, 0);
    }

    track.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse') {
        pausedUntil = performance.now() + RESUME_DELAY;
        return;
      }
      if (e.button !== 0) return;
      dragging = true;
      moved = false;
      startX = lastX = e.clientX;
      track.classList.add('is-dragging');
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    });

    // A drag shouldn't also "click" the link under the cursor when released.
    track.addEventListener('click', (e) => {
      if (suppressClick) {
        e.preventDefault();
        e.stopPropagation();
      }
    }, true);

    // Stop the browser's native link/image drag-and-drop from hijacking the gesture.
    track.addEventListener('dragstart', (e) => e.preventDefault());

    /* ---- wiring ---- */
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(([entry]) => {
        visible = entry.isIntersecting;
        syncLoop();
      }).observe(track);
    } else {
      visible = true;
      syncLoop();
    }

    motionListeners.add(syncLoop);

    const resizeObserver = new ResizeObserver(scheduleLayout);
    resizeObserver.observe(track);
    resizeObserver.observe(content);
  }

  document.querySelectorAll('.interactive-track').forEach(initTrack);
})();
