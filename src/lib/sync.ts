import { db } from './db'
import type { BookRecord } from '../types'

const MAGIC='LECTORIA1\n'
const LENGTH_WIDTH=12
interface BackupBook extends Omit<BookRecord,'file'>{fileName:string;fileSize:number;fileType:string}
interface BackupHeader{version:1|2|3;exportedAt:number;app:'Lectoria';books:BackupBook[];highlights:unknown[];tutorMessages:unknown[];tutorMemory:unknown[];studyArtifacts:unknown[];readingEvents?:unknown[];readingSessions?:unknown[];preferences?:unknown[]}
function download(blob:Blob,filename:string){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();window.setTimeout(()=>URL.revokeObjectURL(url),1500)}
function safeSize(value:unknown){const n=Number(value);return Number.isSafeInteger(n)&&n>=0?n:-1}

export async function createBackupBlob(){
  const books=await db.books.toArray()
  const header:BackupHeader={version:3,exportedAt:Date.now(),app:'Lectoria',books:books.map(book=>{const{file,...rest}=book;return{...rest,indexingStatus:'pending',indexedAt:undefined,fileName:file.name||`${book.title}.epub`,fileSize:file.size,fileType:file.type||'application/epub+zip'}}),highlights:await db.highlights.toArray(),tutorMessages:await db.tutorMessages.toArray(),tutorMemory:await db.tutorMemory.toArray(),studyArtifacts:await db.studyArtifacts.toArray(),readingEvents:await db.readingEvents.toArray(),readingSessions:await db.readingSessions.toArray(),preferences:await db.preferences.toArray()}
  const headerBytes=new TextEncoder().encode(JSON.stringify(header)),lengthLine=`${String(headerBytes.byteLength).padStart(LENGTH_WIDTH,'0')}\n`
  return new Blob([MAGIC,lengthLine,headerBytes,...books.map(b=>b.file)],{type:'application/octet-stream'})
}
export async function downloadBackup(){download(await createBackupBlob(),`Lectoria-${new Date().toISOString().slice(0,10)}.lectoria`)}

export async function restoreBackup(file:File):Promise<BookRecord[]>{
  if(file.size<MAGIC.length+LENGTH_WIDTH+2)throw new Error('El respaldo está vacío o incompleto.')
  const prefixSize=MAGIC.length+LENGTH_WIDTH+1,prefix=await file.slice(0,prefixSize).text()
  if(!prefix.startsWith(MAGIC))throw new Error('El archivo no es un respaldo válido de Lectoria.')
  const headerLength=Number(prefix.slice(MAGIC.length,MAGIC.length+LENGTH_WIDTH))
  if(!Number.isSafeInteger(headerLength)||headerLength<=0||headerLength>64*1024*1024)throw new Error('La cabecera del respaldo es inválida.')
  const headerStart=prefixSize,headerEnd=headerStart+headerLength
  if(headerEnd>file.size)throw new Error('El respaldo está truncado antes de terminar su cabecera.')
  let header:BackupHeader
  try{header=JSON.parse(await file.slice(headerStart,headerEnd).text()) as BackupHeader}catch{throw new Error('La cabecera del respaldo no se puede interpretar.')}
  if(![1,2,3].includes(header.version)||!Array.isArray(header.books)||!Array.isArray(header.highlights)||!Array.isArray(header.tutorMessages)||!Array.isArray(header.tutorMemory)||!Array.isArray(header.studyArtifacts))throw new Error('Versión o estructura de respaldo no compatible.')
  let cursor=headerEnd;const restoredBooks:BookRecord[]=[]
  for(const meta of header.books){
    const size=safeSize(meta.fileSize);if(size<0)throw new Error(`Tamaño inválido para “${meta.title||'un libro'}”.`);if(cursor+size>file.size)throw new Error(`El respaldo termina antes de completar “${meta.title||'un libro'}”.`)
    const slice=file.slice(cursor,cursor+size,meta.fileType||'application/epub+zip');cursor+=size
    const restoredFile=typeof File!=='undefined'?new File([slice],meta.fileName||`${meta.title}.epub`,{type:meta.fileType||'application/epub+zip'}):slice as Blob&{name?:string}
    const{fileName:_fileName,fileSize:_fileSize,fileType:_fileType,...record}=meta;restoredBooks.push({...record,file:restoredFile,indexingStatus:'pending',indexedAt:undefined})
  }
  await db.transaction('rw',[db.books,db.highlights,db.tutorMessages,db.tutorMemory,db.studyArtifacts,db.chunks,db.readingEvents,db.readingSessions,db.preferences],async()=>{
    await db.books.bulkPut(restoredBooks)
    if(header.highlights.length)await db.highlights.bulkPut(header.highlights as any[])
    if(header.tutorMessages.length)await db.tutorMessages.bulkPut(header.tutorMessages as any[])
    if(header.tutorMemory.length)await db.tutorMemory.bulkPut(header.tutorMemory as any[])
    if(header.studyArtifacts.length)await db.studyArtifacts.bulkPut(header.studyArtifacts as any[])
    if(header.readingEvents?.length)await db.readingEvents.bulkPut(header.readingEvents as any[])
    if(header.readingSessions?.length)await db.readingSessions.bulkPut(header.readingSessions as any[])
    if(header.preferences?.length)await db.preferences.bulkPut(header.preferences as any[])
    for(const book of restoredBooks)await db.chunks.where('bookId').equals(book.id).delete()
  })
  return restoredBooks
}
