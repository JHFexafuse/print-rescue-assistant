// DOM/event simulation of the shipped loader, not a rendered browser test.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../integration/mainsail-embed.js', import.meta.url), 'utf8');

function harness({missingLayout = false, fetchFails = false} = {}) {
  const location = {origin:'http://printer.test', href:'http://printer.test/console'};
  let activeElement, nextFrame = 0;
  const events = {}, frames = new Map(), observers = [], requests = [];
  class Element {
    constructor(tag) {
      this.tagName = tag.toUpperCase(); this.children = []; this.parentElement = null;
      this.style = {setProperty(name,value){this[name]=value;}}; this.attrs = new Map(); this.hidden = false; this.inert = false;
      this.dataset = {}; this.cssVariables = {}; this.computed = {};
      this.listeners = {}; this.target = ''; this.id = ''; this.textContent = '';
      const classes = new Set();
      this.classList = {add:name=>classes.add(name), remove:name=>classes.delete(name),
        contains:name=>classes.has(name), toggle:(name,on)=>on ? classes.add(name) : classes.delete(name)};
    }
    append(...children) {for (const child of children) {child.parentElement = this; this.children.push(child);}}
    setAttribute(name, value) {this.attrs.set(name, value);}
    hasAttribute(name) {return this.attrs.has(name);}
    get isConnected() {return this === document.body || this === document.head || !!this.parentElement?.isConnected;}
    contains(node) {return this === node || this.children.some(child=>child.contains(node));}
    matches(selector) {
      if (selector === 'a[href]') return this.tagName === 'A' && !!this.href;
      if (selector === 'main#content') return this.tagName === 'MAIN' && this.id === 'content';
      if (selector === 'header.topbar') return this.tagName === 'HEADER' && this.classList.contains('topbar');
      if (selector.startsWith('#')) return this.id === selector.slice(1);
      if (selector.startsWith('.')) return this.classList.contains(selector.slice(1));
      return false;
    }
    querySelectorAll(selector) {return this.children.flatMap(child=>[...(child.matches(selector)?[child]:[]), ...child.querySelectorAll(selector)]);}
    querySelector(selector) {return this.querySelectorAll(selector)[0];}
    closest(selector) {return selector.split(',').some(part=>this.matches(part.trim())) ? this : this.parentElement?.closest(selector);}
    addEventListener(name, callback) {(this.listeners[name] ??= []).push(callback);}
    async emit(name) {for (const callback of this.listeners[name] ?? []) await callback({target:this});}
    focus() {activeElement = this;}
    getBoundingClientRect() {return this.rect ?? {left:0, right:1280, top:0, bottom:64};}
  }
  const document = {
    createElement:tag=>new Element(tag),
    querySelectorAll:selector=>document.body.querySelectorAll(selector),
    querySelector:selector=>document.body.querySelector(selector),
    addEventListener:(name, callback)=>{(events['document:'+name] ??= []).push(callback);},
  };
  document.body = new Element('body'); document.head = new Element('head');
  document.documentElement = new Element('html'); document.documentElement.classList.add('theme--dark');
  const application = new Element('div'); application.classList.add('v-application'); application.classList.add('theme--dark');
  application.computed = {backgroundColor:'#121212', color:'#fff', fontFamily:'Roboto,sans-serif'};
  application.cssVariables = {'--color-primary':'#2196f3', '--v-btn-text-primary':'#fff'};
  document.body.append(application);
  const main = new Element('main'); main.id = 'content';
  main.padding = {paddingLeft:'220px', paddingRight:'0px', paddingTop:'64px', paddingBottom:'0px'};
  const page = new Element('div'); page.id = 'page-container'; main.append(page);
  const topbar = new Element('header'); topbar.classList.add('topbar');
  const stop = new Element('button'); topbar.append(stop);
  const sidebar = new Element('nav'); sidebar.classList.add('v-navigation-drawer');
  const rescue = new Element('a'); rescue.href = location.origin+'/print-rescue/'; rescue.target = '_self';
  const nested = new Element('span'); rescue.append(nested);
  const consoleLink = new Element('a'); consoleLink.href = location.origin+'/console';
  sidebar.append(rescue, consoleLink);
  application.append(sidebar, topbar);
  if (!missingLayout) application.append(main);
  const window = {innerWidth:1280, addEventListener:(name, callback)=>{(events['window:'+name] ??= []).push(callback);}};
  window.top = window;
  class Observer {
    constructor(callback) {this.callback = callback; observers.push(this);}
    observe() {} disconnect() {}
  }
  const context = vm.createContext({document, window, location, URL, console,
    getComputedStyle:element=>({...element.computed, ...element.padding, getPropertyValue:name=>element.cssVariables[name] ?? ''}), MutationObserver:Observer, ResizeObserver:Observer,
    requestAnimationFrame:callback=>{frames.set(++nextFrame,callback); return nextFrame;},
    fetch:async(url, options)=>{
      requests.push({url, options});
      if (url !== '/print-rescue/index.html') throw new Error('Unexpected network request '+url);
      if (fetchFails) throw new Error('Offline');
      return {ok:true, text:async()=>'<html><script id="parser-source"></script></html>'};
    },
  });
  vm.runInContext(source, context);
  function click(target = nested, options = {}) {
    const event = {target, button:0, defaultPrevented:false, stopped:false,
      preventDefault(){this.defaultPrevented=true;}, stopPropagation(){this.stopped=true;}, ...options};
    for (const handler of events['document:click']) handler(event);
    return event;
  }
  return {document, window, main, page, topbar, sidebar, stop, rescue, consoleLink, requests, context, application,
    attachFrameDocument:()=>{
      const root = new Element('html'), head = new Element('head');
      const doc = {documentElement:root, head, createElement:tag=>new Element(tag),
        getElementById:id=>id==='scene' ? new Element('canvas') : head.querySelector('#'+id)};
      document.querySelector('#print-rescue-panel').children.find(child=>child.tagName==='IFRAME').contentDocument = doc;
      return doc;
    },
    click, panel:()=>document.querySelector('#print-rescue-panel'),
    frame:()=>document.querySelector('#print-rescue-panel')?.children.find(child=>child.tagName==='IFRAME'),
    focus:()=>activeElement, flush:()=>{for (const [key, fn] of [...frames]) {frames.delete(key); fn();}},
    mutate:()=>observers.forEach(observer=>observer.callback()),
    emit:name=>(events['window:'+name] ?? []).forEach(fn=>fn()),
  };
}

