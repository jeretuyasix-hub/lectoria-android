import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useMemo, useState } from 'react'
import { askTutor, localTutorFallback } from '../lib/ai'
import { db } from '../lib/db'
import { getChapterText, retrieveContextDetailed } from '../lib/rag'
import type { ReaderContext, StudyArtifactRecord, StudyArtifactType } from '../types'

type Action={type:StudyArtifactType;label:string;title:string;prompt:string}
const baseActions:Action[]=[
  {type:'chapter_review',label:'Cerrar sección',title:'Cierre de sección',prompt:'Analiza únicamente el material alcanzado de la sección actual. Produce: 1) ideas centrales, 2) conceptos nuevos, 3) estructura del argumento o desarrollo, 4) relaciones entre conceptos, 5) una duda posible y 6) una pregunta de comprobación. Sé preciso y no uses información posterior.'},
  {type:'concept_map',label:'Mapa conceptual',title:'Mapa conceptual',prompt:'Construye un mapa conceptual textual del material leído hasta aquí. Usa CONCEPTO → RELACIÓN → CONCEPTO, agrupa por niveles y distingue tesis, argumentos, evidencias, personajes o procesos cuando proceda.'},
  {type:'flashcards',label:'Fichas de estudio',title:'Fichas de estudio',prompt:'Crea entre 5 y 8 fichas de estudio solo con contenido alcanzado. Formato: PREGUNTA: ... / RESPUESTA: ... Incluye definiciones, relaciones y una pregunta de transferencia. No inventes información.'}
]
function adaptation(type:ReaderContext['bookType']){
  if(type==='novel')return'Es una obra narrativa: prioriza personajes, conflictos, motivos, cambios de perspectiva, símbolos y relaciones causales sin revelar acontecimientos posteriores.'
  if(type==='philosophy')return'Es filosofía: reconstruye tesis, distinciones, premisas, inferencias, objeciones y consecuencias. No reduzcas argumentos a palabras clave.'
  if(type==='science')return'Es ciencia: distingue conceptos, mecanismos, evidencia, condiciones, modelos y límites de validez.'
  if(type==='social_science')return'Es ciencia social: distingue concepto, mecanismo, nivel de análisis, evidencia, causalidad, interpretación y alcance de generalización.'
  if(type==='academic')return'Es texto académico: identifica problema, marco conceptual, método cuando aparezca, evidencia, resultados y límites.'
  if(type==='manual')return'Es manual: prioriza procedimiento, condiciones, secuencia, errores frecuentes y criterio de éxito.'
  if(type==='study')return'Es material de estudio: prioriza recuperabilidad, relaciones y transferencia, no mera repetición.'
  return'Es un ensayo: prioriza tesis, argumentos, conceptos, ejemplos, objeciones y estructura del razonamiento.'
}
function when(time:number){return new Intl.DateTimeFormat('es',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}).format(new Date(time))}

