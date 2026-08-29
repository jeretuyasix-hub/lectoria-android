import { useEffect, useState } from 'react'
import { App as NativeApp } from '@capacitor/app'
import { AnimatePresence, MotionConfig, motion } from 'framer-motion'
import Library from './components/Library'
import Reader from './components/ReaderV9'
import type { BookRecord } from './types'

export default function App(){
  const[activeBook,setActiveBook]=useState<BookRecord|null>(null)
  useEffect(()=>{let disposed=false,listener:{remove:()=>Promise<void>}|null=null;void NativeApp.addListener('backButton',()=>{const request=new Event('lectoria-back-request',{cancelable:true});window.dispatchEvent(request);if(request.defaultPrevented)return;if(activeBook){setActiveBook(null);return}void NativeApp.exitApp()}).then(handle=>{if(disposed)void handle.remove();else listener=handle}).catch(()=>{});return()=>{disposed=true;if(listener)void listener.remove()}},[activeBook])
  return <MotionConfig reducedMotion="user"><AnimatePresence mode="wait" initial={false}>{activeBook?<motion.div className="app-route reader-route" key={`reader-${activeBook.id}`} initial={{opacity:0,scale:.992,x:16}} animate={{opacity:1,scale:1,x:0}} exit={{opacity:0,scale:.995,x:12}} transition={{type:'spring',stiffness:340,damping:34,mass:.86}}><Reader bookRecord={activeBook} onBack={()=>setActiveBook(null)}/></motion.div>:<motion.div className="app-route library-route" key="library" initial={{opacity:0,scale:.995,x:-10}} animate={{opacity:1,scale:1,x:0}} exit={{opacity:0,scale:.995,x:-10}} transition={{type:'spring',stiffness:330,damping:34,mass:.88}}><Library onOpen={setActiveBook}/></motion.div>}</AnimatePresence></MotionConfig>
}
