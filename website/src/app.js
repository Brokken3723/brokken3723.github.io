(() => {
  const body = document.body;
  const languages = ['en', 'zh'];
  const root = new URL(body.dataset.siteRoot, location.href);
  const storageKey = 'zhiyuan-ma-language';
  if (location.protocol === 'file:') {
    document.querySelectorAll('a[href]').forEach(link => {
      const target = new URL(link.getAttribute('href'), location.href);
      if (target.protocol === 'file:' && target.pathname.endsWith('/')) {
        target.pathname += 'index.html';
        link.href = target.href;
      }
    });
  }
  if (body.dataset.entry === 'true') {
    let language = body.dataset.defaultLanguage;
    try {
      const saved = localStorage.getItem(storageKey);
      if (languages.includes(saved)) language = saved;
    } catch { /* Navigation still works when browser storage is unavailable. */ }
    if (languages.includes(language)) {
      const target = `${language}/${location.protocol === 'file:' ? 'index.html' : ''}${location.hash}`;
      location.replace(new URL(target, root).href);
      return;
    }
  }
  try { localStorage.setItem(storageKey, body.dataset.language); } catch { /* Optional preference. */ }
  document.querySelectorAll('[data-language-switch]').forEach(link => {
    const target = new URL(link.href);
    target.hash = location.hash;
    link.href = target.href;
    link.addEventListener('click', () => {
      try { localStorage.setItem(storageKey, link.dataset.languageSwitch); } catch { /* Optional preference. */ }
    });
  });
  const carouselControllers = new Map();
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const wrapIndex = (index, length) => ((index % length) + length) % length;
  document.querySelectorAll('[data-still-carousel]').forEach(carousel => {
    const track = carousel.querySelector('[data-still-track]');
    const slides = Array.from(track.querySelectorAll('[data-image-viewer]'));
    const count = carousel.querySelector('[data-still-count]');
    if (!slides.length) return;
    let current = 0;
    let autoTimer;
    let inView = false;
    let swipeStart;
    let suppressClickUntil = 0;
    let wheelDelta = 0;
    let lastWheelAt = 0;
    let wheelLockedUntil = 0;
    function canAutoPlay() {
      const focused = document.activeElement;
      const keyboardFocus = carousel.contains(focused) && focused.matches(':focus-visible');
      return slides.length > 1 && !reducedMotion && inView && !document.hidden && !carousel.matches(':hover') && !keyboardFocus && !swipeStart && !document.querySelector('.image-viewer[open]');
    }
    function scheduleAuto() {
      clearTimeout(autoTimer);
      if (canAutoPlay()) autoTimer = setTimeout(() => select(current + 1), 4000);
    }
    function select(index, animate = true) {
      current = wrapIndex(index, slides.length);
      carousel.classList.toggle('is-instant', !animate || reducedMotion);
      count.textContent = `${current + 1} / ${slides.length}`;
      const previous = wrapIndex(current - 1, slides.length);
      const next = wrapIndex(current + 1, slides.length);
      slides.forEach((slide, position) => {
        const active = position === current;
        const before = slides.length > 2 && position === previous;
        const after = slides.length > 1 && position === next;
        slide.classList.toggle('is-current', active);
        slide.classList.toggle('is-previous', before);
        slide.classList.toggle('is-next', after);
        slide.inert = !active && !before && !after;
        slide.tabIndex = active ? 0 : -1;
        slide.setAttribute('aria-hidden', String(!active));
        if (active) slide.setAttribute('aria-current', 'true');
        else slide.removeAttribute('aria-current');
      });
      scheduleAuto();
    }
    carouselControllers.set(carousel, {select});
    carousel.querySelector('[data-still-previous]').addEventListener('click', () => select(current - 1));
    carousel.querySelector('[data-still-next]').addEventListener('click', () => select(current + 1));
    // A neighboring card brings it into focus; only the sharp central card
    // opens the full-size viewer. Also discard the click synthesized after a swipe.
    track.addEventListener('click', event => {
      if (performance.now() < suppressClickUntil) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      const slide = event.target.closest('.film-still-button');
      const index = slides.indexOf(slide);
      if (index >= 0 && index !== current) {
        event.preventDefault();
        select(index);
      }
    }, {capture: true});
    track.addEventListener('wheel', event => {
      if (event.ctrlKey || slides.length < 2 || !event.target.closest('.film-still-button')) return;
      const raw = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      if (!raw) return;
      event.preventDefault();
      const now = performance.now();
      const delta = raw * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? track.clientHeight : 1);
      if (now - lastWheelAt > 180 || Math.sign(delta) !== Math.sign(wheelDelta)) wheelDelta = 0;
      lastWheelAt = now;
      if (now < wheelLockedUntil) return;
      wheelDelta += delta;
      if (Math.abs(wheelDelta) < 48) return;
      select(current + Math.sign(wheelDelta));
      wheelDelta = 0;
      wheelLockedUntil = now + 380;
    }, {passive: false});
    track.addEventListener('pointerdown', event => {
      if (event.pointerType === 'mouse' || !event.isPrimary) return;
      swipeStart = {x: event.clientX, y: event.clientY, id: event.pointerId};
      scheduleAuto();
    }, {passive: true});
    track.addEventListener('pointermove', event => {
      if (!swipeStart || swipeStart.id !== event.pointerId) return;
      const dx = event.clientX - swipeStart.x;
      const dy = event.clientY - swipeStart.y;
      if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.3) track.setPointerCapture(event.pointerId);
    }, {passive: true});
    track.addEventListener('pointerup', event => {
      if (!swipeStart || swipeStart.id !== event.pointerId) return;
      const dx = event.clientX - swipeStart.x;
      const dy = event.clientY - swipeStart.y;
      swipeStart = null;
      if (Math.abs(dx) > 44 && Math.abs(dx) > Math.abs(dy) * 1.3) {
        suppressClickUntil = performance.now() + 400;
        select(current + (dx < 0 ? 1 : -1));
      } else scheduleAuto();
    }, {passive: true});
    track.addEventListener('pointercancel', () => { swipeStart = null; scheduleAuto(); }, {passive: true});
    carousel.addEventListener('keydown', event => {
      if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
      event.preventDefault();
      const focusSlide = slides.includes(document.activeElement);
      select(event.key === 'Home' ? 0 : event.key === 'End' ? slides.length - 1 : current + (event.key === 'ArrowRight' ? 1 : -1));
      if (focusSlide) slides[current].focus({preventScroll: true});
    });
    carousel.addEventListener('pointerenter',scheduleAuto);
    carousel.addEventListener('pointerleave',scheduleAuto);
    carousel.addEventListener('focusin',scheduleAuto);
    carousel.addEventListener('focusout',()=>setTimeout(scheduleAuto,0));
    document.addEventListener('visibilitychange',scheduleAuto);
    const viewer = document.querySelector('.image-viewer');
    if (viewer) {
      new MutationObserver(scheduleAuto).observe(viewer,{attributes:true,attributeFilter:['open']});
    }
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(entries=>{
        inView = entries[0].isIntersecting && entries[0].intersectionRatio >= .25;
        scheduleAuto();
      },{threshold:[0,.25]}).observe(track);
    } else inView = true;
    carousel.classList.add('is-ready');
    select(0,false);
  });
  const imageViewer = document.querySelector('.image-viewer');
  if (imageViewer) {
    const image = imageViewer.querySelector('.image-viewer-image');
    const previous = imageViewer.querySelector('[data-image-previous]');
    const next = imageViewer.querySelector('[data-image-next]');
    const count = imageViewer.querySelector('[data-image-count]');
    const stage = imageViewer.querySelector('.image-viewer-stage');
    const buttons = Array.from(document.querySelectorAll('[data-image-viewer]'));
    let collection = [];
    let current = 0;
    let opener;
    let swipeStart;
    function showImage(index) {
      current = wrapIndex(index, collection.length);
      opener = collection[current];
      image.src = opener.dataset.imageSrc;
      image.alt = opener.dataset.imageAlt;
      count.textContent = `${current + 1} / ${collection.length}`;
      previous.hidden = next.hidden = collection.length < 2;
      const carousel = opener.closest('[data-still-carousel]');
      if (carousel) carouselControllers.get(carousel).select(current, false);
    }
    buttons.forEach(button=>{
      button.addEventListener('click',event=>{
        if (event.defaultPrevented) return;
        collection = buttons.filter(item => item.dataset.imageGroup === button.dataset.imageGroup);
        showImage(collection.indexOf(button));
        imageViewer.showModal();
      });
    });
    previous.addEventListener('click', () => showImage(current - 1));
    next.addEventListener('click', () => showImage(current + 1));
    imageViewer.addEventListener('keydown', event => {
      if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
      event.preventDefault();
      showImage(event.key === 'Home' ? 0 : event.key === 'End' ? collection.length - 1 : current + (event.key === 'ArrowRight' ? 1 : -1));
    });
    stage.addEventListener('pointerdown', event => {
      if (event.pointerType === 'mouse' || !event.isPrimary) return;
      swipeStart = {x: event.clientX, y: event.clientY, id: event.pointerId};
    }, {passive: true});
    stage.addEventListener('pointerup', event => {
      if (!swipeStart || swipeStart.id !== event.pointerId) return;
      const dx = event.clientX - swipeStart.x;
      const dy = event.clientY - swipeStart.y;
      swipeStart = null;
      if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.3) showImage(current + (dx < 0 ? 1 : -1));
    }, {passive: true});
    stage.addEventListener('pointercancel', () => { swipeStart = null; }, {passive: true});
    imageViewer.querySelector('.image-viewer-close').addEventListener('click',()=>imageViewer.close());
    imageViewer.addEventListener('click',event=>{
      if (event.target !== imageViewer) return;
      const box = imageViewer.getBoundingClientRect();
      if (event.clientX<box.left || event.clientX>box.right || event.clientY<box.top || event.clientY>box.bottom) imageViewer.close();
    });
    imageViewer.addEventListener('close',()=>{ swipeStart = null; opener?.focus({preventScroll:true}); });
  }
})();
