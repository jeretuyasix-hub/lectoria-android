import { useEffect, useMemo, useRef, useState } from 'react'
import ePub, { type Book, type Rendition } from 'epubjs'
import { AnimatePresence, motion } from 'framer-motion'
import { db } from '../lib/db'
import { getHabitSettings, finishReadingSession, startReadingSession } from '../lib/habit'
import { recordReadingEvent, shouldOfferReentry } from '../lib/history'
import { speak } from '../lib/tts'
import type { BookRecord, HighlightCategory, ReaderContext, ReaderSettings, TocItem } from '../types'
import NavigationPanel from './NavigationPanel'
import NotebookPanel from './NotebookPanel'
import StudyPanel from './StudyPanel'
import SettingsPanel from './SettingsPanel'
import TutorPanel from './TutorPanel'
import ReadingHistoryPanel from './ReadingHistoryPanel'

const DEFAULT: ReaderSettings = { fontSize: 100, theme: 'paper', pageMode: 'curl', lineHeight: 1.72, margins: 7, spoilerPolicy: 'strict', prepAudio: false, ttsRate: 1 }
function loadSettings(): ReaderSettings { try { return { ...DEFAULT, ...JSON.parse(localStorage.getItem('lectoria-settings') || '{}') } } catch { return DEFAULT } }
function tocLabel(items:TocItem[], href:string):string { const clean=href.split('#')[0]; for(const i of items){ if(clean.endsWith(i.href.split('#')[0])||i.href.split('#')[0].endsWith(clean)) return i.label; const c=i.subitems?.length?tocLabel(i.subitems,href):''; if(c)return c } return '' }
const clamp=(value:number,min:number,max:number)=>Math.max(min,Math.min(max,value))

type SwipeState={
  active:boolean; dragging:boolean; blocked:boolean; startX:number; startY:number; lastX:number; lastY:number;
  startAt:number; lastAt:number; velocityX:number; width:number; direction:'next'|'prev'; sourceDocument:Document|null
}

