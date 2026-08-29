import html2canvas from 'html2canvas'
import { PageCurlRenderer, type CurlDirection } from './pageCurlRenderer'

type Gesture={active:boolean;dragging:boolean;blocked:boolean;direction:CurlDirection;startX:number;startY:number;lastX:number;lastY:number;lastAt:number;velocityX:number;width:number;height:number;doc:Document|null;underlyingMoved:boolean}
const g:Gesture={active:false,dragging:false,blocked:false,direction:'next',startX:0,startY:0,lastX:0,lastY:0,lastAt:0,velocityX:0,width:1,height:1,doc:null,underlyingMoved:false}
let renderer:PageCurlRenderer|null=null
let cached:HTMLCanvasElement|null=null
let cachedDoc:Document|null=null
let cacheTimer=0
let preparing=false
const seenDocs=new WeakSet<Document>(),seenFrames=new WeakSet<HTMLIFrameElement>(),seenStages=new WeakSet<HTMLElement>()

function reducedMotion(){return matchMedia?.('(prefers-reduced-motion: reduce)')?.matches===true}
function curlMode(){try{return JSON.parse(localStorage.getItem('lectoria-settings')||'{}')?.pageMode!=='slide'&&JSON.parse(localStorage.getItem('lectoria-settings')||'{}')?.pageMode!=='scroll'}catch{return true}}
function viewer(){return document.querySelector<HTMLElement>('.epub-viewer')}
function stage(){return document.querySelector<HTMLElement>('.reader-stage')}
function currentDoc(){const frames=Array.from(document.querySelectorAll<HTMLIFrameElement>('.epub-viewer iframe'));for(let i=frames.length-1;i>=0;i--){try{if(frames[i].contentDocument?.body&&frames[i].getBoundingClientRect().height>4)return frames[i].contentDocument}catch{}}return null}
function frameFor(doc:Document){for(const frame of document.querySelectorAll<HTMLIFrameElement>('.epub-viewer iframe'))try{if(frame.contentDocument===doc)return frame}catch{};return null}
function localPoint(t:Touch,doc:Document){if(doc===document){const rect=viewer()?.getBoundingClientRect();if(rect)return{x:t.clientX-rect.left,y:t.clientY-rect.top}}return{x:t.clientX,y:t.clientY}}
function dimensions(doc:Document){const rect=viewer()?.getBoundingClientRect();return{width:Math.max(1,doc===document?(rect?.width||innerWidth):(doc.defaultView?.innerWidth||rect?.width||innerWidth)),height:Math.max(1,doc===document?(rect?.height||innerHeight):(doc.defaultView?.innerHeight||rect?.height||innerHeight))}}
function interactive(target:Element|null){return Boolean(target?.closest('a,button,input,textarea,select,video,audio,[contenteditable="true"]'))}
function selected(doc:Document){try{return Boolean(doc.defaultView?.getSelection()?.toString().trim())}catch{return false}}
function invalidate(){cached=null;cachedDoc=null}

async function capture(doc:Document){const page=viewer();if(!page)throw new Error('Página no disponible');const scale=Math.min(1.25,Math.max(1,devicePixelRatio||1));try{return await html2canvas(page,{backgroundColor:getComputedStyle(page).backgroundColor||'#fbf7ed',logging:false,useCORS:true,allowTaint:false,scale,removeContainer:true})}catch{const frame=frameFor(doc),root=doc.documentElement;if(!frame||!root)throw new Error('No se pudo capturar la página');const width=Math.max(1,frame.clientWidth||doc.defaultView?.innerWidth||g.width),height=Math.max(1,frame.clientHeight||doc.defaultView?.innerHeight||g.height);return html2canvas(root,{backgroundColor:getComputedStyle(doc.body||root).backgroundColor||'#fbf7ed',logging:false,useCORS:true,allowTaint:false,scale,width,height,windowWidth:width,windowHeight:height,scrollX:doc.defaultView?.scrollX||0,scrollY:doc.defaultView?.scrollY||0,removeContainer:true})}}
async function prime(){if(!curlMode()||reducedMotion()||renderer||g.active)return;const doc=currentDoc();if(!doc||cachedDoc===doc&&cached)return;try{cached=await capture(doc);cachedDoc=doc}catch{invalidate()}}
function schedulePrime(ms=260){clearTimeout(cacheTimer);cacheTimer=window.setTimeout(()=>void prime(),ms)}
function clickPage(dir:CurlDirection){const button=document.querySelector<HTMLButtonElement>(dir==='next'?'.tap-zone.right':'.tap-zone.left');if(button){invalidate();button.click();schedulePrime(500)}}
function reset(){g.active=false;g.dragging=false;g.blocked=false;g.doc=null;g.underlyingMoved=false;preparing=false}
function cleanup(){renderer?.destroy();renderer=null;stage()?.classList.remove('lectoria-curl-active')}

async function prepare(){if(preparing||renderer||!g.doc||!g.dragging)return;preparing=true;try{let snapshot=cachedDoc===g.doc?cached:null;if(!snapshot)snapshot=await capture(g.doc);if(!g.active||!g.dragging){preparing=false;return}const s=stage(),v=viewer();if(!s||!v)throw new Error('Lector no disponible');s.classList.add('lectoria-curl-active');renderer=new PageCurlRenderer(s,v,snapshot,g.direction,g.startY);renderer.setPointer(g.lastX,g.lastY);clickPage(g.direction);g.underlyingMoved=true}catch(error){console.warn('Lectoria curl:',error);cleanup()}finally{preparing=false}}

