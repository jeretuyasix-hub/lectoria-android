import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'

type Icon='sliders'|'close'|'back'|'contents'|'history'|'notebook'|'study'|'audio'|'appearance'|'tutor'
const P:Record<Icon,string>={sliders:'M4 7h10m4 0h2M4 17h2m4 0h10M16 5v4M8 15v4',close:'M6 6l12 12M18 6 6 18',back:'M19 12H5m6-6-6 6 6 6',contents:'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',history:'M4 12a8 8 0 1 0 2.4-5.7L4 8.7M4 4v4.7h4.7M12 8v4l2.8 1.7',notebook:'M4 5.5A2.5 2.5 0 0 1 6.5 3H11v17H6.5A2.5 2.5 0 0 0 4 22V5.5ZM20 5.5A2.5 2.5 0 0 0 17.5 3H13v17h4.5A2.5 2.5 0 0 1 20 22V5.5Z',study:'M3 9l9-5 9 5-9 5-9-5Zm4 3.2V16c2.8 2.4 7.2 2.4 10 0v-3.8M21 9v6',audio:'M5 10v4h3l4 3V7l-4 3H5Zm11-.5a4 4 0 0 1 0 5M18.5 7a7 7 0 0 1 0 10',appearance:'M5 19 10.5 5h3L19 19M7 14h10',tutor:'m12 3 1.2 3.3 3.3 1.2-3.3 1.2L12 12l-1.2-3.3-3.3-1.2 3.3-1.2L12 3Zm6.5 10 .8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2ZM6 14l.9 2.5 2.5.9-2.5.9L6 20.8l-.9-2.5-2.5-.9 2.5-.9L6 14Z'}
function I({n}:{n:Icon}){return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={P[n]}/></svg>}
export type ControlItem={label:string;icon:Icon;action:()=>void}
type FloatPos={side:'left'|'right';top:number}

function initialFloatPos():FloatPos{
  try{const saved=JSON.parse(localStorage.getItem('lectoria-control-position')||'null');if(saved&&(saved.side==='left'||saved.side==='right')&&Number.isFinite(saved.top))return{side:saved.side,top:saved.top}}catch{}
  return{side:'right',top:72}
}

export function ReaderControls({open,onToggle,items}:{open:boolean;onToggle:()=>void;items:ControlItem[]}){
  const [pos,setPos]=useState<FloatPos>(initialFloatPos),[delta,setDelta]=useState({x:0,y:0}),[dragging,setDragging]=useState(false)
  const drag=useRef<{id:number;x:number;y:number;top:number;side:'left'|'right';moved:boolean}|null>(null)
  useEffect(()=>{const clamp=()=>setPos(p=>({...p,top:Math.max(54,Math.min(window.innerHeight-62,p.top))}));window.addEventListener('resize',clamp);return()=>window.removeEventListener('resize',clamp)},[])
  function down(ev:ReactPointerEvent<HTMLButtonElement>){if(open)return;ev.currentTarget.setPointerCapture(ev.pointerId);drag.current={id:ev.pointerId,x:ev.clientX,y:ev.clientY,top:pos.top,side:pos.side,moved:false};setDragging(true)}
  function move(ev:ReactPointerEvent<HTMLButtonElement>){const d=drag.current;if(!d||d.id!==ev.pointerId)return;const dx=ev.clientX-d.x,dy=ev.clientY-d.y;if(Math.hypot(dx,dy)>5)d.moved=true;setDelta({x:dx,y:dy})}
  function end(ev:ReactPointerEvent<HTMLButtonElement>){const d=drag.current;if(!d||d.id!==ev.pointerId)return;const dx=ev.clientX-d.x,dy=ev.clientY-d.y;const startX=d.side==='right'?window.innerWidth-33:33;const centerX=startX+dx;const next:FloatPos={side:centerX<window.innerWidth/2?'left':'right',top:Math.max(54,Math.min(window.innerHeight-62,d.top+dy))};const moved=d.moved;drag.current=null;setDragging(false);setDelta({x:0,y:0});setPos(next);localStorage.setItem('lectoria-control-position',JSON.stringify(next));if(!moved)onToggle()}
  function clickTrigger(ev:React.MouseEvent<HTMLButtonElement>){ev.preventDefault();ev.stopPropagation();if(open)onToggle()}
  const vertical=pos.top>window.innerHeight*.62?'up':'down'
  return <motion.div className={`reader-control-float side-${pos.side} dock-${vertical} ${dragging?'dragging':''}`} style={{top:pos.top,left:pos.side==='left'?10:'auto',right:pos.side==='right'?10:'auto',x:delta.x,y:delta.y}} animate={{opacity:1}}>
    <motion.button className={`reader-control-trigger ${open?'open':''}`} aria-label={open?'Cerrar controles':'Abrir controles de lectura'} aria-expanded={open} onPointerDown={down} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onClick={clickTrigger} whileTap={{scale:.92}} animate={{rotate:open?90:0,scale:open?1.04:1}} transition={{type:'spring',stiffness:520,damping:30,mass:.55}}><I n={open?'close':'sliders'}/></motion.button>
    <AnimatePresence>{open&&<motion.nav className="reader-control-dock" aria-label="Controles de lectura" initial={{opacity:0,scale:.9,y:vertical==='up'?10:-10,filter:'blur(7px)'}} animate={{opacity:1,scale:1,y:0,filter:'blur(0px)'}} exit={{opacity:0,scale:.93,y:vertical==='up'?7:-7,filter:'blur(5px)'}} transition={{type:'spring',stiffness:430,damping:34,mass:.72}}>{items.map((x,i)=><motion.button key={x.label} aria-label={x.label} title={x.label} onClick={x.action} initial={{opacity:0,scale:.62}} animate={{opacity:1,scale:1}} transition={{type:'spring',stiffness:540,damping:28,delay:i*.025}} whileTap={{scale:.84}}><I n={x.icon}/></motion.button>)}</motion.nav>}</AnimatePresence>
  </motion.div>
}
export function ReaderProgress({progress,chapter,location}:{progress:number;chapter:string;location:string}){return <motion.aside className="reader-progress-hud" initial={{opacity:0,y:18}} animate={{opacity:1,y:0}} transition={{delay:.12,duration:.28}}><div className="reader-progress-meta"><span>{chapter||'Lectura'}</span><strong>{location||`${Math.round(progress*100)}%`}</strong><b>{Math.round(progress*100)}%</b></div><div className="reader-progress-line"><motion.i animate={{scaleX:Math.max(.002,progress)}} transition={{type:'spring',stiffness:180,damping:28}}/></div></motion.aside>}
