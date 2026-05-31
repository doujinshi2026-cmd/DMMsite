(() => {
  const shellSelector = ".sample-carousel-shell";

  function trackFor(shell) {
    return shell ? shell.querySelector(".sample-carousel") : null;
  }

  function slidesFor(track) {
    return [...track.querySelectorAll(".sample-slide")];
  }

  function currentIndex(track) {
    const slides = slidesFor(track);
    if (!slides.length) return 0;

    const center = track.scrollLeft + track.clientWidth / 2;
    let closestIndex = 0;
    let closestDistance = Number.POSITIVE_INFINITY;

    slides.forEach((slide, index) => {
      const slideCenter = slide.offsetLeft + slide.clientWidth / 2;
      const distance = Math.abs(slideCenter - center);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestIndex = index;
      }
    });

    return closestIndex;
  }

  function update(shell) {
    const track = trackFor(shell);
    if (!track) return;

    const slides = slidesFor(track);
    const index = currentIndex(track);
    const page = shell.querySelector("[data-sample-page]");
    const total = shell.querySelector("[data-sample-total]");
    const prev = shell.querySelector('[data-sample-nav="-1"]');
    const next = shell.querySelector('[data-sample-nav="1"]');

    if (page) page.textContent = String(Math.min(index + 1, slides.length || 1));
    if (total) total.textContent = String(slides.length || 1);
    if (prev) prev.disabled = index <= 0;
    if (next) next.disabled = index >= slides.length - 1;
  }

  function move(shell, direction) {
    const track = trackFor(shell);
    if (!track) return;

    const slides = slidesFor(track);
    if (slides.length <= 1) return;

    const nextIndex = Math.max(0, Math.min(slides.length - 1, currentIndex(track) + direction));
    slides[nextIndex].scrollIntoView({ behavior: "smooth", block: "nearest", inline: "start" });
    window.setTimeout(() => update(shell), 380);
  }

  function refresh(root = document) {
    root.querySelectorAll(shellSelector).forEach((shell) => {
      const track = trackFor(shell);
      if (!track) return;

      if (!track.dataset.sampleCarouselReady) {
        track.dataset.sampleCarouselReady = "1";
        track.addEventListener(
          "scroll",
          () => window.requestAnimationFrame(() => update(shell)),
          { passive: true }
        );
      }

      update(shell);
    });
  }

  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-sample-nav]");
    if (!button) return;

    const shell = button.closest(shellSelector);
    if (!shell) return;

    event.preventDefault();
    event.stopPropagation();
    move(shell, Number(button.dataset.sampleNav || 0));
  });

  window.DmmSampleCarousel = { refresh };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => refresh());
  } else {
    refresh();
  }
})();
