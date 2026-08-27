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
function announcePageSettled(delay=100){ window.setTimeout(()=>window.dispatchEvent(new Event('lectoria:page-settled')),delay) }

export default function Reader({ bookRecord, onBack }:{ bookRecord:BookRecord; onBack:()=>void }) {
  const host=useRef<HTMLDivElement>(null), book=useRef<Book|null>(null), rendition=useRef<Rendition|null>(null)
  const [settings,setSettings]=useState(loadSettings), [controls,setControls]=useState(true), [progress,setProgress]=useState(bookRecord.progress||0)
  const [selectedText,setSelectedText]=useState(''), [selectedCfi,setSelectedCfi]=useState(''), [nearby,setNearby]=useState('')
  const [toc,setToc]=useState<TocItem[]>([]), [href,setHref]=useState(''), [chapter,setChapter]=useState(''), [location,setLocation]=useState('')
  const [tutor,setTutor]=useState(false), [nav,setNav]=useState(false), [notes,setNotes]=useState(false), [study,setStudy]=useState(false), [prefs,setPrefs]=useState(false), [history,setHistory]=useState(false)
  const [limit,setLimit]=useState(false), [minutes,setMinutes]=useState(0)
  const sessionStart=useRef(Date.now()), sessionId=useRef<number|undefined>(undefined), lastChapter=useRef('')
  const context:ReaderContext=useMemo(()=>({bookId:bookRecord.id,title:bookRecord.title,author:bookRecord.author,selectedText,nearbyText:nearby,currentChapter:chapter,currentHref:href,progress,spoilerPolicy:settings.spoilerPolicy,bookType:bookRecord.type||'essay'}),[bookRecord,selectedText,nearby,chapter,href,progress,settings.spoilerPolicy])

  useEffect(()=>{ localStorage.setItem('lectoria-settings',JSON.stringify(settings)); document.documentElement.dataset.readerTheme=settings.theme; const r=rendition.current; if(r){ r.themes.fontSize(`${settings.fontSize}%`); r.themes.override('line-height',String(settings.lineHeight)); r.themes.override('padding',`0 ${settings.margins}vw`); announcePageSettled(180) } },[settings])

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
        const r=b.renderTo(host.current,{width:'100%',height:'100%',spread:'none',flow:settings.pageMode==='scroll'?'scrolled-doc':'paginated'}); rendition.current=r
        r.themes.fontSize(`${settings.fontSize}%`); r.themes.override('line-height',String(settings.lineHeight)); r.themes.override('padding',`0 ${settings.margins}vw`)
        r.on('selected',(cfi:string,c:any)=>{setSelectedCfi(cfi);setSelectedText(c.window.getSelection()?.toString()?.trim()||'')})
        r.on('relocated',async(loc:any)=>{ const p=Number(loc?.start?.percentage??0); const safe=Number.isFinite(p)?Math.max(0,Math.min(1,p)):0; const cfi=loc?.start?.cfi||'', h=loc?.start?.href||'', ch=tocLabel(items,h); setProgress(safe);setHref(h);setChapter(ch);setLocation(loc?.start?.displayed?`${loc.start.displayed.page} / ${loc.start.displayed.total}`:`${Math.round(safe*100)}%`); await db.books.update(bookRecord.id,{progress:safe,cfi,lastOpenedAt:Date.now(),readingStatus:safe>.985?'read':safe>.001?'reading':bookRecord.readingStatus}); if(ch&&ch!==lastChapter.current){lastChapter.current=ch;void recordReadingEvent(bookRecord.id,'chapter','book',{chapter:ch,href:h,cfi,progress:safe})} try{const contents:any=r.getContents();const active=Array.isArray(contents)?contents[0]:contents;const text=active?.document?.body?.innerText||'';setNearby(text.replace(/\s+/g,' ').trim().slice(0,6500))}catch{} announcePageSettled(120) })
        await r.display(bookRecord.cfi||undefined)
        announcePageSettled(180)
      }catch(e){console.error(e)}
    }
    void init(); return()=>{dead=true;try{rendition.current?.destroy()}catch{};try{book.current?.destroy()}catch{}}
  },[bookRecord.id])

  async function turn(dir:'next'|'prev'){ try{await (dir==='next'?rendition.current?.next():rendition.current?.prev())}finally{announcePageSettled(120)} }
  async function saveHighlight(category:HighlightCategory,note?:string){ if(!selectedText||!selectedCfi)return; await db.highlights.add({bookId:bookRecord.id,cfiRange:selectedCfi,text:selectedText,category,note,createdAt:Date.now()});try{rendition.current?.annotations.highlight(selectedCfi,{category},undefined,`highlight-${category}`)}catch{};void recordReadingEvent(bookRecord.id,note?'note':'highlight',note?'reader':'book',{chapter,href,cfi:selectedCfi,progress,text:(note||selectedText).slice(0,420)});setSelectedText('');setSelectedCfi('') }
  async function addNote(){const n=window.prompt('Nota sobre este fragmento:')?.trim();if(n)await saveHighlight('idea',n)}

  return <div className={`reader-shell theme-${settings.theme}`} onClick={e=>{if(!(e.target as HTMLElement).closest('button,input,select,.side-panel,.tutor-panel,.selection-actions,.settings-sheet,.study-sheet'))setControls(v=>!v)}}>
    <AnimatePresence>{controls&&<motion.header className="reader-topbar" initial={{y:-50,opacity:0}} animate={{y:0,opacity:1}} exit={{y:-50,opacity:0}}><button onClick={onBack}>←</button><button onClick={()=>setNav(true)}>☰</button><div className="reader-title"><strong>{bookRecord.title}</strong><span>{chapter||bookRecord.author}</span></div><button onClick={()=>setHistory(true)}>Historia</button><button onClick={()=>setPrefs(true)}>Aa</button><button onClick={()=>setTutor(true)}>Tutor IA</button></motion.header>}</AnimatePresence>
    <div className="reader-stage"><button className="tap-zone left" onClick={e=>{e.stopPropagation();void turn('prev')}}/><div ref={host} className="epub-viewer"/><button className="tap-zone right" onClick={e=>{e.stopPropagation();void turn('next')}}/></div>
    <AnimatePresence>{controls&&<motion.footer className="reader-bottombar" initial={{y:70,opacity:0}} animate={{y:0,opacity:1}} exit={{y:70,opacity:0}}><button onClick={()=>setNotes(true)}>Cuaderno</button><button onClick={()=>setStudy(true)}>Estudiar</button><button onClick={()=>nearby&&speak(nearby.slice(0,1800),settings.ttsRate)}>Escuchar</button><div className="bottom-progress"><div className="progress-track"><div className="progress-fill" style={{width:`${Math.round(progress*100)}%`}}/></div><span>{location||`${Math.round(progress*100)}%`}</span></div></motion.footer>}</AnimatePresence>
    {selectedText&&!tutor&&<motion.div className="selection-actions" initial={{scale:.95,opacity:0}} animate={{scale:1,opacity:1}}><button onClick={()=>void saveHighlight('idea')}>Subrayar</button><button onClick={()=>setTutor(true)}>Preguntar</button><button onClick={()=>speak(selectedText,settings.ttsRate)}>Escuchar</button><button onClick={()=>void addNote()}>Nota</button><button onClick={()=>{setSelectedText('');setSelectedCfi('')}}>×</button></motion.div>}
    <button className="floating-tutor" onClick={()=>setTutor(true)}>✦</button>
    <NavigationPanel open={nav} onClose={()=>setNav(false)} toc={toc} bookId={bookRecord.id} progress={progress} strictSpoilers={settings.spoilerPolicy==='strict'} onNavigate={x=>{void rendition.current?.display(x);setNav(false);announcePageSettled(180)}}/>
    <NotebookPanel open={notes} onClose={()=>setNotes(false)} bookId={bookRecord.id} onNavigateHighlight={x=>{void rendition.current?.display(x);setNotes(false);announcePageSettled(180)}}/>
    <StudyPanel open={study} onClose={()=>setStudy(false)} context={context}/>
    <SettingsPanel open={prefs} onClose={()=>setPrefs(false)} settings={settings} onChange={setSettings} bookType={bookRecord.type} onBookType={type=>void db.books.update(bookRecord.id,{type})}/>
    <TutorPanel open={tutor} onClose={()=>setTutor(false)} context={context}/>
    <ReadingHistoryPanel open={history} onClose={()=>setHistory(false)} book={{...bookRecord,progress}} context={context}/>
    <AnimatePresence>{limit&&<motion.div className="session-limit-notice" initial={{y:25,opacity:0}} animate={{y:0,opacity:1}}><div><strong>Límite de sesión alcanzado</strong><p>Llevas aproximadamente {minutes} min. Puedes descansar o continuar.</p></div><button onClick={()=>setLimit(false)}>Seguir leyendo</button><button onClick={onBack}>Terminar</button></motion.div>}</AnimatePresence>
  </div>
}