test('ordinary click opens inside content, leaving the topbar and emergency button available', async () => {
  const app = harness();
  assert.equal(app.frame(), undefined);
  assert.equal(app.requests.length, 0);
  const event = app.click();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(event.defaultPrevented, true);
  assert.equal(app.panel().hidden, false);
  assert.equal(app.panel().style.left, '220px');
  assert.equal(app.panel().style.top, '64px');
  assert.equal(app.page.inert, true);
  assert.equal(app.topbar.inert, false);
  assert.equal(app.click(app.stop).defaultPrevented, false);
  assert.equal(app.panel().hidden, false);
  assert.match(app.frame().srcdoc, /parser-source/);
  assert.equal(app.frame().hidden, false);
  assert.deepEqual(app.requests.map(request=>request.url), ['/print-rescue/index.html']);
});

test('Mainsail navigation and back button retain the same iframe, file and layer session', async () => {
  const app = harness(); app.click();
  const frame = app.frame(); frame.simulatedSelection = {file:'large.gcode', layer:1000, token:123};
  const content = app.panel();
  assert.equal(app.click(app.consoleLink).defaultPrevented, false);
  assert.equal(content.hidden, true);
  assert.equal(app.page.inert, false);
  app.click();
  assert.equal(app.frame(), frame);
  assert.equal(app.frame().simulatedSelection.layer, 1000);
  assert.equal(app.requests.length, 1);
  await content.children[0].children[0].emit('click');
  assert.equal(content.hidden, true);
  assert.equal(app.focus(), app.rescue);
  app.click(); app.emit('popstate');
  assert.equal(content.hidden, true);
  assert.equal(app.frame(), frame);
  assert.equal(app.document.body.classList.contains('pr-embed-open'), false);
});

