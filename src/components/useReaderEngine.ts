import { useEffect, useMemo, useRef, useState } from 'react'
import ePub, { type Book, type Rendition } from 'epubjs'
import { db } from '../lib/db'
import { finishReadingSession, getHabitSettings, startReadingSession } from '../lib/habit'
import { recordReadingEvent, shouldOfferReentry } from '../lib/history'
import type { BookRecord, HighlightCategory, ReaderContext, ReaderSettings, TocItem } from '../types'

const DEFAULT: ReaderSettings={fontSize:100,theme:'paper',pageMode:'slide',lineHeight:1.72,margins:7,spoilerPolicy:'strict',prepAudio:false,ttsRate:1,fontFamily:'publisher',textAlign:'publisher',paragraphSpacing:false}
const FONT_STACKS:Record<ReaderSettings['fontFamily'],string>={publisher:'',literary:'Iowan Old Style, Palatino Linotype, Georgia, serif',modern:'Inter, system-ui, sans-serif',accessible:'Atkinson Hyperlegible, Verdana, system-ui, sans-serif'}
function loadSettings():ReaderSettings{try{const saved=JSON.parse(localStorage.getItem('lectoria-settings')||'{}');const merged={...DEFAULT,...saved} as ReaderSettings;if(merged.pageMode==='curl')merged.pageMode='slide';return merged}catch{return DEFAULT}}
function tocLabel(items:TocItem[],href:string):string{const clean=href.split('#')[0];for(const i of items){if(clean.endsWith(i.href.split('#')[0])||i.href.split('#')[0].endsWith(clean))return i.label;const c=i.subitems?.length?tocLabel(i.subitems,href):'';if(c)return c}return''}
type Swipe={active:boolean;dragging:boolean;blocked:boolean;edge:boolean;startX:number;startY:number;lastX:number;lastY:number;lastAt:number;startAt:number;velocityX:number;width:number;height:number;direction:'next'|'prev';doc:Document|null}
type DisplayTarget=string|{href?:string;progress?:number}

function softHaptic(ms=7){try{navigator.vibrate?.(ms)}catch{}}