function start(event:TouchEvent,doc:Document){if(!curlMode()||reducedMotion()||renderer||event.touches.length!==1||interactive(event.target as Element|null)||selected(doc))return;const p=localPoint(event.touches[0],doc),d=dimensions(doc);g.active=true;g.dragging=false;g.blocked=false;g.direction=p.x>d.width/2?'next':'prev';g.startX=g.lastX=p.x;g.startY=g.lastY=p.y;g.lastAt=performance.now();g.velocityX=0;g.width=d.width;g.height=d.height;g.doc=doc;g.underlyingMoved=false;if(cachedDoc!==doc)void prime()}
function move(event:TouchEvent){if(!g.active||g.blocked||!g.doc||event.touches.length!==1)return;const p=localPoint(event.touches[0],g.doc),dx=p.x-g.startX,dy=p.y-g.startY,ax=Math.abs(dx),ay=Math.abs(dy);if(!g.dragging){if(ax<7&&ay<7)return;if(ay>ax*1.2){g.blocked=true;return}if(ax<=ay)return;g.direction=dx<0?'next':'prev';g.dragging=true;void prepare()}if(event.cancelable)event.preventDefault();const now=performance.now(),dt=Math.max(1,now-g.lastAt);g.velocityX=(p.x-g.lastX)/dt;g.lastX=p.x;g.lastY=p.y;g.lastAt=now;renderer?.setPointer(p.x,p.y)}
async function settle(commit:boolean){const dir=g.direction;if(renderer){if(commit){const targetX=dir==='next'?-g.width*1.02:g.width*2.02;await renderer.animateTo(targetX,g.lastY,Math.max(130,220-Math.abs(g.velocityX)*80));cleanup();reset();try{navigator.vibrate?.(6)}catch{};schedulePrime(340);return}await renderer.animateTo(dir==='next'?g.width:0,g.startY,175);cleanup();if(g.underlyingMoved){clickPage(dir==='next'?'prev':'next');await new Promise(r=>setTimeout(r,100))}reset();schedulePrime(340);return}if(commit)clickPage(dir);reset()}
function end(event:TouchEvent){if(!g.active)return;const doc=g.doc,t=event.changedTouches[0];if(t&&doc){const p=localPoint(t,doc),now=performance.now(),dt=Math.max(1,now-g.lastAt);g.velocityX=(p.x-g.lastX)/dt;g.lastX=p.x;g.lastY=p.y;g.lastAt=now;renderer?.setPointer(p.x,p.y)}const dx=g.lastX-g.startX,dy=g.lastY-g.startY,distance=Math.abs(dx),wasDragging=g.dragging,wasBlocked=g.blocked;if(wasBlocked){cleanup();reset();return}if(!wasDragging){if(doc&&!selected(doc)&&!interactive(event.target as Element|null)&&distance<9&&Math.abs(dy)<9){if(g.startX>g.width*.82)clickPage('next');else if(g.startX<g.width*.18)clickPage('prev');else window.dispatchEvent(new Event('lectoria:toggle-controls'))}reset();return}if(event.cancelable)event.preventDefault();const correct=(g.direction==='next'&&dx<0)||(g.direction==='prev'&&dx>0),commit=correct&&(distance>=Math.min(140,g.width*.18)||(Math.abs(g.velocityX)>.46&&distance>26));g.active=false;void settle(commit)}
function cancel(event:TouchEvent){if(!g.active)return;if(g.dragging&&event.cancelable)event.preventDefault();g.active=false;void settle(false)}

function attachDoc(doc:Document){if(seenDocs.has(doc))return;seenDocs.add(doc);doc.addEventListener('touchstart',e=>start(e,doc),{passive:true});doc.addEventListener('touchmove',move,{passive:false});doc.addEventListener('touchend',end,{passive:false});doc.addEventListener('touchcancel',cancel,{passive:false});schedulePrime(120)}
function attachFrame(frame:HTMLIFrameElement){if(seenFrames.has(frame))return;seenFrames.add(frame);const run=()=>{try{if(frame.contentDocument)attachDoc(frame.contentDocument);invalidate();schedulePrime(170)}catch{}};frame.addEventListener('load',()=>setTimeout(run,0));run()}
function attachStage(el:HTMLElement){if(seenStages.has(el))return;seenStages.add(el);el.addEventListener('touchstart',e=>start(e,document),{capture:true,passive:true});el.addEventListener('touchmove',move,{capture:true,passive:false});el.addEventListener('touchend',end,{capture:true,passive:false});el.addEventListener('touchcancel',cancel,{capture:true,passive:false})}
function scan(){document.querySelectorAll<HTMLElement>('.reader-stage').forEach(attachStage);document.querySelectorAll<HTMLIFrameElement>('.epub-viewer iframe').forEach(attachFrame)}
function init(){scan();schedulePrime(320);const observer=new MutationObserver(scan);observer.observe(document.documentElement,{childList:true,subtree:true})}
window.addEventListener('lectoria:page-settled',()=>{invalidate();schedulePrime(180)})
window.addEventListener('lectoria:settings-changed',()=>{invalidate();schedulePrime(220)})
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init()
