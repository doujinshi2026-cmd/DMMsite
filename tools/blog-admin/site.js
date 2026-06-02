(() => {
  const shellSelector = ".sample-carousel-shell";
  const scrollTimers = new WeakMap();
  const updateFrames = new WeakMap();

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

  function clampIndex(index, slides) {
    if (!slides.length) return 0;
    return Math.max(0, Math.min(slides.length - 1, index));
  }

  function wrapIndex(index, slides) {
    if (!slides.length) return 0;
    return ((index % slides.length) + slides.length) % slides.length;
  }

  function storedIndex(shell, track, slides) {
    const value = Number(shell.dataset.sampleCarouselIndex);
    return Number.isInteger(value) ? clampIndex(value, slides) : currentIndex(track);
  }

  function writeState(shell, index, slides, track) {
    const page = shell.querySelector("[data-sample-page]");
    const total = shell.querySelector("[data-sample-total]");
    const prev = shell.querySelector('[data-sample-nav="-1"]');
    const next = shell.querySelector('[data-sample-nav="1"]');

    if (page) page.textContent = String(Math.min(index + 1, slides.length || 1));
    if (total) total.textContent = String(slides.length || 1);
    if (prev) prev.disabled = slides.length <= 1;
    if (next) next.disabled = slides.length <= 1;
    if (slides[index]?.offsetHeight) {
      track.style.height = `${slides[index].offsetHeight}px`;
    }
  }

  function update(shell) {
    const track = trackFor(shell);
    if (!track) return;

    const slides = slidesFor(track);
    const index = clampIndex(currentIndex(track), slides);
    shell.dataset.sampleCarouselIndex = String(index);
    writeState(shell, index, slides, track);
  }

  function requestUpdate(shell) {
    const track = trackFor(shell);
    if (!track || updateFrames.has(track)) return;

    updateFrames.set(
      track,
      window.requestAnimationFrame(() => {
        updateFrames.delete(track);
        update(shell);
      })
    );
  }

  function finishProgrammaticScroll(shell) {
    const track = trackFor(shell);
    if (!track) return;

    window.clearTimeout(scrollTimers.get(track));
    scrollTimers.set(
      track,
      window.setTimeout(() => {
        delete track.dataset.sampleCarouselMoving;
        update(shell);
      }, 220)
    );
  }

  function move(shell, direction) {
    const track = trackFor(shell);
    if (!track) return;

    const slides = slidesFor(track);
    if (slides.length <= 1) return;

    const nextIndex = wrapIndex(storedIndex(shell, track, slides) + direction, slides);
    shell.dataset.sampleCarouselIndex = String(nextIndex);
    writeState(shell, nextIndex, slides, track);

    track.dataset.sampleCarouselMoving = "1";
    const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
    if (typeof track.scrollTo === "function") {
      track.scrollTo({ left: slides[nextIndex].offsetLeft, behavior });
    } else {
      track.scrollLeft = slides[nextIndex].offsetLeft;
    }
    finishProgrammaticScroll(shell);
  }

  function refresh(root = document) {
    root.querySelectorAll(shellSelector).forEach((shell) => {
      const track = trackFor(shell);
      if (!track) return;

      if (!track.dataset.sampleCarouselReady) {
        track.dataset.sampleCarouselReady = "1";
        track.addEventListener(
          "scroll",
          () => {
            if (track.dataset.sampleCarouselMoving) {
              finishProgrammaticScroll(shell);
              return;
            }
            requestUpdate(shell);
          },
          { passive: true }
        );
      }

      track.querySelectorAll("img").forEach((image) => {
        if (image.dataset.sampleCarouselImageReady) return;
        image.dataset.sampleCarouselImageReady = "1";
        image.addEventListener("load", () => update(shell), { once: true });
      });

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