export default function Reader({ bookRecord, onBack }:{ bookRecord:BookRecord; onBack:()=>void }) {
  const host=useRef<HTMLDivElement>(null), stage=useRef<HTMLDivElement>(null), book=useRef<Book|null>(null), rendition=useRef<Rendition|null>(null)
  const attachedDocs=useRef(new WeakSet<Document>()), navBusy=useRef(false), settingsRef=useRef<ReaderSettings>(loadSettings())
  const swipe=useRef<SwipeState>({active:false,dragging:false,blocked:false,startX:0,startY:0,lastX:0,lastY:0,startAt:0,lastAt:0,velocityX:0,width:1,direction:'next',sourceDocument:null})
  const [settings,setSettings]=useState(loadSettings), [controls,setControls]=useState(true), [progress,setProgress]=useState(bookRecord.progress||0)
  const [selectedText,setSelectedText]=useState(''), [selectedCfi,setSelectedCfi]=useState(''), [nearby,setNearby]=useState('')
  const [toc,setToc]=useState<TocItem[]>([]), [href,setHref]=useState(''), [chapter,setChapter]=useState(''), [location,setLocation]=useState('')
  const [tutor,setTutor]=useState(false), [nav,setNav]=useState(false), [notes,setNotes]=useState(false), [study,setStudy]=useState(false), [prefs,setPrefs]=useState(false), [history,setHistory]=useState(false)
  const [limit,setLimit]=useState(false), [minutes,setMinutes]=useState(0)
  const sessionStart=useRef(Date.now()), sessionId=useRef<number|undefined>(undefined), lastChapter=useRef('')
  const context:ReaderContext=useMemo(()=>({bookId:bookRecord.id,title:bookRecord.title,author:bookRecord.author,selectedText,nearbyText:nearby,currentChapter:chapter,currentHref:href,progress,spoilerPolicy:settings.spoilerPolicy,bookType:bookRecord.type||'essay'}),[bookRecord,selectedText,nearby,chapter,href,progress,settings.spoilerPolicy])

  settingsRef.current=settings

  function resetSwipeVisual(animated=true){
    const page=host.current, shell=stage.current
    if(!page||!shell)return
    if(animated){
      page.style.transition='transform 170ms cubic-bezier(.2,.78,.25,1), opacity 170ms ease'
      requestAnimationFrame(()=>{page.style.transform='translate3d(0,0,0) rotateY(0deg) scale(1)';page.style.opacity='1';shell.style.setProperty('--lectoria-swipe','0')})
      window.setTimeout(()=>{if(page){page.style.transition='';page.style.transform='';page.style.opacity=''};shell.classList.remove('lectoria-swipe-next','lectoria-swipe-prev','lectoria-swiping')},185)
    }else{
      page.style.transition='';page.style.transform='';page.style.opacity='';shell.style.setProperty('--lectoria-swipe','0');shell.classList.remove('lectoria-swipe-next','lectoria-swipe-prev','lectoria-swiping')
    }
  }

  function paintSwipe(dx:number,width:number,direction:'next'|'prev'){
    const page=host.current, shell=stage.current
    if(!page||!shell)return
    const p=clamp(Math.abs(dx)/Math.max(1,width),0,1)
    const visualX=clamp(dx*0.18,-width*0.075,width*0.075)
    const angle=(direction==='next'?-1:1)*(2+p*12)
    const scale=1-p*0.012
    page.style.transition='none'
    page.style.transformOrigin=direction==='next'?'100% 50%':'0% 50%'
    page.style.transform=`translate3d(${visualX}px,0,0) perspective(1500px) rotateY(${angle}deg) scale(${scale})`
    page.style.opacity=String(1-p*0.055)
    shell.style.setProperty('--lectoria-swipe',String(p))
    shell.classList.add('lectoria-swiping')
    shell.classList.toggle('lectoria-swipe-next',direction==='next')
    shell.classList.toggle('lectoria-swipe-prev',direction==='prev')
  }

  async function navigatePage(dir:'next'|'prev',fromGesture=false){
    const r=rendition.current
    if(!r||navBusy.current)return
    navBusy.current=true
    const page=host.current
    try{
      if(fromGesture&&page){
        page.style.transition='transform 115ms cubic-bezier(.24,.8,.3,1), opacity 115ms ease'
        const sign=dir==='next'?-1:1
        page.style.transformOrigin=dir==='next'?'100% 50%':'0% 50%'
        page.style.transform=`translate3d(${sign*34}px,0,0) perspective(1500px) rotateY(${sign*16}deg) scale(.985)`
        page.style.opacity='.94'
        await new Promise(resolve=>window.setTimeout(resolve,70))
      }
      await (dir==='next'?r.next():r.prev())
      if(fromGesture&&page){
        const sign=dir==='next'?1:-1
        page.style.transition='none'
        page.style.transform=`translate3d(${sign*18}px,0,0) perspective(1500px) rotateY(${sign*6}deg) scale(.994)`
        page.style.opacity='.97'
        requestAnimationFrame(()=>requestAnimationFrame(()=>resetSwipeVisual(true)))
      }else resetSwipeVisual(false)
    }catch(error){
      console.warn('Lectoria: no se pudo cambiar de página',error)
      resetSwipeVisual(true)
    }finally{
      window.setTimeout(()=>{navBusy.current=false},90)
    }
  }

  function touchPoint(touch:Touch,doc:Document){
    if(doc===document){const rect=host.current?.getBoundingClientRect();return rect?{x:touch.clientX-rect.left,y:touch.clientY-rect.top}:{x:touch.clientX,y:touch.clientY}}
    return {x:touch.clientX,y:touch.clientY}
  }

  function startSwipe(event:TouchEvent,doc:Document){
    if(settingsRef.current.pageMode==='scroll'||event.touches.length!==1||navBusy.current)return
    const target=event.target as Element|null
    if(target?.closest('button,input,textarea,select,a'))return
    const selection=doc.defaultView?.getSelection()?.toString().trim()||''
    if(selection)return
    const point=touchPoint(event.touches[0],doc), now=performance.now()
    const width=doc===document?(host.current?.getBoundingClientRect().width||window.innerWidth):(doc.defaultView?.innerWidth||window.innerWidth)
    swipe.current={active:true,dragging:false,blocked:false,startX:point.x,startY:point.y,lastX:point.x,lastY:point.y,startAt:now,lastAt:now,velocityX:0,width:Math.max(1,width),direction:'next',sourceDocument:doc}
  }

  function moveSwipe(event:TouchEvent){
    const g=swipe.current
    if(!g.active||g.blocked||event.touches.length!==1||!g.sourceDocument)return
    const point=touchPoint(event.touches[0],g.sourceDocument), dx=point.x-g.startX, dy=point.y-g.startY
    const ax=Math.abs(dx), ay=Math.abs(dy), elapsedFromStart=performance.now()-g.startAt
    if(!g.dragging){
      if(ax<7&&ay<7)return
      if(elapsedFromStart>280){g.blocked=true;return}
      if(ay>ax*1.15){g.blocked=true;return}
      if(ax<=ay)return
      g.dragging=true
      g.direction=dx<0?'next':'prev'
    }
    if(event.cancelable)event.preventDefault()
    const now=performance.now(), dt=Math.max(1,now-g.lastAt)
    g.velocityX=(point.x-g.lastX)/dt;g.lastX=point.x;g.lastY=point.y;g.lastAt=now
    paintSwipe(dx,g.width,g.direction)
  }

  function finishSwipe(event:TouchEvent,cancelled=false){
    const g=swipe.current
    if(!g.active)return
    const touch=event.changedTouches[0]
    if(touch&&g.sourceDocument){
      const point=touchPoint(touch,g.sourceDocument), now=performance.now(), dt=Math.max(1,now-g.lastAt)
      g.velocityX=(point.x-g.lastX)/dt;g.lastX=point.x;g.lastY=point.y;g.lastAt=now
    }
    g.active=false
    if(g.blocked){resetSwipeVisual(true);return}
    const dx=g.lastX-g.startX, dy=g.lastY-g.startY, distance=Math.abs(dx)
    if(!g.dragging){
      if(cancelled)return
      const selection=g.sourceDocument?.defaultView?.getSelection()?.toString().trim()||''
      if(selection)return
      if(distance<10&&Math.abs(dy)<10){
        if(g.startX>g.width*.78)void navigatePage('next')
        else if(g.startX<g.width*.22)void navigatePage('prev')
        else setControls(v=>!v)
      }
      return
    }
    if(event.cancelable)event.preventDefault()
    if(cancelled){resetSwipeVisual(true);return}
    const correctDirection=(g.direction==='next'&&dx<0)||(g.direction==='prev'&&dx>0)
    const threshold=Math.min(118,g.width*.13)
    const flick=Math.abs(g.velocityX)>.42&&distance>24
    if(correctDirection&&(distance>=threshold||flick))void navigatePage(g.direction,true)
    else resetSwipeVisual(true)
  }

  function attachDocument(doc:Document){
    if(attachedDocs.current.has(doc))return
    attachedDocs.current.add(doc)
    doc.documentElement.style.touchAction='pan-y pinch-zoom'
    if(doc.body)doc.body.style.touchAction='pan-y pinch-zoom'
    doc.addEventListener('touchstart',e=>startSwipe(e,doc),{passive:true})
    doc.addEventListener('touchmove',moveSwipe,{passive:false})
    doc.addEventListener('touchend',e=>finishSwipe(e),{passive:false})
    doc.addEventListener('touchcancel',e=>finishSwipe(e,true),{passive:false})
  }

  function attachRenditionDocuments(){
    const r:any=rendition.current
    if(!r)return
    try{const contents=r.getContents?.()||[];for(const content of contents){if(content?.document)attachDocument(content.document)}}catch{}
  }

  useEffect(()=>{ localStorage.setItem('lectoria-settings',JSON.stringify(settings)); document.documentElement.dataset.readerTheme=settings.theme; const r=rendition.current; if(r){ r.themes.fontSize(`${settings.fontSize}%`); r.themes.override('line-height',String(settings.lineHeight)); r.themes.override('padding',`0 ${settings.margins}vw`) } },[settings])

  useEffect(()=>{
    let dead=false; sessionStart.current=Date.now()
    void getHabitSettings().then(async h=>{ if(dead)return; sessionId.current=await startReadingSession(bookRecord.id); if((await shouldOfferReentry(bookRecord,h.reentryHours)).offer) setTimeout(()=>!dead&&setHistory(true),700) })
    void recordReadingEvent(bookRecord.id,'session_start','system',{progress:bookRecord.progress,cfi:bookRecord.cfi})
    const timer=setInterval(()=>{ const m=Math.max(1,Math.floor((Date.now()-sessionStart.current)/60000)); setMinutes(m); void getHabitSettings().then(h=>{if(h.maxSessionMinutes&&m>=h.maxSessionMinutes)setLimit(true)}); if(sessionId.current)void db.readingSessions.update(sessionId.current,{minutes:m}) },30000)
    return()=>{dead=true;clearInterval(timer);void finishReadingSession(sessionId.current,sessionStart.current);void recordReadingEvent(bookRecord.id,'session_end','system',{progress,text:`${Math.max(1,Math.floor((Date.now()-sessionStart.current)/60000))} min de lectura`})}
  },[bookRecord.id])

  useEffect(()=>{
    let dead=false
    async function init(){
      try{
        const b=ePub(await bookRecord.file.arrayBuffer()); book.current=b; await b.ready; if(dead||!host.current)return
        const items=(await b.loaded.navigation)?.toc as TocItem[]||[]; setToc(items)
        try{ if(bookRecord.locations)b.locations.load(bookRecord.locations); else{await b.locations.generate(1200);await db.books.update(bookRecord.id,{locations:b.locations.save()})} }catch{}
        const r=b.renderTo(host.current,{width:'100%',height:'100%',spread:'none',flow:settingsRef.current.pageMode==='scroll'?'scrolled-doc':'paginated'}); rendition.current=r
        r.themes.fontSize(`${settingsRef.current.fontSize}%`); r.themes.override('line-height',String(settingsRef.current.lineHeight)); r.themes.override('padding',`0 ${settingsRef.current.margins}vw`)
        r.on('selected',(cfi:string,c:any)=>{setSelectedCfi(cfi);setSelectedText(c.window.getSelection()?.toString()?.trim()||'')})
        r.on('rendered',()=>window.setTimeout(attachRenditionDocuments,0))
        r.on('relocated',async(loc:any)=>{ const p=Number(loc?.start?.percentage??0); const safe=Number.isFinite(p)?Math.max(0,Math.min(1,p)):0; const cfi=loc?.start?.cfi||'', h=loc?.start?.href||'', ch=tocLabel(items,h); setProgress(safe);setHref(h);setChapter(ch);setLocation(loc?.start?.displayed?`${loc.start.displayed.page} / ${loc.start.displayed.total}`:`${Math.round(safe*100)}%`); await db.books.update(bookRecord.id,{progress:safe,cfi,lastOpenedAt:Date.now(),readingStatus:safe>.985?'read':safe>.001?'reading':bookRecord.readingStatus}); if(ch&&ch!==lastChapter.current){lastChapter.current=ch;void recordReadingEvent(bookRecord.id,'chapter','book',{chapter:ch,href:h,cfi,progress:safe})} try{const contents:any=r.getContents();const active=Array.isArray(contents)?contents[0]:contents;const text=active?.document?.body?.innerText||'';setNearby(text.replace(/\s+/g,' ').trim().slice(0,6500))}catch{} window.setTimeout(attachRenditionDocuments,0) })
        await r.display(bookRecord.cfi||undefined)
        window.setTimeout(attachRenditionDocuments,40)
      }catch(e){console.error(e)}
    }
    void init(); return()=>{dead=true;resetSwipeVisual(false);try{rendition.current?.destroy()}catch{};try{book.current?.destroy()}catch{}}
  },[bookRecord.id])

  useEffect(()=>{
    const s=stage.current;if(!s)return
    const start=(e:TouchEvent)=>startSwipe(e,document), move=(e:TouchEvent)=>moveSwipe(e), end=(e:TouchEvent)=>finishSwipe(e), cancel=(e:TouchEvent)=>finishSwipe(e,true)
    s.addEventListener('touchstart',start,{passive:true});s.addEventListener('touchmove',move,{passive:false});s.addEventListener('touchend',end,{passive:false});s.addEventListener('touchcancel',cancel,{passive:false})
    return()=>{s.removeEventListener('touchstart',start);s.removeEventListener('touchmove',move);s.removeEventListener('touchend',end);s.removeEventListener('touchcancel',cancel)}
  },[])

  async function saveHighlight(category:HighlightCategory,note?:string){ if(!selectedText||!selectedCfi)return; await db.highlights.add({bookId:bookRecord.id,cfiRange:selectedCfi,text:selectedText,category,note,createdAt:Date.now()});try{rendition.current?.annotations.highlight(selectedCfi,{category},undefined,`highlight-${category}`)}catch{};void recordReadingEvent(bookRecord.id,note?'note':'highlight',note?'reader':'book',{chapter,href,cfi:selectedCfi,progress,text:(note||selectedText).slice(0,420)});setSelectedText('');setSelectedCfi('') }
  async function addNote(){const n=window.prompt('Nota sobre este fragmento:')?.trim();if(n)await saveHighlight('idea',n)}

  return <div className={`reader-shell theme-${settings.theme}`} onClick={e=>{if(!(e.target as HTMLElement).closest('button,input,select,.side-panel,.tutor-panel,.selection-actions,.settings-sheet,.study-sheet'))setControls(v=>!v)}}>
    <AnimatePresence>{controls&&<motion.header className="reader-topbar" initial={{y:-50,opacity:0}} animate={{y:0,opacity:1}} exit={{y:-50,opacity:0}}><button onClick={onBack}>←</button><button onClick={()=>setNav(true)}>☰</button><div className="reader-title"><strong>{bookRecord.title}</strong><span>{chapter||bookRecord.author}</span></div><button onClick={()=>setHistory(true)}>Historia</button><button onClick={()=>setPrefs(true)}>Aa</button><button onClick={()=>setTutor(true)}>Tutor IA</button></motion.header>}</AnimatePresence>
    <div ref={stage} className="reader-stage"><button className="tap-zone left" onClick={e=>{e.stopPropagation();void navigatePage('prev')}}/><div ref={host} className="epub-viewer"/><button className="tap-zone right" onClick={e=>{e.stopPropagation();void navigatePage('next')}}/><div className="lectoria-fold-shadow" aria-hidden="true"/></div>
    <AnimatePresence>{controls&&<motion.footer className="reader-bottombar" initial={{y:70,opacity:0}} animate={{y:0,opacity:1}} exit={{y:70,opacity:0}}><button onClick={()=>setNotes(true)}>Cuaderno</button><button onClick={()=>setStudy(true)}>Estudiar</button><button onClick={()=>nearby&&speak(nearby.slice(0,1800),settings.ttsRate)}>Escuchar</button><div className="bottom-progress"><div className="progress-track"><div className="progress-fill" style={{width:`${Math.round(progress*100)}%`}}/></div><span>{location||`${Math.round(progress*100)}%`}</span></div></motion.footer>}</AnimatePresence>
    {selectedText&&!tutor&&<motion.div className="selection-actions" initial={{scale:.95,opacity:0}} animate={{scale:1,opacity:1}}><button onClick={()=>void saveHighlight('idea')}>Subrayar</button><button onClick={()=>setTutor(true)}>Preguntar</button><button onClick={()=>speak(selectedText,settings.ttsRate)}>Escuchar</button><button onClick={()=>void addNote()}>Nota</button><button onClick={()=>{setSelectedText('');setSelectedCfi('')}}>×</button></motion.div>}
    <button className="floating-tutor" onClick={()=>setTutor(true)}>✦</button>
    <NavigationPanel open={nav} onClose={()=>setNav(false)} toc={toc} bookId={bookRecord.id} progress={progress} strictSpoilers={settings.spoilerPolicy==='strict'} onNavigate={x=>{void rendition.current?.display(x);setNav(false)}}/>
    <NotebookPanel open={notes} onClose={()=>setNotes(false)} bookId={bookRecord.id} onNavigateHighlight={x=>{void rendition.current?.display(x);setNotes(false)}}/>
    <StudyPanel open={study} onClose={()=>setStudy(false)} context={context}/>
    <SettingsPanel open={prefs} onClose={()=>setPrefs(false)} settings={settings} onChange={setSettings} bookType={bookRecord.type} onBookType={type=>void db.books.update(bookRecord.id,{type})}/>
    <TutorPanel open={tutor} onClose={()=>setTutor(false)} context={context}/>
    <ReadingHistoryPanel open={history} onClose={()=>setHistory(false)} book={{...bookRecord,progress}} context={context}/>
    <AnimatePresence>{limit&&<motion.div className="session-limit-notice" initial={{y:25,opacity:0}} animate={{y:0,opacity:1}}><div><strong>Límite de sesión alcanzado</strong><p>Llevas aproximadamente {minutes} min. Puedes descansar o continuar.</p></div><button onClick={()=>setLimit(false)}>Seguir leyendo</button><button onClick={onBack}>Terminar</button></motion.div>}</AnimatePresence>
  </div>
}