test('explicit new-tab gestures, external links, and missing Mainsail layout retain normal behavior', () => {
  const app = harness();
  for (const options of [{ctrlKey:true}, {metaKey:true}, {shiftKey:true}, {altKey:true}, {button:1}, {defaultPrevented:true}]) {
    const event = app.click(app.rescue, options);
    assert.equal(event.stopped, false);
    assert.equal(app.panel(), undefined);
  }
  app.rescue.href = 'https://other.test/print-rescue/';
  assert.equal(app.click().defaultPrevented, false);
  assert.equal(app.panel(), undefined);
  const absent = harness({missingLayout:true});
  assert.equal(absent.click().defaultPrevented, false);
  assert.equal(absent.requests.length, 0);
});

test('drawer and viewport resizing adjusts panel; loss of Mainsail reveals connection dialog', () => {
  const app = harness(); app.click();
  app.main.padding.paddingLeft = '0px'; app.window.innerWidth = 640;
  app.main.rect = {left:0, right:640, top:-300, bottom:1000};
  app.emit('resize'); app.flush();
  assert.equal(app.panel().style.left, '0px');
  assert.equal(app.panel().style.right, '0px');
  assert.equal(app.panel().style.top, '64px');
  const frame = app.frame(); app.main.parentElement = null; app.mutate();
  assert.equal(app.panel().hidden, true);
  assert.equal(app.page.inert, false);
  assert.equal(app.frame(), frame);
});

test('failed asset download leaves Mainsail usable and shows retry instead of an empty iframe', async () => {
  const app = harness({fetchFails:true}); app.click();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(app.frame().hidden, true);
  assert.match(app.panel().children[1].textContent, /Offline/);
  assert.equal(app.panel().children[2].hidden, false);
  assert.equal(app.click(app.consoleLink).defaultPrevented, false);
  assert.equal(app.panel().hidden, true);
});

test('loading the hook twice does not register a second handler or duplicate the iframe', () => {
  const app = harness(); vm.runInContext(source, app.context); app.click();
  assert.equal(app.document.querySelectorAll('#print-rescue-panel').length, 1);
  assert.equal(app.requests.length, 1);
});

test('live Mainsail theme changes reach controls without reloading the preview or session', async () => {
  const app = harness(); app.click();
  await new Promise(resolve=>setImmediate(resolve));
  const frame = app.frame(), doc = app.attachFrameDocument();
  frame.simulatedSelection = {file:'part.gcode', layer:250, token:777};
  const html = frame.srcdoc;
  await frame.emit('load');
  assert.equal(doc.documentElement.dataset.theme,'dark');
  assert.equal(doc.documentElement.style['--accent'],'#2196f3');
  assert.equal(doc.documentElement.style['--bg'],'#121212');
  app.application.classList.remove('theme--dark'); app.application.classList.add('theme--light');
  app.document.documentElement.classList.remove('theme--dark'); app.document.documentElement.classList.add('theme--light');
  app.application.computed = {backgroundColor:'#fff', color:'#212121', fontFamily:'Roboto,sans-serif'};
  app.application.cssVariables = {'--color-primary':'#00aa88', '--v-btn-text-primary':'#000'};
  app.mutate(); app.flush();
  assert.equal(doc.documentElement.dataset.theme,'light');
  assert.equal(doc.documentElement.style['--accent'],'#00aa88');
  assert.equal(doc.documentElement.style['--accent-text'],'#000');
  assert.equal(doc.documentElement.style['--bg'],'#fff');
  assert.equal(app.panel().style['--pr-accent'],'#00aa88');
  assert.equal(doc.head.children.length,1);
  assert.equal(frame.srcdoc,html);
  assert.equal(frame.simulatedSelection.token,777);
  assert.equal(app.requests.length,1);
});
