import { useEffect, useMemo, useRef, useState } from 'react'
import ePub, { type Book, type Rendition } from 'epubjs'
import { db } from '../lib/db'
import { finishReadingSession, getHabitSettings, startReadingSession } from '../lib/habit'
import { recordReadingEvent, shouldOfferReentry } from '../lib/history'
import type { BookRecord, HighlightCategory, ReaderContext, ReaderSettings, TocItem } from '../types'

const DEFAULT: ReaderSettings={fontSize:100,theme:'paper',pageMode:'curl',lineHeight:1.72,margins:7,spoilerPolicy:'strict',prepAudio:false,ttsRate:1}
function loadSettings():ReaderSettings{try{return{...DEFAULT,...JSON.parse(localStorage.getItem('lectoria-settings')||'{}')}}catch{return DEFAULT}}
function tocLabel(items:TocItem[],href:string):string{const clean=href.split('#')[0];for(const i of items){if(clean.endsWith(i.href.split('#')[0])||i.href.split('#')[0].endsWith(clean))return i.label;const c=i.subitems?.length?tocLabel(i.subitems,href):'';if(c)return c}return''}
type Swipe={active:boolean;dragging:boolean;blocked:boolean;edge:boolean;startX:number;startY:number;lastX:number;lastY:number;lastAt:number;startAt:number;velocityX:number;width:number;height:number;direction:'next'|'prev';doc:Document|null}

