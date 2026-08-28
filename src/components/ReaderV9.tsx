import { AnimatePresence, motion } from 'framer-motion'
import { useState } from 'react'
import { db } from '../lib/db'
import { speakInstant } from '../lib/tts'
import type { BookRecord, HighlightCategory } from '../types'
import NavigationPanel from './NavigationPanel'
import NotebookPanel from './NotebookPanel'
import StudyPanel from './StudyPanel'
import SettingsPanel from './SettingsPanel'
import TutorPanel from './TutorPanel'
import ReadingHistoryPanel from './ReadingHistoryPanel'
import { ReaderControls, ReaderProgress, type ControlItem } from './ReaderControls'
import { useReaderEngine } from './useReaderEngine'

const COLORS=['#F5D547','#7ED9A8','#79B8FF','#F39AB5','#C7A6FF','#FFB46A','#B5E4E8','#D8D8D8']
const LABELS:Record<HighlightCategory,string>={idea:'Idea',concept:'Concepto',question:'Pregunta',quote:'Cita',argument:'Argumento',evidence:'Evidencia',contradiction:'Contradicción'}

export default function ReaderV9({bookRecord,onBack}:{bookRecord:BookRecord;onBack:()=>void}){
  const [controls,setControls]=useState(false),[tutor,setTutor]=useState(false),[nav,setNav]=useState(false),[notes,setNotes]=useState(false),[study,setStudy]=useState(false),[prefs,setPrefs]=useState(false),[history,setHistory]=useState(false)
  const [highlightMenu,setHighlightMenu]=useState(false),[color,setColor]=useState('#F5D547'),[opacity,setOpacity]=useState(.5),[category,setCategory]=useState<HighlightCategory>('idea')
  const e=useReaderEngine(bookRecord,()=>setControls(v=>!v),()=>setHistory(true))
  async function addNote(){const n=window.prompt('Nota sobre este fragmento:')?.trim();if(n)await e.saveHighlight('idea',color,opacity,n)}
  const close=()=>setControls(false)
  const items:ControlItem[]=[
    {label:'Volver',icon:'back',action:onBack},
    {label:'Índice',icon:'contents',action:()=>{setNav(true);close()}},
    {label:'Historia',icon:'history',action:()=>{setHistory(true);close()}},
    {label:'Cuaderno',icon:'notebook',action:()=>{setNotes(true);close()}},
    {label:'Estudiar',icon:'study',action:()=>{setStudy(true);close()}},
    {label:'Escuchar',icon:'audio',action:()=>{if(e.nearby)void speakInstant(e.nearby.slice(0,2200),e.settings.ttsRate);close()}},
    {label:'Apariencia',icon:'appearance',action:()=>{setPrefs(true);close()}},
    {label:'Tutor IA',icon:'tutor',action:()=>{setTutor(true);close()}}
  ]
  return <div className={`reader-shell reader-minimal theme-${e.settings.theme}`}>
    <ReaderControls open={controls} onToggle={()=>setControls(v=>!v)} items={items}/>
    <div ref={e.stage} className="reader-stage"><button className="tap-zone left" aria-label="Página anterior" onClick={x=>{x.stopPropagation();void e.navigatePage('prev')}}/><div ref={e.host} className="epub-viewer"/><button className="tap-zone right" aria-label="Página siguiente" onClick={x=>{x.stopPropagation();void e.navigatePage('next')}}/></div>
    <ReaderProgress progress={e.progress} chapter={e.chapter} location={e.location}/>

    {e.selectedText&&!tutor&&<><motion.div className="selection-actions" initial={{scale:.95,opacity:0}} animate={{scale:1,opacity:1}}><button onClick={()=>setHighlightMenu(v=>!v)}>Subrayar</button><button onClick={()=>setTutor(true)}>Preguntar</button><button onClick={()=>speakInstant(e.selectedText,e.settings.ttsRate)}>Escuchar</button><button onClick={()=>void addNote()}>Nota</button><button onClick={()=>{e.clearSelection();setHighlightMenu(false)}}>×</button></motion.div>{highlightMenu&&<motion.section className="highlight-palette" initial={{y:8,opacity:0}} animate={{y:0,opacity:1}}><header><strong>Resaltado</strong><button onClick={()=>setHighlightMenu(false)}>×</button></header><div className="highlight-colors">{COLORS.map(c=><button key={c} aria-label={`Color ${c}`} className={color===c?'active':''} style={{background:c}} onClick={()=>setColor(c)}/>)}<label className="custom-color" title="Color personalizado"><input type="color" value={color} onChange={x=>setColor(x.target.value)}/><span>＋</span></label></div><label className="highlight-opacity"><span>Intensidad <b>{Math.round(opacity*100)}%</b></span><input type="range" min="20" max="90" step="5" value={Math.round(opacity*100)} onChange={x=>setOpacity(Number(x.target.value)/100)}/></label><div className="highlight-categories">{(Object.keys(LABELS) as HighlightCategory[]).map(c=><button key={c} className={category===c?'active':''} onClick={()=>setCategory(c)}>{LABELS[c]}</button>)}</div><button className="apply-highlight" onClick={()=>{void e.saveHighlight(category,color,opacity);setHighlightMenu(false)}}>Aplicar resaltado</button></motion.section>}</>}

    <NavigationPanel open={nav} onClose={()=>setNav(false)} toc={e.toc} bookId={bookRecord.id} progress={e.progress} strictSpoilers={e.settings.spoilerPolicy==='strict'} onNavigate={x=>{void e.rendition.current?.display(x);setNav(false)}}/>
    <NotebookPanel open={notes} onClose={()=>setNotes(false)} bookId={bookRecord.id} onNavigateHighlight={x=>{void e.rendition.current?.display(x);setNotes(false)}}/>
    <StudyPanel open={study} onClose={()=>setStudy(false)} context={e.context}/>
    <SettingsPanel open={prefs} onClose={()=>setPrefs(false)} settings={e.settings} onChange={e.setSettings} bookType={bookRecord.type} onBookType={type=>void db.books.update(bookRecord.id,{type})}/>
    <TutorPanel open={tutor} onClose={()=>setTutor(false)} context={e.context}/>
    <ReadingHistoryPanel open={history} onClose={()=>setHistory(false)} book={{...bookRecord,progress:e.progress}} context={e.context}/>
    <AnimatePresence>{e.limit&&<motion.div className="session-limit-notice" initial={{y:25,opacity:0}} animate={{y:0,opacity:1}}><div><strong>Límite de sesión alcanzado</strong><p>Llevas aproximadamente {e.minutes} min. Puedes descansar o continuar.</p></div><button onClick={()=>e.setLimit(false)}>Seguir leyendo</button><button onClick={onBack}>Terminar</button></motion.div>}</AnimatePresence>
  </div>
}
