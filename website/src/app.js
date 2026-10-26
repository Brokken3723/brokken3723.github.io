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
    const toggle = carousel.querySelector('[data-still-toggle]');
    if (!slides.length || !toggle) return;
    let current = 0;
    let pendingTarget = null;
    let scrollFrame;
    let autoTimer;
    let inView = false;
    let userPaused = reducedMotion;
    // Sentinels keep both wrap directions moving by one frame, rather than
    // scrolling backwards across the complete collection at its boundary.
    function cloneSlide(slide) {
      const clone = slide.cloneNode(true);
      for (const attribute of ['data-image-viewer','data-image-src','data-image-alt','data-image-group','aria-label']) clone.removeAttribute(attribute);
      clone.setAttribute('data-carousel-clone','');
      clone.setAttribute('aria-hidden','true');
      clone.tabIndex = -1;
      clone.inert = true;
      return clone;
    }
    track.prepend(cloneSlide(slides[slides.length - 1]));
    track.append(cloneSlide(slides[0]));
    function canAutoPlay() {
      const focused = document.activeElement;
      const keyboardFocus = carousel.contains(focused) && focused !== toggle && focused.matches(':focus-visible');
      return slides.length > 1 && !userPaused && inView && !document.hidden && !carousel.matches(':hover') && !keyboardFocus && !document.querySelector('.image-viewer[open]');
    }
    function scheduleAuto() {
      clearTimeout(autoTimer);
      if (canAutoPlay()) autoTimer = setTimeout(() => select(current + 1), 4000);
    }
    function updateToggle() {
      const label = userPaused ? toggle.dataset.playLabel : toggle.dataset.pauseLabel;
      toggle.textContent = label;
      toggle.setAttribute('aria-label',label);
      toggle.setAttribute('aria-pressed',String(userPaused));
    }
    function update(index) {
      current = index;
      count.textContent = `${index + 1} / ${slides.length}`;
      slides.forEach((slide, position) => { slide.inert = position !== index; });
    }
    function select(index, animate = true) {
      if (!track.clientWidth) return;
      if (pendingTarget !== null) {
        pendingTarget = null;
        track.scrollTo({left:(current + 1) * track.clientWidth,behavior:'instant'});
      }
      const next = wrapIndex(index, slides.length);
      const forwardWrap = current === slides.length - 1 && next === 0 && index > current;
      const backwardWrap = current === 0 && next === slides.length - 1 && index < current;
      const smooth = animate && !reducedMotion && (Math.abs(next - current) === 1 || forwardWrap || backwardWrap);
      const physical = smooth && forwardWrap ? slides.length + 1 : smooth && backwardWrap ? 0 : next + 1;
      pendingTarget = smooth ? physical : null;
      update(next);
      track.scrollTo({left:physical * track.clientWidth,behavior:smooth?'smooth':'instant'});
      scheduleAuto();
    }
    carouselControllers.set(carousel, {select});
    carousel.querySelector('[data-still-previous]').addEventListener('click', () => select(current - 1));
    carousel.querySelector('[data-still-next]').addEventListener('click', () => select(current + 1));
    track.addEventListener('scroll', () => {
      cancelAnimationFrame(scrollFrame);
      scrollFrame = requestAnimationFrame(() => {
        if (!track.clientWidth) return;
        const physical = Math.max(0,Math.min(slides.length + 1,Math.round(track.scrollLeft / track.clientWidth)));
        if (pendingTarget !== null && Math.abs(track.scrollLeft - pendingTarget * track.clientWidth) > 1) return;
        pendingTarget = null;
        const index = wrapIndex(physical - 1,slides.length);
        update(index);
        if ((physical === 0 || physical === slides.length + 1) && Math.abs(track.scrollLeft - physical * track.clientWidth) < 1) {
          track.scrollTo({left:(index + 1) * track.clientWidth,behavior:'instant'});
        }
      });
    }, {passive: true});
    track.addEventListener('pointerdown', () => { pendingTarget = null; }, {passive: true});
    track.addEventListener('wheel', () => { pendingTarget = null; }, {passive: true});
    carousel.addEventListener('keydown', event => {
      if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
      event.preventDefault();
      const focusSlide = slides.includes(document.activeElement);
      select(event.key === 'Home' ? 0 : event.key === 'End' ? slides.length - 1 : current + (event.key === 'ArrowRight' ? 1 : -1));
      if (focusSlide) slides[current].focus({preventScroll: true});
    });
    toggle.addEventListener('click',()=>{
      userPaused = !userPaused;
      updateToggle();
      scheduleAuto();
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
    if ('ResizeObserver' in window) new ResizeObserver(() => select(current, false)).observe(track);
    updateToggle();
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
      button.addEventListener('click',()=>{
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
