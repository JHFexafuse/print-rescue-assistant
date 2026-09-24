/* Optional Mainsail 2.x integration. No Vue internals or printer commands. */
(() => {
  'use strict';
  if (window.top !== window || window.PrintRescueMainsailEmbed) return;
  window.PrintRescueMainsailEmbed = true;

  let panel, frame, backButton, main, page, topbar, returnFocus;
  let opened = false, previousInert = false, pendingLayout = 0;
  let resizeObserver, mainObserver, themeObserver, pendingTheme = 0;
  const isRescue = url => url.origin === location.origin &&
    /^\/print-rescue\/(?:index\.html)?$/.test(url.pathname);
  const style = document.createElement('style');
  style.textContent = `
    #print-rescue-panel { position:fixed; z-index:2; display:flex; flex-direction:column;
      background:var(--pr-bg,#121212); color:var(--pr-text,#fff);
      font:14px var(--pr-font,Roboto,"Segoe UI",Arial,sans-serif); }
    #print-rescue-panel[hidden] { display:none !important; }
    #print-rescue-panel .pr-embed-toolbar { display:flex; align-items:center; flex-wrap:wrap;
      gap:12px; min-height:48px; padding:6px 16px; background:var(--pr-toolbar,#272727);
      border-bottom:1px solid var(--pr-line,rgba(255,255,255,.12)); }
    #print-rescue-panel button { font:inherit; font-size:12px; font-weight:500;
      text-transform:uppercase; letter-spacing:.75px; background:transparent; color:inherit;
      border:1px solid var(--pr-line,rgba(255,255,255,.12)); border-radius:4px; padding:7px 12px; cursor:pointer; }
    #print-rescue-panel button:hover { background:var(--pr-hover,rgba(255,255,255,.08)); }
    #print-rescue-panel a { color:var(--pr-accent,#2196f3); margin-left:auto; font-size:12px; }
    #print-rescue-panel button:focus-visible,#print-rescue-panel a:focus-visible {
      outline:2px solid var(--pr-accent,#2196f3); outline-offset:2px; }
    #print-rescue-panel iframe { flex:1; width:100%; min-height:0; border:0; }
    body.pr-embed-open { overflow:hidden !important; }
    body.pr-embed-open #page-container { visibility:hidden !important; }
    a.pr-embed-selected { border-right:4px solid var(--color-primary,var(--v-primary-base,#2196f3)); }
    body.pr-embed-open .v-navigation-drawer .active-nav-item:not(.pr-embed-selected) {
      border-right-color:transparent; }
  `;
  document.head.append(style);

  function markLinks() {
    for (const link of document.querySelectorAll('a[href]')) {
      if (isRescue(new URL(link.href, location.href)) && !panel?.contains(link)) {
        link.classList.toggle('pr-embed-selected', opened);
      }
    }
  }

  function close(restoreFocus = false) {
    if (!opened) return;
    opened = false;
    panel.hidden = true;
    document.body.classList.remove('pr-embed-open');
    page.inert = previousInert;
    resizeObserver?.disconnect();
    mainObserver?.disconnect();
    markLinks();
    if (restoreFocus && returnFocus?.isConnected) returnFocus.focus();
    // Do not remove/reparent the iframe: that would discard the loaded G-code
    // and the in-memory recovery session when switching to Mainsail controls.
  }

  function layout() {
    pendingLayout = 0;
    if (!opened) return;
    if (!main.isConnected || !page.isConnected || !topbar.isConnected) {
      close(); // Let Mainsail show its connection/printer-selection dialog.
      return;
    }
    const rect = main.getBoundingClientRect();
    const css = getComputedStyle(main);
    const pixels = value => parseFloat(value) || 0;
    const left = Math.max(0, rect.left + pixels(css.paddingLeft));
    const right = Math.max(0, window.innerWidth - rect.right + pixels(css.paddingRight));
    const top = Math.max(0, pixels(css.paddingTop), topbar.getBoundingClientRect().bottom);
    const bottom = Math.max(0, pixels(css.paddingBottom));
    Object.assign(panel.style, {left: left+'px', right: right+'px', top: top+'px', bottom: bottom+'px'});
  }

  function scheduleLayout() {
    if (opened && !pendingLayout) pendingLayout = requestAnimationFrame(layout);
  }

  function syncTheme() {
    pendingTheme = 0;
    if (!panel) return;
    const app = document.querySelector('.v-application');
    const root = document.documentElement;
    const light = (app || root).classList.contains('theme--light') || root.classList.contains('theme--light');
    const css = getComputedStyle(app || root);
    const color = (element, fallback, property='backgroundColor') => {
      const value = element && getComputedStyle(element)[property];
      return value && value !== 'transparent' && !/rgba\([^)]*,\s*0(?:\.0+)?\s*\)/.test(value) ? value : fallback;
    };
    const card = main?.querySelector('.v-card');
    const toolbar = main?.querySelector('.panel-toolbar');
    const values = {
      bg:color(main, color(app, light ? '#fff' : '#121212')),
      panel:color(card, light ? '#fff' : '#1e1e1e'),
      toolbar:color(toolbar, light ? '#f5f5f5' : '#272727'),
      field:light ? '#fafafa' : '#242424',
      text:color(app, light ? 'rgba(0,0,0,.87)' : '#fff', 'color'),
      muted:light ? 'rgba(0,0,0,.6)' : 'rgba(255,255,255,.7)',
      line:light ? 'rgba(0,0,0,.12)' : 'rgba(255,255,255,.12)',
      hover:light ? 'rgba(0,0,0,.06)' : 'rgba(255,255,255,.08)',
      accent:css.getPropertyValue('--color-primary').trim() || css.getPropertyValue('--v-primary-base').trim() || '#2196f3',
      'accent-text':css.getPropertyValue('--v-btn-text-primary').trim() || '#fff',
      green:css.getPropertyValue('--v-success-base').trim() || '#4caf50',
      warning:css.getPropertyValue('--color-warning').trim() || '#fb8c00',
      error:css.getPropertyValue('--v-error-base').trim() || '#ff5252',
      'font-family':css.fontFamily || 'Roboto,"Segoe UI",Arial,sans-serif',
    };
    for (const [key,value] of Object.entries(values)) panel.style.setProperty('--pr-'+(key==='font-family'?'font':key), value);
    const doc = frame?.contentDocument;
    if (!doc?.getElementById('scene')) return;
    doc.documentElement.dataset.theme = light ? 'light' : 'dark';
    for (const [key,value] of Object.entries(values)) doc.documentElement.style.setProperty('--'+key, value);
    if (!doc.getElementById('mainsail-local-fonts')) {
      const fonts = doc.createElement('style');
      fonts.id = 'mainsail-local-fonts';
      // The existing Mainsail font files, all from this same printer origin.
      // Standalone/offline PrintRescue keeps its system-font fallback.
      fonts.textContent = `
        @font-face { font-family:Roboto; font-style:normal; font-weight:400; font-display:swap;
          src:url('/fonts/roboto-regular.woff2') format('woff2'); }
        @font-face { font-family:Roboto; font-style:normal; font-weight:500; font-display:swap;
          src:url('/fonts/roboto-medium.woff2') format('woff2'); }
        @font-face { font-family:'Roboto Mono'; font-style:normal; font-weight:400; font-display:swap;
          src:url('/fonts/robotoMono-regular.woff') format('woff'); }
      `;
      doc.head.append(fonts);
    }
  }

  function watchTheme() {
    themeObserver?.disconnect();
    themeObserver = new MutationObserver(() => {
      if (!pendingTheme) pendingTheme = requestAnimationFrame(syncTheme);
    });
    const options = {attributes:true, attributeFilter:['class','style']};
    themeObserver.observe(document.documentElement, options);
    const app = document.querySelector('.v-application');
    if (app) themeObserver.observe(app, options);
    themeObserver.observe(document.head, {childList:true, subtree:true, characterData:true});
    syncTheme();
  }

  function createPanel() {
    panel = document.createElement('section');
    panel.id = 'print-rescue-panel';
    panel.setAttribute('aria-label', 'Druck retten');
    panel.hidden = true;
    const toolbar = document.createElement('div');
    toolbar.className = 'pr-embed-toolbar';
    backButton = document.createElement('button');
    backButton.type = 'button';
    backButton.textContent = 'Zurück zu Mainsail';
    backButton.addEventListener('click', () => close(true));
    const separate = document.createElement('a');
    separate.href = '/print-rescue/';
    separate.target = '_blank';
    separate.rel = 'noopener';
    separate.textContent = 'Separat öffnen ↗';
    toolbar.append(backButton, separate);
    frame = document.createElement('iframe');
    frame.title = 'PrintRescue Assistant';
    frame.hidden = true;
    frame.addEventListener('load', syncTheme);
    const loading = document.createElement('p');
    loading.style.padding = '16px';
    loading.textContent = 'PrintRescue wird geladen …';
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.textContent = 'Erneut laden';
    retry.hidden = true;
    async function loadFrame() {
      retry.hidden = true;
      loading.textContent = 'PrintRescue wird geladen …';
      try {
        // Fetch as an asset: Mainsail's service worker otherwise treats iframe
        // navigation as a Mainsail route and can return its dashboard HTML.
        const response = await fetch('/print-rescue/index.html', {cache:'no-store', credentials:'same-origin'});
        if (!response.ok) throw new Error('HTTP '+response.status);
        const html = await response.text();
        if (!html.includes('id="parser-source"')) throw new Error('PrintRescue-Datei nicht gefunden');
        frame.srcdoc = html;
        frame.hidden = false;
        loading.hidden = true;
      } catch (error) {
        loading.textContent = 'PrintRescue konnte nicht geladen werden: '+error.message+'. Installation prüfen.';
        retry.hidden = false;
      }
    }
    retry.addEventListener('click', loadFrame);
    panel.append(toolbar, loading, retry, frame);
    // Outside Vue's rendered tree so route changes never recreate the iframe.
    document.body.append(panel);
    loadFrame();
  }

  function open(link) {
    main = document.querySelector('main#content');
    page = main?.querySelector('#page-container');
    topbar = document.querySelector('header.topbar');
    if (!main || !page || !topbar) return false; // Standalone link remains usable.
    if (!panel) createPanel();
    if (!opened) {
      previousInert = page.inert;
      page.inert = true;
      opened = true;
      panel.hidden = false;
      document.body.classList.add('pr-embed-open');
      returnFocus = link;
      if (typeof ResizeObserver !== 'undefined') {
        resizeObserver = new ResizeObserver(scheduleLayout);
        for (const node of [main, page, topbar]) resizeObserver.observe(node);
      }
      mainObserver = new MutationObserver(scheduleLayout);
      mainObserver.observe(main, {attributes:true, attributeFilter:['style', 'class']});
    }
    layout();
    watchTheme();
    markLinks();
    backButton.focus();
    return true;
  }

  document.addEventListener('click', event => {
    if (event.defaultPrevented || event.button !== 0 || event.ctrlKey ||
        event.metaKey || event.shiftKey || event.altKey) return;
    const link = event.target.closest?.('a[href]');
    if (!link || link.hasAttribute('download') || panel?.contains(link)) return;
    const url = new URL(link.href, location.href);
    if (isRescue(url)) {
      if (open(link)) {
        event.preventDefault();
        event.stopPropagation();
      }
    } else if (opened && url.origin === location.origin && link.target !== '_blank' &&
               link.closest('.v-navigation-drawer, header.topbar')) {
      close();
    }
  }, true);
  window.addEventListener('resize', scheduleLayout);
  window.addEventListener('popstate', () => close());
  window.addEventListener('hashchange', () => close());
  // A disconnected Mainsail replaces its application content. Keep the iframe
  // mounted but hidden; no automatic reconnection or printer action is triggered.
  new MutationObserver(() => {
    if (opened && (!main.isConnected || !page.isConnected || !topbar.isConnected)) close();
  }).observe(document.body, {childList:true, subtree:true});
})();