export function useReaderEngine(bookRecord:BookRecord,onCenterTap:()=>void,onOfferHistory:()=>void){
  const host=useRef<HTMLDivElement>(null),stage=useRef<HTMLDivElement>(null),book=useRef<Book|null>(null),rendition=useRef<Rendition|null>(null)
  const docs=useRef(new WeakSet<Document>()),busy=useRef(false),settingsRef=useRef<ReaderSettings>(loadSettings())
  const swipe=useRef<Swipe>({active:false,dragging:false,blocked:false,edge:false,startX:0,startY:0,lastX:0,lastY:0,lastAt:0,startAt:0,velocityX:0,width:1,height:1,direction:'next',doc:null})
  const locationStack=useRef<string[]>([])
  const [settings,setSettings]=useState(loadSettings),[progress,setProgress]=useState(bookRecord.progress||0),[location,setLocation]=useState(''),[chapter,setChapter]=useState(''),[href,setHref]=useState('')
  const [toc,setToc]=useState<TocItem[]>([]),[selectedText,setSelectedText]=useState(''),[selectedCfi,setSelectedCfi]=useState(''),[nearby,setNearby]=useState('')
  const [limit,setLimit]=useState(false),[minutes,setMinutes]=useState(0),[ready,setReady]=useState(false),[error,setError]=useState(''),[reloadToken,setReloadToken]=useState(0),[canGoBackLocation,setCanGoBackLocation]=useState(false)
  const sessionStart=useRef(Date.now()),sessionId=useRef<number|undefined>(undefined),lastChapter=useRef(''),progressRef=useRef(bookRecord.progress||0),currentCfi=useRef(bookRecord.cfi||''),flowRef=useRef(settings.pageMode==='scroll'?'scrolled-doc':'paginated')
  settingsRef.current=settings;progressRef.current=progress
  const context:ReaderContext=useMemo(()=>({bookId:bookRecord.id,title:bookRecord.title,author:bookRecord.author,selectedText,nearbyText:nearby,currentChapter:chapter,currentHref:href,progress,spoilerPolicy:settings.spoilerPolicy,bookType:bookRecord.type||'essay'}),[bookRecord,selectedText,nearby,chapter,href,progress,settings.spoilerPolicy])

  function documentTypography(doc:Document){
    let style=doc.getElementById('lectoria-typography') as HTMLStyleElement|null
    if(!style){style=doc.createElement('style');style.id='lectoria-typography';(doc.head||doc.documentElement).appendChild(style)}
    const s=settingsRef.current,font=FONT_STACKS[s.fontFamily]
    style.textContent=`${font?`body{font-family:${font}!important}`:''}${s.textAlign!=='publisher'?`body,p,li,blockquote{text-align:${s.textAlign}!important}`:''}${s.paragraphSpacing?'p{margin-bottom:1em!important}':''}`
  }
  function refreshTypography(){try{const contents:any=(rendition.current as any)?.getContents?.()||[];for(const c of contents)if(c?.document)documentTypography(c.document)}catch{}}

  async function navigatePage(dir:'next'|'prev'){
    const r=rendition.current;if(!r||busy.current)return;busy.current=true
    try{await(dir==='next'?r.next():r.prev());softHaptic(5)}catch(e){console.warn('Lectoria: no se pudo cambiar de página',e)}finally{window.setTimeout(()=>busy.current=false,70)}
  }
  function point(t:Touch,doc:Document){if(doc===document){const rect=host.current?.getBoundingClientRect();return rect?{x:t.clientX-rect.left,y:t.clientY-rect.top}:{x:t.clientX,y:t.clientY}}return{x:t.clientX,y:t.clientY}}
  function size(doc:Document){if(doc===document){const r=host.current?.getBoundingClientRect();return{width:r?.width||innerWidth,height:r?.height||innerHeight}}return{width:doc.defaultView?.innerWidth||innerWidth,height:doc.defaultView?.innerHeight||innerHeight}}
  function start(e:TouchEvent,doc:Document){
    if(settingsRef.current.pageMode==='scroll'||e.touches.length!==1||busy.current)return
    const target=e.target as Element|null;if(target?.closest('button,input,textarea,select,a,video,audio'))return
    if(doc.defaultView?.getSelection()?.toString().trim())return
    const p=point(e.touches[0],doc),s=size(doc),now=performance.now(),band=Math.max(16,Math.min(34,s.width*.045)),vertical=p.y>s.height*.2&&p.y<s.height*.8,edge=vertical&&(p.x<=band||p.x>=s.width-band)
    swipe.current={active:true,dragging:false,blocked:false,edge,startX:p.x,startY:p.y,lastX:p.x,lastY:p.y,lastAt:now,startAt:now,velocityX:0,width:s.width,height:s.height,direction:p.x>s.width/2?'next':'prev',doc}
  }
  function move(e:TouchEvent){
    const g=swipe.current;if(!g.active||g.blocked||!g.edge||e.touches.length!==1||!g.doc)return
    const p=point(e.touches[0],g.doc),dx=p.x-g.startX,dy=p.y-g.startY,ax=Math.abs(dx),ay=Math.abs(dy),elapsed=performance.now()-g.startAt
    if(!g.dragging){if(ax<7&&ay<7)return;if(elapsed>320||ay>ax*1.15){g.blocked=true;return}if(ax<=ay)return;g.dragging=true}
    if(e.cancelable)e.preventDefault();const now=performance.now(),dt=Math.max(1,now-g.lastAt);g.velocityX=(p.x-g.lastX)/dt;g.lastX=p.x;g.lastY=p.y;g.lastAt=now
    if(settingsRef.current.pageMode==='slide'){const ratio=Math.min(1,Math.abs(dx)/Math.max(1,g.width));stage.current?.style.setProperty('--lectoria-slide',String(ratio));stage.current?.classList.toggle('lectoria-slide-next',dx<0);stage.current?.classList.toggle('lectoria-slide-prev',dx>0)}
  }
  function clearSlideVisual(){stage.current?.style.removeProperty('--lectoria-slide');stage.current?.classList.remove('lectoria-slide-next','lectoria-slide-prev')}
  function finish(e:TouchEvent,cancelled=false){
    const g=swipe.current;if(!g.active)return;const t=e.changedTouches[0]
    if(t&&g.doc){const p=point(t,g.doc),now=performance.now(),dt=Math.max(1,now-g.lastAt);g.velocityX=(p.x-g.lastX)/dt;g.lastX=p.x;g.lastY=p.y;g.lastAt=now}
    g.active=false;if(g.blocked||cancelled){clearSlideVisual();return}
    const dx=g.lastX-g.startX,dy=g.lastY-g.startY,distance=Math.abs(dx);if(g.doc?.defaultView?.getSelection()?.toString().trim()){clearSlideVisual();return}
    if(!g.edge){if(distance<10&&Math.abs(dy)<10&&g.startX>g.width*.28&&g.startX<g.width*.72)onCenterTap();clearSlideVisual();return}
    if(!g.dragging){if(distance<10&&Math.abs(dy)<10)void navigatePage(g.direction);clearSlideVisual();return}
    if(e.cancelable)e.preventDefault();const correct=(g.direction==='next'&&dx<0)||(g.direction==='prev'&&dx>0),threshold=Math.min(88,g.width*.095),flick=Math.abs(g.velocityX)>.38&&distance>20
    if(correct&&(distance>=threshold||flick))void navigatePage(g.direction)
    window.setTimeout(clearSlideVisual,90)
  }
  function attach(doc:Document){if(docs.current.has(doc)){documentTypography(doc);return}docs.current.add(doc);documentTypography(doc);doc.documentElement.style.touchAction='pan-y pinch-zoom';if(doc.body)doc.body.style.touchAction='pan-y pinch-zoom';doc.addEventListener('touchstart',e=>start(e,doc),{passive:true});doc.addEventListener('touchmove',move,{passive:false});doc.addEventListener('touchend',e=>finish(e),{passive:false});doc.addEventListener('touchcancel',e=>finish(e,true),{passive:false})}
  function attachFrames(){const r:any=rendition.current;try{for(const c of r?.getContents?.()||[])if(c?.document)attach(c.document)}catch{}}
  function highlightStyle(color:string,opacity:number){return{'fill':color,'fill-opacity':String(Math.max(.15,Math.min(.95,opacity))),'mix-blend-mode':'multiply'}}
  function applyHighlight(cfi:string,category:HighlightCategory,color:string,opacity:number){try{(rendition.current?.annotations as any)?.highlight(cfi,{category,color,opacity},undefined,'lectoria-highlight',highlightStyle(color,opacity))}catch{}}
  function removeHighlight(cfi:string){try{(rendition.current?.annotations as any)?.remove(cfi,'highlight')}catch{}}
  async function saveHighlight(category:HighlightCategory,color:string,opacity:number,note?:string){if(!selectedText||!selectedCfi)return;await db.highlights.add({bookId:bookRecord.id,cfiRange:selectedCfi,text:selectedText,category,note,color,opacity,createdAt:Date.now()});applyHighlight(selectedCfi,category,color,opacity);softHaptic(8);void recordReadingEvent(bookRecord.id,note?'note':'highlight',note?'reader':'book',{chapter,href,cfi:selectedCfi,progress:progressRef.current,text:(note||selectedText).slice(0,420)});clearSelection()}
  function clearSelection(){setSelectedText('');setSelectedCfi('')}

  function pushCurrentLocation(){const c=currentCfi.current;if(!c)return;const stack=locationStack.current;if(stack[stack.length-1]!==c)stack.push(c);if(stack.length>24)stack.shift();setCanGoBackLocation(stack.length>0)}
  async function displayTarget(target:DisplayTarget,{remember=true}:{remember?:boolean}={}){
    const r=rendition.current,b=book.current;if(!r)return
    if(remember)pushCurrentLocation()
    let destination:string|undefined
    if(typeof target==='string')destination=target
    else if(typeof target.progress==='number'&&b){try{destination=(b.locations as any)?.cfiFromPercentage?.(Math.max(0,Math.min(1,target.progress)))}catch{};destination=destination||target.href}
    else destination=target.href
    try{await r.display(destination)}catch{if(typeof target!=='string'&&target.href)try{await r.display(target.href)}catch{}}
  }
  async function seekProgress(value:number){await displayTarget({progress:Math.max(0,Math.min(1,value))})}
  async function goBackLocation(){const target=locationStack.current.pop();setCanGoBackLocation(locationStack.current.length>0);if(target)await displayTarget(target,{remember:false})}
  function retry(){setError('');setReady(false);setReloadToken(v=>v+1)}

  useEffect(()=>{
    localStorage.setItem('lectoria-settings',JSON.stringify(settings));document.documentElement.dataset.readerTheme=settings.theme
    const r=rendition.current;if(r){r.themes.fontSize(`${settings.fontSize}%`);r.themes.override('line-height',String(settings.lineHeight));r.themes.override('padding',`0 ${settings.margins}vw`);const nextFlow=settings.pageMode==='scroll'?'scrolled-doc':'paginated';if(flowRef.current!==nextFlow){flowRef.current=nextFlow;try{(r as any).flow(nextFlow);void r.display(currentCfi.current||undefined)}catch{}}refreshTypography()}
  },[settings])

  useEffect(()=>{let dead=false;sessionStart.current=Date.now();void getHabitSettings().then(async h=>{if(dead)return;sessionId.current=await startReadingSession(bookRecord.id);if((await shouldOfferReentry(bookRecord,h.reentryHours)).offer)window.setTimeout(()=>!dead&&onOfferHistory(),700)});void recordReadingEvent(bookRecord.id,'session_start','system',{progress:bookRecord.progress,cfi:bookRecord.cfi});const timer=window.setInterval(()=>{const m=Math.max(0,Math.floor((Date.now()-sessionStart.current)/60000));setMinutes(m);void getHabitSettings().then(h=>{if(h.maxSessionMinutes&&m>=h.maxSessionMinutes)setLimit(true)});if(sessionId.current)void db.readingSessions.update(sessionId.current,{minutes:m})},30000);return()=>{dead=true;window.clearInterval(timer);const m=Math.max(0,Math.floor((Date.now()-sessionStart.current)/60000));void finishReadingSession(sessionId.current,sessionStart.current);void recordReadingEvent(bookRecord.id,'session_end','system',{progress:progressRef.current,cfi:currentCfi.current,text:`${m} min de lectura`})}},[bookRecord.id])

  useEffect(()=>{
    let dead=false
    async function init(){
      setReady(false);setError('')
      try{
        if(!bookRecord.file||typeof bookRecord.file.arrayBuffer!=='function')throw new Error('El archivo EPUB local no está disponible.')
        const buffer=await bookRecord.file.arrayBuffer();if(dead)return
        const b=ePub(buffer);book.current=b;await b.ready;if(dead||!host.current)return
        const items=(await b.loaded.navigation)?.toc as TocItem[]||[];setToc(items)
        if(bookRecord.locations){try{b.locations.load(bookRecord.locations)}catch{}}
        const initialFlow=settingsRef.current.pageMode==='scroll'?'scrolled-doc':'paginated';flowRef.current=initialFlow
        const r=b.renderTo(host.current,{width:'100%',height:'100%',spread:'none',flow:initialFlow});rendition.current=r
        r.themes.fontSize(`${settingsRef.current.fontSize}%`);r.themes.override('line-height',String(settingsRef.current.lineHeight));r.themes.override('padding',`0 ${settingsRef.current.margins}vw`)
        r.on('selected',(cfi:string,c:any)=>{const text=c.window.getSelection()?.toString()?.trim()||'';if(text){setSelectedCfi(cfi);setSelectedText(text)}})
        r.on('rendered',()=>window.setTimeout(attachFrames,0))
        r.on('relocated',async(loc:any)=>{const cfi=loc?.start?.cfi||'',displayed=loc?.start?.displayed;currentCfi.current=cfi;let p=Number(loc?.start?.percentage);if((!Number.isFinite(p)||p<=0)&&cfi){try{const fromLocations=Number((b.locations as any)?.percentageFromCfi?.(cfi));if(Number.isFinite(fromLocations)&&fromLocations>=0)p=fromLocations}catch{}}if((!Number.isFinite(p)||p<0)&&displayed?.total>1)p=(Math.max(1,displayed.page)-1)/Math.max(1,displayed.total-1);if(!Number.isFinite(p))p=progressRef.current||bookRecord.progress||0;const safe=Math.max(0,Math.min(1,p)),h=loc?.start?.href||'',ch=tocLabel(items,h);progressRef.current=safe;setProgress(safe);setHref(h);setChapter(ch);setLocation(displayed?`${displayed.page} / ${displayed.total}`:`${Math.round(safe*100)}%`);await db.books.update(bookRecord.id,{progress:safe,cfi,lastOpenedAt:Date.now(),readingStatus:safe>.985?'read':safe>.001?'reading':bookRecord.readingStatus});if(ch&&ch!==lastChapter.current){lastChapter.current=ch;void recordReadingEvent(bookRecord.id,'chapter','book',{chapter:ch,href:h,cfi,progress:safe})}try{const c:any=r.getContents(),active=Array.isArray(c)?c[0]:c,text=active?.document?.body?.innerText||'';setNearby(text.replace(/\s+/g,' ').trim().slice(0,6500))}catch{}window.setTimeout(attachFrames,0)})
        await r.display(bookRecord.cfi||undefined);if(dead)return
        setReady(true)
        for(const h of await db.highlights.where('bookId').equals(bookRecord.id).toArray()){if(dead)return;applyHighlight(h.cfiRange,h.category,h.color||'#F5D547',h.opacity??.5)}
        window.setTimeout(attachFrames,40)
        if(!bookRecord.locations){window.setTimeout(()=>{if(dead)return;void (async()=>{try{await b.locations.generate(900);if(!dead)await db.books.update(bookRecord.id,{locations:b.locations.save()})}catch{}})()},900)}
      }catch(e){console.error(e);if(!dead){setError(e instanceof Error&&e.message==='El archivo EPUB local no está disponible.'?e.message:'No se pudo abrir este EPUB. Puede estar dañado o usar una estructura que esta versión todavía no interpreta.');setReady(false)}}
    }
    void init()
    return()=>{dead=true;try{rendition.current?.destroy()}catch{};try{book.current?.destroy()}catch{};rendition.current=null;book.current=null}
  },[bookRecord.id,reloadToken])

  useEffect(()=>{const s=stage.current;if(!s)return;const a=(e:TouchEvent)=>start(e,document),b=(e:TouchEvent)=>move(e),c=(e:TouchEvent)=>finish(e),d=(e:TouchEvent)=>finish(e,true);s.addEventListener('touchstart',a,{passive:true});s.addEventListener('touchmove',b,{passive:false});s.addEventListener('touchend',c,{passive:false});s.addEventListener('touchcancel',d,{passive:false});return()=>{s.removeEventListener('touchstart',a);s.removeEventListener('touchmove',b);s.removeEventListener('touchend',c);s.removeEventListener('touchcancel',d)}},[])

  useEffect(()=>{const key=(ev:KeyboardEvent)=>{const target=ev.target as HTMLElement|null;if(target?.closest('input,textarea,select,[contenteditable="true"]')||document.querySelector('[aria-modal="true"]'))return;if(settingsRef.current.pageMode==='scroll')return;if(ev.key==='ArrowRight'||ev.key==='PageDown'||(ev.key===' '&&!ev.shiftKey)){ev.preventDefault();void navigatePage('next')}else if(ev.key==='ArrowLeft'||ev.key==='PageUp'||(ev.key===' '&&ev.shiftKey)){ev.preventDefault();void navigatePage('prev')}};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key)},[])

  return{host,stage,rendition,settings,setSettings,progress,location,chapter,href,toc,selectedText,nearby,context,limit,setLimit,minutes,ready,error,retry,navigatePage,displayTarget,seekProgress,goBackLocation,canGoBackLocation,saveHighlight,removeHighlight,clearSelection}
}
