lucide.createIcons();

// Setup each interactive carousel row
document.querySelectorAll('.interactive-track').forEach((track) => {
  const content = track.querySelector('.track-content');

  // Duplicate items to create infinite looping capability
  const originalCards = Array.from(content.children);
  originalCards.forEach(card => content.appendChild(card.cloneNode(true)));
  originalCards.forEach(card => content.appendChild(card.cloneNode(true)));

  let isDown = false;
  let startX = 0;
  let scrollLeft = 0;
  let isHovered = false;
  const speed = parseFloat(track.getAttribute('data-speed')) || 0.8;

  // Mouse drag controls
  track.addEventListener('mousedown', (e) => {
    isDown = true;
    track.classList.add('is-dragging');
    startX = e.pageX - track.offsetLeft;
    scrollLeft = track.scrollLeft;
  });

  track.addEventListener('mouseleave', () => {
    isDown = false;
    isHovered = false;
    track.classList.remove('is-dragging');
  });

  track.addEventListener('mouseenter', () => {
    isHovered = true;
  });

  track.addEventListener('mouseup', () => {
    isDown = false;
    track.classList.remove('is-dragging');
  });

  track.addEventListener('mousemove', (e) => {
    if (!isDown) return;
    e.preventDefault();
    const x = e.pageX - track.offsetLeft;
    const walk = (x - startX) * 1.6;
    track.scrollLeft = scrollLeft - walk;
  });

  // Touch controls for Mobile & Tablet
  track.addEventListener('touchstart', () => { isHovered = true; }, { passive: true });
  track.addEventListener('touchend', () => { isHovered = false; }, { passive: true });

  // Constant auto-drift engine
  function autoScroll() {
    if (!isDown && !isHovered) {
      track.scrollLeft += speed;

      // Smooth seamless infinite reset
      const halfWidth = content.scrollWidth / 3;
      if (track.scrollLeft >= halfWidth * 2) {
        track.scrollLeft -= halfWidth;
      } else if (track.scrollLeft <= 0) {
        track.scrollLeft += halfWidth;
      }
    }
    requestAnimationFrame(autoScroll);
  }
  requestAnimationFrame(autoScroll);
});