export function useReaderEngine(bookRecord:BookRecord,onCenterTap:()=>void,onOfferHistory:()=>void){
  const host=useRef<HTMLDivElement>(null),stage=useRef<HTMLDivElement>(null),book=useRef<Book|null>(null),rendition=useRef<Rendition|null>(null)
  const docs=useRef(new WeakSet<Document>()),busy=useRef(false),settingsRef=useRef<ReaderSettings>(loadSettings())
  const swipe=useRef<Swipe>({active:false,dragging:false,blocked:false,edge:false,startX:0,startY:0,lastX:0,lastY:0,lastAt:0,startAt:0,velocityX:0,width:1,height:1,direction:'next',doc:null})
  const [settings,setSettings]=useState(loadSettings),[progress,setProgress]=useState(bookRecord.progress||0),[location,setLocation]=useState(''),[chapter,setChapter]=useState(''),[href,setHref]=useState('')
  const [toc,setToc]=useState<TocItem[]>([]),[selectedText,setSelectedText]=useState(''),[selectedCfi,setSelectedCfi]=useState(''),[nearby,setNearby]=useState('')
  const [limit,setLimit]=useState(false),[minutes,setMinutes]=useState(0)
  const sessionStart=useRef(Date.now()),sessionId=useRef<number|undefined>(undefined),lastChapter=useRef('')
  settingsRef.current=settings
  const context:ReaderContext=useMemo(()=>({bookId:bookRecord.id,title:bookRecord.title,author:bookRecord.author,selectedText,nearbyText:nearby,currentChapter:chapter,currentHref:href,progress,spoilerPolicy:settings.spoilerPolicy,bookType:bookRecord.type||'essay'}),[bookRecord,selectedText,nearby,chapter,href,progress,settings.spoilerPolicy])

  async function navigatePage(dir:'next'|'prev'){
    const r=rendition.current;if(!r||busy.current)return;busy.current=true
    try{await(dir==='next'?r.next():r.prev())}catch(e){console.warn('Lectoria: no se pudo cambiar de página',e)}finally{setTimeout(()=>busy.current=false,70)}
  }
  function point(t:Touch,doc:Document){if(doc===document){const rect=host.current?.getBoundingClientRect();return rect?{x:t.clientX-rect.left,y:t.clientY-rect.top}:{x:t.clientX,y:t.clientY}}return{x:t.clientX,y:t.clientY}}
  function size(doc:Document){if(doc===document){const r=host.current?.getBoundingClientRect();return{width:r?.width||innerWidth,height:r?.height||innerHeight}}return{width:doc.defaultView?.innerWidth||innerWidth,height:doc.defaultView?.innerHeight||innerHeight}}
  function start(e:TouchEvent,doc:Document){
    if(settingsRef.current.pageMode==='scroll'||e.touches.length!==1||busy.current)return
    const target=e.target as Element|null;if(target?.closest('button,input,textarea,select,a'))return
    if(doc.defaultView?.getSelection()?.toString().trim())return
    const p=point(e.touches[0],doc),s=size(doc),now=performance.now(),band=s.width*.065,vertical=p.y>s.height*.18&&p.y<s.height*.82,edge=vertical&&(p.x<=band||p.x>=s.width-band)
    swipe.current={active:true,dragging:false,blocked:false,edge,startX:p.x,startY:p.y,lastX:p.x,lastY:p.y,lastAt:now,startAt:now,velocityX:0,width:s.width,height:s.height,direction:p.x>s.width/2?'next':'prev',doc}
  }
  function move(e:TouchEvent){
    const g=swipe.current;if(!g.active||g.blocked||!g.edge||e.touches.length!==1||!g.doc)return
    const p=point(e.touches[0],g.doc),dx=p.x-g.startX,dy=p.y-g.startY,ax=Math.abs(dx),ay=Math.abs(dy),elapsed=performance.now()-g.startAt
    if(!g.dragging){if(ax<7&&ay<7)return;if(elapsed>320||ay>ax*1.15){g.blocked=true;return}if(ax<=ay)return;g.dragging=true}
    if(e.cancelable)e.preventDefault();const now=performance.now(),dt=Math.max(1,now-g.lastAt);g.velocityX=(p.x-g.lastX)/dt;g.lastX=p.x;g.lastY=p.y;g.lastAt=now
  }
  function finish(e:TouchEvent,cancelled=false){
    const g=swipe.current;if(!g.active)return;const t=e.changedTouches[0]
    if(t&&g.doc){const p=point(t,g.doc),now=performance.now(),dt=Math.max(1,now-g.lastAt);g.velocityX=(p.x-g.lastX)/dt;g.lastX=p.x;g.lastY=p.y;g.lastAt=now}
    g.active=false;if(g.blocked||cancelled)return
    const dx=g.lastX-g.startX,dy=g.lastY-g.startY,distance=Math.abs(dx);if(g.doc?.defaultView?.getSelection()?.toString().trim())return
    if(!g.edge){if(distance<10&&Math.abs(dy)<10&&g.startX>g.width*.28&&g.startX<g.width*.72)onCenterTap();return}
    if(!g.dragging){if(distance<10&&Math.abs(dy)<10)void navigatePage(g.direction);return}
    if(e.cancelable)e.preventDefault();const correct=(g.direction==='next'&&dx<0)||(g.direction==='prev'&&dx>0),threshold=Math.min(90,g.width*.10),flick=Math.abs(g.velocityX)>.38&&distance>20
    if(correct&&(distance>=threshold||flick))void navigatePage(g.direction)
  }
  function attach(doc:Document){if(docs.current.has(doc))return;docs.current.add(doc);doc.documentElement.style.touchAction='pan-y pinch-zoom';if(doc.body)doc.body.style.touchAction='pan-y pinch-zoom';doc.addEventListener('touchstart',e=>start(e,doc),{passive:true});doc.addEventListener('touchmove',move,{passive:false});doc.addEventListener('touchend',e=>finish(e),{passive:false});doc.addEventListener('touchcancel',e=>finish(e,true),{passive:false})}
  function attachFrames(){const r:any=rendition.current;try{for(const c of r?.getContents?.()||[])if(c?.document)attach(c.document)}catch{}}
  function highlightStyle(color:string,opacity:number){return{'fill':color,'fill-opacity':String(Math.max(.15,Math.min(.95,opacity))),'mix-blend-mode':'multiply'}}
  function applyHighlight(cfi:string,category:HighlightCategory,color:string,opacity:number){try{(rendition.current?.annotations as any)?.highlight(cfi,{category,color,opacity},undefined,'lectoria-highlight',highlightStyle(color,opacity))}catch{}}
  async function saveHighlight(category:HighlightCategory,color:string,opacity:number,note?:string){if(!selectedText||!selectedCfi)return;await db.highlights.add({bookId:bookRecord.id,cfiRange:selectedCfi,text:selectedText,category,note,color,opacity,createdAt:Date.now()});applyHighlight(selectedCfi,category,color,opacity);void recordReadingEvent(bookRecord.id,note?'note':'highlight',note?'reader':'book',{chapter,href,cfi:selectedCfi,progress,text:(note||selectedText).slice(0,420)});clearSelection()}
  function clearSelection(){setSelectedText('');setSelectedCfi('')}

  useEffect(()=>{localStorage.setItem('lectoria-settings',JSON.stringify(settings));document.documentElement.dataset.readerTheme=settings.theme;const r=rendition.current;if(r){r.themes.fontSize(`${settings.fontSize}%`);r.themes.override('line-height',String(settings.lineHeight));r.themes.override('padding',`0 ${settings.margins}vw`)}},[settings])
  useEffect(()=>{let dead=false;sessionStart.current=Date.now();void getHabitSettings().then(async h=>{if(dead)return;sessionId.current=await startReadingSession(bookRecord.id);if((await shouldOfferReentry(bookRecord,h.reentryHours)).offer)setTimeout(()=>!dead&&onOfferHistory(),700)});void recordReadingEvent(bookRecord.id,'session_start','system',{progress:bookRecord.progress,cfi:bookRecord.cfi});const timer=setInterval(()=>{const m=Math.max(1,Math.floor((Date.now()-sessionStart.current)/60000));setMinutes(m);void getHabitSettings().then(h=>{if(h.maxSessionMinutes&&m>=h.maxSessionMinutes)setLimit(true)});if(sessionId.current)void db.readingSessions.update(sessionId.current,{minutes:m})},30000);return()=>{dead=true;clearInterval(timer);void finishReadingSession(sessionId.current,sessionStart.current);void recordReadingEvent(bookRecord.id,'session_end','system',{progress,text:`${Math.max(1,Math.floor((Date.now()-sessionStart.current)/60000))} min de lectura`})}},[bookRecord.id])
  useEffect(()=>{let dead=false;async function init(){try{const b=ePub(await bookRecord.file.arrayBuffer());book.current=b;await b.ready;if(dead||!host.current)return;const items=(await b.loaded.navigation)?.toc as TocItem[]||[];setToc(items);try{if(bookRecord.locations)b.locations.load(bookRecord.locations);else{await b.locations.generate(1200);await db.books.update(bookRecord.id,{locations:b.locations.save()})}}catch{}const r=b.renderTo(host.current,{width:'100%',height:'100%',spread:'none',flow:settingsRef.current.pageMode==='scroll'?'scrolled-doc':'paginated'});rendition.current=r;r.themes.fontSize(`${settingsRef.current.fontSize}%`);r.themes.override('line-height',String(settingsRef.current.lineHeight));r.themes.override('padding',`0 ${settingsRef.current.margins}vw`);r.on('selected',(cfi:string,c:any)=>{setSelectedCfi(cfi);setSelectedText(c.window.getSelection()?.toString()?.trim()||'')});r.on('rendered',()=>setTimeout(attachFrames,0));r.on('relocated',async(loc:any)=>{const p=Number(loc?.start?.percentage??0),safe=Number.isFinite(p)?Math.max(0,Math.min(1,p)):0,cfi=loc?.start?.cfi||'',h=loc?.start?.href||'',ch=tocLabel(items,h);setProgress(safe);setHref(h);setChapter(ch);setLocation(loc?.start?.displayed?`${loc.start.displayed.page} / ${loc.start.displayed.total}`:`${Math.round(safe*100)}%`);await db.books.update(bookRecord.id,{progress:safe,cfi,lastOpenedAt:Date.now(),readingStatus:safe>.985?'read':safe>.001?'reading':bookRecord.readingStatus});if(ch&&ch!==lastChapter.current){lastChapter.current=ch;void recordReadingEvent(bookRecord.id,'chapter','book',{chapter:ch,href:h,cfi,progress:safe})}try{const c:any=r.getContents(),active=Array.isArray(c)?c[0]:c,text=active?.document?.body?.innerText||'';setNearby(text.replace(/\s+/g,' ').trim().slice(0,6500))}catch{}setTimeout(attachFrames,0)});await r.display(bookRecord.cfi||undefined);for(const h of await db.highlights.where('bookId').equals(bookRecord.id).toArray())applyHighlight(h.cfiRange,h.category,h.color||'#F5D547',h.opacity??.5);setTimeout(attachFrames,40)}catch(e){console.error(e)}}void init();return()=>{dead=true;try{rendition.current?.destroy()}catch{};try{book.current?.destroy()}catch{}}},[bookRecord.id])
  useEffect(()=>{const s=stage.current;if(!s)return;const a=(e:TouchEvent)=>start(e,document),b=(e:TouchEvent)=>move(e),c=(e:TouchEvent)=>finish(e),d=(e:TouchEvent)=>finish(e,true);s.addEventListener('touchstart',a,{passive:true});s.addEventListener('touchmove',b,{passive:false});s.addEventListener('touchend',c,{passive:false});s.addEventListener('touchcancel',d,{passive:false});return()=>{s.removeEventListener('touchstart',a);s.removeEventListener('touchmove',b);s.removeEventListener('touchend',c);s.removeEventListener('touchcancel',d)}},[])

  return{host,stage,rendition,settings,setSettings,progress,location,chapter,toc,selectedText,nearby,context,limit,setLimit,minutes,navigatePage,saveHighlight,clearSelection}
}
