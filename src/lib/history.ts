import { db } from './db'
import type { BookRecord, ReadingEventRecord, ReadingEventType, ReadingSource } from '../types'

export async function recordReadingEvent(bookId:string,type:ReadingEventType,source:ReadingSource,data:Partial<ReadingEventRecord>={}){await db.readingEvents.add({bookId,type,source,createdAt:Date.now(),...data})}
function elapsedLabel(since:number){const ms=Math.max(0,Date.now()-since),hours=Math.floor(ms/3600000);if(hours<1)return'menos de una hora';if(hours<24)return`${hours} h`;const days=Math.floor(hours/24);if(days<30)return`${days} ${days===1?'día':'días'}`;const months=Math.floor(days/30);return`${months} ${months===1?'mes':'meses'}`}
function concise(text:string,max=220){const clean=text.replace(/\s+/g,' ').trim();return clean.length>max?`${clean.slice(0,max-1)}…`:clean}

const TOPIC_STOP=new Set('para como este esta esto estos estas desde hasta entre sobre pero porque donde cuando quien quienes cual cuales todo toda todos todas cada muy mas menos tambien solo solo una uno unos unas del las los que con sin por de la el en al y o se su sus es son ser fue han hay ha lo le les ya si no un tu tus mi mis libro autor texto idea ideas fragmento pasaje pregunta preguntas nota notas capitulo capítulo'.split(' '))
function normalizeWord(value:string){return value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-zñ]/g,'')}
function topTopics(rows:Array<{text:string;note?:string}>){
  const counts=new Map<string,number>()
  for(const row of rows){const source=`${row.text} ${row.note||''}`;for(const raw of source.split(/\s+/)){const word=normalizeWord(raw);if(word.length<5||TOPIC_STOP.has(word))continue;counts.set(word,(counts.get(word)||0)+1)}}
  return[...counts.entries()].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).slice(0,6).map(([name,count])=>({name,count}))
}

export async function shouldOfferReentry(book:BookRecord,reentryHours:number){
  const elapsedHours=Math.max(0,(Date.now()-book.lastOpenedAt)/3600000)
  const[highlights,messages,events]=await Promise.all([db.highlights.where('bookId').equals(book.id).toArray(),db.tutorMessages.where('bookId').equals(book.id).toArray(),db.readingEvents.where('bookId').equals(book.id).toArray()])
  const recentCutoff=Date.now()-30*86400000,recentHighlights=highlights.filter(h=>h.createdAt>=recentCutoff),recentQuestions=messages.filter(m=>m.role==='user'&&m.createdAt>=recentCutoff),lastRecap=events.filter(e=>e.type==='recap').sort((a,b)=>b.createdAt-a.createdAt)[0],distance=Math.max(0,(book.progress||0)-(lastRecap?.progress||0)),conceptualDensity=recentHighlights.filter(h=>['concept','argument','evidence'].includes(h.category)).length,difficulty=recentHighlights.filter(h=>['question','contradiction'].includes(h.category)).length+recentQuestions.length,notes=recentHighlights.filter(h=>Boolean(h.note)).length
  const score=Math.min(3,elapsedHours/Math.max(1,reentryHours)*3)+Math.min(2,conceptualDensity*.28)+Math.min(2,difficulty*.36)+Math.min(1.5,notes*.25)+(distance>=.08?1:0)
  const offer=book.progress>.001&&(elapsedHours>=reentryHours||(elapsedHours>=Math.min(24,reentryHours/2)&&score>=4.2)),reasons:string[]=[]
  if(elapsedHours>=reentryHours)reasons.push('tiempo transcurrido');if(distance>=.08)reasons.push('distancia de lectura acumulada');if(conceptualDensity>=3)reasons.push('densidad conceptual');if(difficulty>=2)reasons.push('dudas o dificultad registrada');if(notes>=2)reasons.push('cantidad de notas')
  return{offer,score,reasons,elapsedHours}
}

export async function buildReadingDigest(book:BookRecord){
  const[highlights,messages,events,memory]=await Promise.all([db.highlights.where('bookId').equals(book.id).toArray(),db.tutorMessages.where('bookId').equals(book.id).toArray(),db.readingEvents.where('bookId').equals(book.id).toArray(),db.tutorMemory.where('bookId').equals(book.id).toArray()])
  const orderedHighlights=[...highlights].sort((a,b)=>b.createdAt-a.createdAt),recentHighlights=orderedHighlights.slice(0,8),readerNotes=recentHighlights.filter(h=>h.note).slice(0,5),questions=messages.filter(m=>m.role==='user').sort((a,b)=>b.createdAt-a.createdAt).slice(0,5),answers=messages.filter(m=>m.role==='assistant').sort((a,b)=>b.createdAt-a.createdAt).slice(0,3),recentEvents=events.sort((a,b)=>b.createdAt-a.createdAt).slice(0,24),lastChapter=recentEvents.find(e=>e.chapter)?.chapter||'',pending=recentHighlights.filter(h=>h.category==='question').map(h=>concise(h.note||h.text,180)).slice(0,4),memories=memory.sort((a,b)=>b.updatedAt-a.updatedAt).slice(0,8).map(m=>`${m.key}: ${concise(m.value,180)}`)
  return{elapsed:elapsedLabel(book.lastOpenedAt),progress:Math.round((book.progress||0)*100),lastChapter,bookEvidence:recentHighlights.map(h=>({text:concise(h.text),category:h.category,createdAt:h.createdAt,cfi:h.cfiRange})),readerNotes:readerNotes.map(h=>({text:concise(h.note||''),quote:concise(h.text,130),createdAt:h.createdAt,cfi:h.cfiRange})),questions:questions.map(q=>({text:concise(q.content),createdAt:q.createdAt})),aiResponses:answers.map(a=>({text:concise(a.content,260),createdAt:a.createdAt})),pending,interests:topTopics(orderedHighlights.map(h=>({text:h.text,note:h.note}))),memories,events:recentEvents}
}

export async function getReadingTimeline(bookId:string){return(await db.readingEvents.where('bookId').equals(bookId).toArray()).sort((a,b)=>b.createdAt-a.createdAt).slice(0,120)}
