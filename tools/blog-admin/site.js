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

  function isWeeklyShell(shell) {
    return shell.classList.contains("sample-carousel-shell-weekly");
  }

  function slideHeight(slide, track) {
    const image = slide?.querySelector("img");
    if (image?.naturalWidth && image?.naturalHeight && track.clientWidth) {
      return Math.max(1, Math.round((track.clientWidth * image.naturalHeight) / image.naturalWidth));
    }
    return slide?.offsetHeight || 0;
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
    const height = isWeeklyShell(shell) ? slideHeight(slides[index], track) : slides[index]?.offsetHeight || 0;
    if (height) {
      track.style.height = `${height}px`;
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
            if (isWeeklyShell(shell)) {
              const slides = slidesFor(track);
              const nextIndex = clampIndex(currentIndex(track), slides);
              if (nextIndex === Number(shell.dataset.sampleCarouselIndex)) return;
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

  function normalizeSuggestionText(value) {
    return String(value || "").normalize("NFKC").trim().toLowerCase();
  }

  function genreToken(value) {
    const match = String(value || "").match(/^(.*?)([^\s\u3000,、，]*)$/u);
    return {
      prefix: match?.[1] || "",
      term: match?.[2] || "",
    };
  }

  function suggestionTerm(input, fieldName) {
    return fieldName === "genre" ? genreToken(input.value).term : input.value;
  }

  function applySuggestion(input, fieldName, value) {
    if (fieldName === "genre") {
      const token = genreToken(input.value);
      input.value = `${token.prefix}${value}`;
    } else {
      input.value = value;
    }
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function fieldValue(form, name) {
    return normalizeSuggestionText(form.elements[name]?.value || "");
  }

  function matchesSuggestionContext(fieldName, item, form) {
    const circle = fieldValue(form, "circle");
    const author = fieldValue(form, "author");
    const circles = (item.circles || []).map(normalizeSuggestionText);
    const authors = (item.authors || []).map(normalizeSuggestionText);

    if (fieldName === "author" && circle) {
      return !circles.length || circles.includes(circle);
    }
    if (fieldName === "genre") {
      if (circle && circles.length && !circles.includes(circle)) return false;
      if (author && authors.length && !authors.includes(author)) return false;
    }
    return true;
  }

  function rankedSuggestions(data, fieldName, input, form) {
    const rawTerm = suggestionTerm(input, fieldName);
    const term = normalizeSuggestionText(rawTerm);
    const source =
      fieldName === "q"
        ? [
            ...(data.q || []),
            ...(data.circle || []),
            ...(data.author || []),
            ...(data.genre || []),
            ...(data.tag || []),
          ]
        : data[fieldName] || [];
    return source
      .filter((item) => matchesSuggestionContext(fieldName, item, form))
      .map((item) => {
        const value = normalizeSuggestionText(item.value);
        const matchScore = !term ? 1 : value.startsWith(term) ? 3 : value.includes(term) ? 2 : 0;
        return { ...item, matchScore };
      })
      .filter((item) => item.matchScore > 0)
      .sort((a, b) => {
        if (a.matchScore !== b.matchScore) return b.matchScore - a.matchScore;
        if ((a.count || 0) !== (b.count || 0)) return (b.count || 0) - (a.count || 0);
        return String(a.value || "").localeCompare(String(b.value || ""), "ja");
      })
      .slice(0, 7);
  }

  function hideSuggestMenu(field) {
    const input = field.querySelector("[data-suggest-input]");
    const menu = field.querySelector("[data-suggest-menu]");
    if (!menu || !input) return;
    menu.hidden = true;
    menu.replaceChildren();
    field.dataset.suggestActiveIndex = "-1";
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
  }

  function setSuggestActive(field, index) {
    const input = field.querySelector("[data-suggest-input]");
    const menu = field.querySelector("[data-suggest-menu]");
    const options = menu ? [...menu.querySelectorAll(".suggest-option")] : [];
    const nextIndex = options.length ? Math.max(0, Math.min(index, options.length - 1)) : -1;
    field.dataset.suggestActiveIndex = String(nextIndex);
    options.forEach((option, optionIndex) => {
      const active = optionIndex === nextIndex;
      option.classList.toggle("active", active);
      option.setAttribute("aria-selected", active ? "true" : "false");
      if (active && input) input.setAttribute("aria-activedescendant", option.id);
    });
    if (nextIndex < 0 && input) input.removeAttribute("aria-activedescendant");
  }

  function showSuggestMenu(field, data, form) {
    const fieldName = field.dataset.suggestField || "";
    const input = field.querySelector("[data-suggest-input]");
    const menu = field.querySelector("[data-suggest-menu]");
    if (!input || !menu || !fieldName) return;

    const suggestions = rankedSuggestions(data, fieldName, input, form);
    if (!suggestions.length) {
      hideSuggestMenu(field);
      return;
    }

    menu.replaceChildren();
    suggestions.forEach((item, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "suggest-option";
      button.id = `${menu.id}-option-${index}`;
      button.setAttribute("role", "option");
      button.setAttribute("aria-selected", "false");
      button.dataset.suggestValue = item.value;

      const value = document.createElement("strong");
      value.textContent = item.value;
      const meta = document.createElement("small");
      meta.textContent = `${item.type || "候補"}${item.count ? ` ${item.count}件` : ""}`;
      button.append(value, meta);
      menu.append(button);
    });

    menu.hidden = false;
    input.setAttribute("aria-expanded", "true");
    setSuggestActive(field, -1);
  }

  function initSearchSuggestions(root = document) {
    const form = root.querySelector ? root.querySelector("[data-suggest-form]") : document.querySelector("[data-suggest-form]");
    if (!form) return;

    const script = root.getElementById
      ? root.getElementById("site-search-suggestions")
      : document.getElementById("site-search-suggestions");
    let dataPromise;

    function loadData() {
      if (dataPromise) return dataPromise;

      if (script?.textContent?.trim()) {
        dataPromise = Promise.resolve()
          .then(() => JSON.parse(script.textContent || "{}"))
          .catch(() => ({}));
        return dataPromise;
      }

      const source = form.dataset.suggestUrl || "";
      if (!source) {
        dataPromise = Promise.resolve({});
        return dataPromise;
      }

      dataPromise = fetch(source, {
        headers: { Accept: "application/json" },
      })
        .then((response) => {
          if (!response.ok) throw new Error(`suggestions request failed: ${response.status}`);
          return response.json();
        })
        .catch(() => ({}));
      return dataPromise;
    }

    const fields = [...form.querySelectorAll("[data-suggest-field]")];
    fields.forEach((field) => {
      const input = field.querySelector("[data-suggest-input]");
      const menu = field.querySelector("[data-suggest-menu]");
      if (!input || !menu) return;

      const updateMenu = async () => {
        const data = await loadData();
        if (document.activeElement === input) showSuggestMenu(field, data, form);
      };

      input.addEventListener("focus", updateMenu);
      input.addEventListener("input", updateMenu);
      input.addEventListener("keydown", (event) => {
        const currentIndex = Number(field.dataset.suggestActiveIndex || -1);
        if (event.key === "ArrowDown") {
          event.preventDefault();
          if (menu.hidden) {
            void updateMenu();
            return;
          }
          setSuggestActive(field, currentIndex + 1);
        } else if (event.key === "ArrowUp") {
          event.preventDefault();
          if (menu.hidden) {
            void updateMenu();
            return;
          }
          const options = [...menu.querySelectorAll(".suggest-option")];
          setSuggestActive(field, currentIndex <= 0 ? options.length - 1 : currentIndex - 1);
        } else if (event.key === "Enter" && !menu.hidden && currentIndex >= 0) {
          const options = [...menu.querySelectorAll(".suggest-option")];
          if (!options[currentIndex]) return;
          event.preventDefault();
          applySuggestion(input, field.dataset.suggestField, options[currentIndex].dataset.suggestValue || "");
          hideSuggestMenu(field);
        } else if (event.key === "Escape") {
          hideSuggestMenu(field);
        }
      });

      menu.addEventListener("pointerdown", (event) => event.preventDefault());
      menu.addEventListener("click", (event) => {
        const option = event.target.closest(".suggest-option");
        if (!option) return;
        applySuggestion(input, field.dataset.suggestField, option.dataset.suggestValue || "");
        hideSuggestMenu(field);
        input.focus();
      });
    });

    document.addEventListener("pointerdown", (event) => {
      fields.forEach((field) => {
        if (!field.contains(event.target)) hideSuggestMenu(field);
      });
    });
  }

  function initFilterDisclosure(root = document) {
    const disclosure = root.querySelector
      ? root.querySelector("[data-filter-disclosure]")
      : document.querySelector("[data-filter-disclosure]");
    if (!disclosure) return;

    const mobile = window.matchMedia("(max-width: 760px)").matches;
    disclosure.open = !mobile;
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

  function ready() {
    refresh();
    initFilterDisclosure();
    initSearchSuggestions();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", ready);
  } else {
    ready();
  }
})();
