/* Optional Mainsail 2.x integration. No Vue internals or printer commands. */
(() => {
  'use strict';
  if (window.top !== window || window.PrintRescueMainsailEmbed) return;
  window.PrintRescueMainsailEmbed = true;

  let panel, frame, backButton, main, page, topbar, returnFocus;
  let opened = false, previousInert = false, pendingLayout = 0;
  let resizeObserver, mainObserver;
  const isRescue = url => url.origin === location.origin &&
    /^\/print-rescue\/(?:index\.html)?$/.test(url.pathname);
  const style = document.createElement('style');
  style.textContent = `
    #print-rescue-panel { position:fixed; z-index:2; display:flex; flex-direction:column;
      background:#111923; color:#e5edf5; font:14px system-ui,sans-serif; }
    #print-rescue-panel[hidden] { display:none !important; }
    #print-rescue-panel .pr-embed-toolbar { display:flex; align-items:center; flex-wrap:wrap;
      gap:12px; padding:8px 14px; border-bottom:1px solid #344353; }
    #print-rescue-panel button { font:inherit; background:#243447; color:inherit;
      border:1px solid #536679; border-radius:5px; padding:7px 12px; cursor:pointer; }
    #print-rescue-panel a { color:#a9d4fc; margin-left:auto; }
    #print-rescue-panel iframe { flex:1; width:100%; min-height:0; border:0; }
    body.pr-embed-open { overflow:hidden !important; }
    body.pr-embed-open #page-container { visibility:hidden !important; }
    a.pr-embed-selected { background:rgba(100,180,240,.15) !important; }
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