export default function StudyPanel({open,onClose,context}:{open:boolean;onClose:()=>void;context:ReaderContext}){
  const [busy,setBusy]=useState<string|null>(null),[result,setResult]=useState(''),[history,setHistory]=useState<StudyArtifactRecord[]>([]),[status,setStatus]=useState('')
  const actions=useMemo(()=>baseActions.map(a=>({...a,prompt:`${a.prompt}\n\nADAPTACIÓN: ${adaptation(context.bookType)}`})),[context.bookType])
  async function refresh(){setHistory((await db.studyArtifacts.where('bookId').equals(context.bookId).reverse().sortBy('createdAt')).slice(0,8))}
  useEffect(()=>{if(open){void refresh();setStatus('')}},[open,context.bookId])

  async function generate(action:Action){
    if(busy)return;setBusy(action.type);setResult('');setStatus('Preparando únicamente material alcanzado…')
    try{
      const [chapterResult,retrievedResult]=await Promise.allSettled([getChapterText(context.bookId,context.currentHref,context.progress),retrieveContextDetailed(context.bookId,action.prompt,context.progress,context.spoilerPolicy==='strict',5)])
      const chapter=chapterResult.status==='fulfilled'?chapterResult.value.slice(0,18000):'',retrieval=retrievedResult.status==='fulfilled'?retrievedResult.value:{text:'',refs:[]}
      const enriched:ReaderContext={...context,nearbyText:chapter||context.nearbyText,retrievedText:retrieval.text}
      let answer='';try{answer=await askTutor(enriched,[{role:'user',content:action.prompt,source:'reader'}])}catch{answer=localTutorFallback(enriched,action.prompt)}
      setResult(answer);setStatus('Guardado en tu Cuaderno.')
      try{await db.studyArtifacts.add({bookId:context.bookId,type:action.type,title:action.title,content:answer,chapterHref:context.currentHref,createdAt:Date.now()});await refresh()}catch{setStatus('Generado, pero no se pudo guardar localmente.')}
    }catch(error){console.warn('Lectoria Estudio:',error);setResult('No se pudo preparar este material de estudio. Tu lectura y tus anotaciones siguen intactas. Inténtalo nuevamente.');setStatus('')}
    finally{setBusy(null)}
  }
  async function copy(){if(!result)return;try{await navigator.clipboard.writeText(result);setStatus('Copiado al portapapeles.')}catch{setStatus('No se pudo copiar en este dispositivo.')}}

  return <AnimatePresence>{open&&<><motion.button className="panel-backdrop" aria-label="Cerrar estudio" onClick={onClose} initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}/><motion.aside role="dialog" aria-modal="true" aria-label="Estudio" tabIndex={-1} className="study-sheet premium-study-sheet" initial={{y:'105%',opacity:0,scale:.99}} animate={{y:0,opacity:1,scale:1}} exit={{y:'105%',opacity:0}} transition={{type:'spring',stiffness:390,damping:38,mass:.82}}>
    <div className="tutor-grabber" aria-hidden="true"/><header className="side-header"><div><strong>Estudio</strong><span>{adaptation(context.bookType).split(':').pop()?.trim()}</span></div><button onClick={onClose} aria-label="Cerrar estudio">×</button></header>
    <div className="study-context"><span>{context.currentChapter||'Sección actual'}</span><b>{Math.round(context.progress*100)}%</b><em>{context.spoilerPolicy==='strict'?'🔒 Solo contenido alcanzado':'Contenido posterior permitido'}</em></div>
    <div className="study-actions premium-study-actions">{actions.map((a,i)=><motion.button key={a.type} disabled={!!busy} onClick={()=>void generate(a)} whileTap={{scale:.96}} initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} transition={{delay:i*.035}}><span>{busy===a.type?'Analizando…':a.label}</span><small>{a.type==='chapter_review'?'Síntesis estructurada':a.type==='concept_map'?'Relaciones entre ideas':'Recuperación activa'}</small></motion.button>)}</div>
    {status&&<p className="study-status" aria-live="polite">{status}</p>}
    <div className="study-result" aria-live="polite">{result?<><div className="study-result-head"><strong>Resultado actual</strong><button onClick={()=>void copy()}>Copiar</button></div><p className="prewrap">{result}</p></>:<div className="study-empty"><div className="study-orbit" aria-hidden="true"><i/><i/><i/></div><strong>Procesa después de leer.</strong><p>Elige una operación. El resultado quedará guardado y separado de tus notas originales.</p></div>}</div>
    {history.length>0&&<section className="study-history"><header><strong>Generados recientemente</strong><span>{history.length}</span></header>{history.slice(0,4).map(a=><button key={a.id} onClick={()=>{setResult(a.content);setStatus(`Recuperado: ${a.title}`)}}><div><b>{a.title}</b><time>{when(a.createdAt)}</time></div><span>{a.content.slice(0,150)}{a.content.length>150?'…':''}</span></button>)}</section>}
  </motion.aside></>}</AnimatePresence>
}
