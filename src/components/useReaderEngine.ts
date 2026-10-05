import { useEffect, useMemo, useRef, useState } from 'react'
import ePub, { type Book, type Rendition } from 'epubjs'
import { db } from '../lib/db'
import { finishReadingSession, getHabitSettings, startReadingSession } from '../lib/habit'
import { recordReadingEvent, shouldOfferReentry } from '../lib/history'
import type { BookRecord, HighlightCategory, ReaderContext, ReaderSettings, TocItem } from '../types'

const DEFAULT: ReaderSettings={fontSize:100,theme:'paper',pageMode:'curl',lineHeight:1.72,margins:7,spoilerPolicy:'strict',prepAudio:false,ttsRate:1,fontFamily:'publisher',textAlign:'publisher',paragraphSpacing:false}
const FONT_STACKS:Record<ReaderSettings['fontFamily'],string>={publisher:'',literary:'Iowan Old Style, Palatino Linotype, Georgia, serif',modern:'Inter, system-ui, sans-serif',accessible:'Atkinson Hyperlegible, Verdana, system-ui, sans-serif'}
function loadSettings():ReaderSettings{try{const saved=JSON.parse(localStorage.getItem('lectoria-settings')||'{}');const merged={...DEFAULT,...saved} as ReaderSettings;if(!saved.pageTurnV16){merged.pageTurnV16=true;if(merged.pageMode==='slide')merged.pageMode='curl'}return merged}catch{return DEFAULT}}
function tocLabel(items:TocItem[],href:string):string{const clean=href.split('#')[0];for(const i of items){if(clean.endsWith(i.href.split('#')[0])||i.href.split('#')[0].endsWith(clean))return i.label;const c=i.subitems?.length?tocLabel(i.subitems,href):'';if(c)return c}return''}
function cleanHref(value:string){let result=(value||'').split('#')[0].split('?')[0];try{result=decodeURIComponent(result)}catch{}return result.replace(/^\.\//,'')}
function wait(ms:number){return new Promise<void>(resolve=>window.setTimeout(resolve,ms))}
type Swipe={active:boolean;dragging:boolean;blocked:boolean;edge:boolean;startX:number;startY:number;lastX:number;lastY:number;lastAt:number;startAt:number;velocityX:number;width:number;height:number;direction:'next'|'prev';doc:Document|null}
type DisplayTarget=string|{href?:string;progress?:number}
type TurnMode='curl'|'slide'|'none'

function reducedMotion(){try{return matchMedia('(prefers-reduced-motion: reduce)').matches}catch{return false}}
// Interpolación con ease-out; se resuelve aunque requestAnimationFrame se detenga (app en segundo plano).
function tween(ms:number,step:(t:number)=>void){return new Promise<void>(resolve=>{const t0=performance.now();let done=false;const end=()=>{if(done)return;done=true;step(1);resolve()};const tick=(now:number)=>{if(done)return;const t=Math.min(1,(now-t0)/ms);if(t>=1){end();return}step(1-Math.pow(1-t,3));requestAnimationFrame(tick)};requestAnimationFrame(tick);window.setTimeout(end,ms+160)})}

function softHaptic(ms=7){try{navigator.vibrate?.(ms)}catch{}}

export function useReaderEngine(bookRecord:BookRecord,onCenterTap:()=>void,onOfferHistory:()=>void){
  const host=useRef<HTMLDivElement>(null),stage=useRef<HTMLDivElement>(null),book=useRef<Book|null>(null),rendition=useRef<Rendition|null>(null)
  const docs=useRef(new WeakSet<Document>()),busy=useRef(false),turning=useRef(false),settingsRef=useRef<ReaderSettings>(loadSettings())
  const swipe=useRef<Swipe>({active:false,dragging:false,blocked:false,edge:false,startX:0,startY:0,lastX:0,lastY:0,lastAt:0,startAt:0,velocityX:0,width:1,height:1,direction:'next',doc:null})
  const locationStack=useRef<string[]>([]),currentHrefRef=useRef(''),currentSpineIndex=useRef(-1),displayedRef=useRef({page:1,total:1})
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
    style.textContent=`${font?`body{font-family:${font}!important}`:''}${s.textAlign!=='publisher'?`body,p,li,blockquote{text-align:${s.textAlign}!important}`:''}${s.paragraphSpacing?'p{margin-bottom:1em!important}':''}img{max-width:100%;}`
  }
  function refreshTypography(){try{const contents:any=(rendition.current as any)?.getContents?.()||[];for(const c of contents)if(c?.document)documentTypography(c.document)}catch{}}
  function spineItems():any[]{return ((book.current?.spine as any)?.spineItems||[]) as any[]}
  function findSpineIndex(rawHref:string){const target=cleanHref(rawHref);if(!target)return-1;const items=spineItems();return items.findIndex(item=>{const h=cleanHref(String(item?.href||item?.url||''));return h===target||h.endsWith(target)||target.endsWith(h)})}
  function snapshotPosition(){return{cfi:currentCfi.current,href:currentHrefRef.current,index:currentSpineIndex.current,page:displayedRef.current.page}}
  function movedFrom(before:ReturnType<typeof snapshotPosition>){const now=snapshotPosition();return Boolean((now.cfi&&now.cfi!==before.cfi)||(now.href&&now.href!==before.href)||(now.index>=0&&now.index!==before.index)||now.page!==before.page)}
  async function forceSpineStep(dir:'next'|'prev'){
    const r=rendition.current,items=spineItems();if(!r||!items.length)return false
    let index=currentSpineIndex.current;if(index<0)index=findSpineIndex(currentHrefRef.current);if(index<0)index=0
    const step=dir==='next'?1:-1
    for(let i=index+step;i>=0&&i<items.length;i+=step){const item=items[i];if(item?.linear==='no')continue;const target=String(item?.href||item?.url||'');if(!target)continue;try{await r.display(target);return true}catch{}}
    return false
  }
  async function navigatePage(dir:'next'|'prev'):Promise<boolean>{
    const r=rendition.current;if(!r||busy.current)return false;busy.current=true
    const before=snapshotPosition();let moved=false
    try{
      const action=dir==='next'?r.next():r.prev()
      await Promise.race([Promise.resolve(action).then(()=>undefined),wait(260)])
      await wait(24)
      moved=movedFrom(before)||await forceSpineStep(dir)
      softHaptic(5)
    }catch(e){console.warn('Lectoria: no se pudo cambiar de página',e);try{moved=await forceSpineStep(dir)}catch{}}
    finally{window.setTimeout(()=>busy.current=false,55)}
    return moved
  }
  // Pase de página interactivo: transforma solo el contenedor del EPUB (sin capturas ni WebGL).
  function turnMode():TurnMode{const m=settingsRef.current.pageMode;if(m==='scroll'||reducedMotion())return'none';return m==='curl'?'curl':'slide'}
  function paintTurn(mode:'curl'|'slide',dir:'next'|'prev',ratio:number,width:number){
    const el=host.current;if(!el)return
    const r=Math.max(0,Math.min(1,ratio));let shade=0
    el.style.transition='none';el.style.willChange='transform'
    if(mode==='curl'){
      el.style.transformOrigin='0% 50%'
      if(dir==='next'){el.style.transform=`rotateY(${(-Math.acos(1-r)*180/Math.PI).toFixed(2)}deg)`;shade=r}
      else{el.style.transform=`translate3d(${(r*width*.12).toFixed(1)}px,0,0)`;shade=r*.35}
    }else{el.style.transform=`translate3d(${((dir==='next'?-1:1)*r*width).toFixed(1)}px,0,0)`;shade=r*.45}
    el.style.setProperty('--turn-shade',shade.toFixed(3))
  }
  function clearTurn(){const el=host.current;if(!el)return;el.style.transform='';el.style.transformOrigin='';el.style.transition='';el.style.willChange='';el.style.opacity='';el.style.removeProperty('--turn-shade')}
  function hostWidth(){return host.current?.getBoundingClientRect().width||innerWidth}
  async function turnPage(dir:'next'|'prev',from=0){
    if(turning.current)return
    const mode=turnMode(),el=host.current
    if(mode==='none'||!el){clearTurn();await navigatePage(dir);return}
    if(busy.current){clearTurn();return}
    turning.current=true
    const w=hostWidth()
    try{
      if(mode==='curl'&&dir==='next'){
        await tween(Math.round(320*(1-from))+90,t=>paintTurn('curl','next',from+(1-from)*t,w))
        if(!await navigatePage('next'))await tween(280,t=>paintTurn('curl','next',1-t,w))
      }else if(mode==='curl'){
        if(from>0)await tween(110,t=>paintTurn('curl','prev',from*(1-t),w))
        paintTurn('curl','next',1,w)
        await navigatePage('prev')
        await tween(360,t=>paintTurn('curl','next',1-t,w))
      }else{
        const sign=dir==='next'?-1:1
        await tween(Math.round(210*(1-from))+60,t=>paintTurn('slide',dir,from+(1-from)*t,w))
        const moved=await navigatePage(dir),startX=moved?-sign*w*.28:sign*w
        await tween(240,t=>{el.style.transform=`translate3d(${(startX*(1-t)).toFixed(1)}px,0,0)`;el.style.opacity=moved?String(.35+.65*t):'';el.style.setProperty('--turn-shade',((1-t)*.3).toFixed(3))})
      }
    }catch(e){console.warn('Lectoria: animación de página omitida',e)}
    finally{clearTurn();turning.current=false}
  }
  async function cancelTurn(dir:'next'|'prev',from:number){
    const mode=turnMode();if(mode==='none'||turning.current){clearTurn();return}
    turning.current=true;const w=hostWidth()
    try{await tween(Math.round(220*from)+80,t=>paintTurn(mode,dir,from*(1-t),w))}finally{clearTurn();turning.current=false}
  }
  function point(t:Touch,doc:Document){const hr=host.current?.getBoundingClientRect();if(doc===document)return hr?{x:t.clientX-hr.left,y:t.clientY-hr.top}:{x:t.clientX,y:t.clientY};const fr=(doc.defaultView?.frameElement as HTMLElement|null)?.getBoundingClientRect();return{x:t.clientX+(fr?.left||0)-(hr?.left||0),y:t.clientY+(fr?.top||0)-(hr?.top||0)}}
  function size(){const r=host.current?.getBoundingClientRect();return{width:r?.width||innerWidth,height:r?.height||innerHeight}}
  function start(e:TouchEvent,doc:Document){
    if(settingsRef.current.pageMode==='scroll'||e.touches.length!==1||busy.current||turning.current)return
    const target=e.target as Element|null;if(target?.closest('button,input,textarea,select,a,video,audio'))return
    if(doc.defaultView?.getSelection()?.toString().trim())return
    const p=point(e.touches[0],doc),s=size(),now=performance.now(),band=Math.max(20,Math.min(48,s.width*.065)),vertical=p.y>s.height*.16&&p.y<s.height*.84,edge=vertical&&(p.x<=band||p.x>=s.width-band)
    swipe.current={active:true,dragging:false,blocked:false,edge,startX:p.x,startY:p.y,lastX:p.x,lastY:p.y,lastAt:now,startAt:now,velocityX:0,width:s.width,height:s.height,direction:p.x>s.width/2?'next':'prev',doc}
  }
  function move(e:TouchEvent){
    const g=swipe.current;if(!g.active||g.blocked||e.touches.length!==1||!g.doc||turning.current)return
    const p=point(e.touches[0],g.doc),dx=p.x-g.startX,dy=p.y-g.startY,ax=Math.abs(dx),ay=Math.abs(dy),elapsed=performance.now()-g.startAt
    if(!g.dragging){if(ax<7&&ay<7)return;if(elapsed>320||ay>ax*1.15){g.blocked=true;return}if(ax<=ay)return;g.dragging=true}
    if(e.cancelable)e.preventDefault();const now=performance.now(),dt=Math.max(1,now-g.lastAt);g.velocityX=(p.x-g.lastX)/dt;g.lastX=p.x;g.lastY=p.y;g.lastAt=now
    g.direction=dx<0?'next':'prev'
    const mode=turnMode();if(mode!=='none')paintTurn(mode,g.direction,ax/Math.max(1,g.width),g.width)
  }
  function finish(e:TouchEvent,cancelled=false){
    const g=swipe.current;if(!g.active)return;const t=e.changedTouches[0]
    if(t&&g.doc){const p=point(t,g.doc),now=performance.now(),dt=Math.max(1,now-g.lastAt);g.velocityX=(p.x-g.lastX)/dt;g.lastX=p.x;g.lastY=p.y;g.lastAt=now}
    g.active=false
    const dx=g.lastX-g.startX,dy=g.lastY-g.startY,distance=Math.abs(dx),ratio=Math.min(1,distance/Math.max(1,g.width))
    if(g.dragging){
      if(e.cancelable)e.preventDefault()
      if(cancelled||g.doc?.defaultView?.getSelection()?.toString().trim()){void cancelTurn(g.direction,ratio);return}
      const dir:'next'|'prev'=dx<0?'next':'prev',threshold=Math.min(88,g.width*.095),along=Math.sign(g.velocityX)===Math.sign(dx),flick=Math.abs(g.velocityX)>.38&&distance>20&&along,flickBack=!along&&Math.abs(g.velocityX)>.3
      if(flick||(distance>=threshold&&!flickBack))void turnPage(dir,ratio);else void cancelTurn(dir,ratio)
      return
    }
    if(g.blocked||cancelled||g.doc?.defaultView?.getSelection()?.toString().trim())return
    if(distance<10&&Math.abs(dy)<10){if(g.edge)void turnPage(g.direction);else if(g.startX>g.width*.28&&g.startX<g.width*.72)onCenterTap()}
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
    else if(typeof target.progress==='number'&&b){
      try{destination=(b.locations as any)?.cfiFromPercentage?.(Math.max(0,Math.min(1,target.progress)))}catch{}
      if(!destination){const items=spineItems();if(items.length){const index=Math.min(items.length-1,Math.max(0,Math.floor(Math.max(0,Math.min(.999999,target.progress))*items.length)));destination=String(items[index]?.href||items[index]?.url||'')||undefined}}
      destination=destination||target.href
    }else destination=target.href
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
        r.on('relocated',async(loc:any)=>{
          const cfi=loc?.start?.cfi||'',displayed=loc?.start?.displayed,indexValue=Number(loc?.start?.index),h=loc?.start?.href||''
          currentCfi.current=cfi;currentHrefRef.current=h
          const detectedIndex=Number.isFinite(indexValue)&&indexValue>=0?indexValue:findSpineIndex(h);currentSpineIndex.current=detectedIndex
          if(displayed)displayedRef.current={page:Number(displayed.page)||1,total:Number(displayed.total)||1}
          let p=Number(loc?.start?.percentage)
          if((!Number.isFinite(p)||p<=0)&&cfi){try{const fromLocations=Number((b.locations as any)?.percentageFromCfi?.(cfi));if(Number.isFinite(fromLocations)&&fromLocations>=0)p=fromLocations}catch{}}
          const spineCount=Math.max(1,spineItems().length)
          if((!Number.isFinite(p)||p<=0)&&detectedIndex>=0){const page=displayedRef.current.page,total=Math.max(1,displayedRef.current.total),within=total>1?Math.max(0,Math.min(.999,(page-1)/total)):0;p=(detectedIndex+within)/spineCount}
          if(!Number.isFinite(p))p=progressRef.current||bookRecord.progress||0
          const safe=Math.max(0,Math.min(1,p)),ch=tocLabel(items,h);progressRef.current=safe;setProgress(safe);setHref(h);setChapter(ch);setLocation(displayed?`${displayed.page} / ${displayed.total}`:`${Math.round(safe*100)}%`)
          await db.books.update(bookRecord.id,{progress:safe,cfi,lastOpenedAt:Date.now(),readingStatus:safe>.985?'read':safe>.001?'reading':bookRecord.readingStatus})
          if(ch&&ch!==lastChapter.current){lastChapter.current=ch;void recordReadingEvent(bookRecord.id,'chapter','book',{chapter:ch,href:h,cfi,progress:safe})}
          try{const c:any=r.getContents(),active=Array.isArray(c)?c[0]:c,text=active?.document?.body?.innerText||'';setNearby(text.replace(/\s+/g,' ').trim().slice(0,6500))}catch{}
          window.setTimeout(attachFrames,0)
        })
        await r.display(bookRecord.cfi||undefined);if(dead)return
        setReady(true)
        for(const h of await db.highlights.where('bookId').equals(bookRecord.id).toArray()){if(dead)return;applyHighlight(h.cfiRange,h.category,h.color||'#F5D547',h.opacity??.5)}
        window.setTimeout(attachFrames,40)
      }catch(e){console.error(e);if(!dead){setError(e instanceof Error&&e.message==='El archivo EPUB local no está disponible.'?e.message:'No se pudo abrir este EPUB. Puede estar dañado o usar una estructura que esta versión todavía no interpreta.');setReady(false)}}
    }
    void init()
    return()=>{dead=true;try{rendition.current?.destroy()}catch{};try{book.current?.destroy()}catch{};rendition.current=null;book.current=null}
  },[bookRecord.id,reloadToken])

  useEffect(()=>{const s=stage.current;if(!s)return;const a=(e:TouchEvent)=>start(e,document),b=(e:TouchEvent)=>move(e),c=(e:TouchEvent)=>finish(e),d=(e:TouchEvent)=>finish(e,true);s.addEventListener('touchstart',a,{passive:true});s.addEventListener('touchmove',b,{passive:false});s.addEventListener('touchend',c,{passive:false});s.addEventListener('touchcancel',d,{passive:false});return()=>{s.removeEventListener('touchstart',a);s.removeEventListener('touchmove',b);s.removeEventListener('touchend',c);s.removeEventListener('touchcancel',d)}},[])

  useEffect(()=>{const key=(ev:KeyboardEvent)=>{const target=ev.target as HTMLElement|null;if(target?.closest('input,textarea,select,[contenteditable="true"]')||document.querySelector('[aria-modal="true"]'))return;if(settingsRef.current.pageMode==='scroll')return;if(ev.key==='ArrowRight'||ev.key==='PageDown'||(ev.key===' '&&!ev.shiftKey)){ev.preventDefault();void turnPage('next')}else if(ev.key==='ArrowLeft'||ev.key==='PageUp'||(ev.key===' '&&ev.shiftKey)){ev.preventDefault();void turnPage('prev')}};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key)},[])

  return{host,stage,rendition,settings,setSettings,progress,location,chapter,href,toc,selectedText,nearby,context,limit,setLimit,minutes,ready,error,retry,navigatePage,turnPage,displayTarget,seekProgress,goBackLocation,canGoBackLocation,saveHighlight,removeHighlight,clearSelection}
}
