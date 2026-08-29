import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'
import './mobile-fixes.css'
import './mobile-v4.css'
import './mobile-v6.css'
import './mobile-v7.css'
import './reader-minimal.css'
import './android-input-fix.css'
import './qa-v14.css'
import './premium-v15.css'

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>)

type ReaderTheme='paper'|'sepia'|'dark'|'oled'
function palette(theme:ReaderTheme){if(theme==='oled')return{bg:'#000000',fg:'#f4f4f1',link:'#80d8bd',selection:'#2d7e66aa',code:'#101713'};if(theme==='dark')return{bg:'#17211d',fg:'#edf1ee',link:'#79cfb5',selection:'#2b725c99',code:'#101713'};if(theme==='sepia')return{bg:'#efe2c8',fg:'#3f3326',link:'#255f50',selection:'#d8b96580',code:'#e1d1b3'};return{bg:'#fbf7ed',fg:'#17342b',link:'#1f6d56',selection:'#82cbb080',code:'#f0eadf'}}
function applyReaderTheme(doc:Document,theme:ReaderTheme){const p=palette(theme);let style=doc.getElementById('lectoria-reader-theme') as HTMLStyleElement|null;if(!style){style=doc.createElement('style');style.id='lectoria-reader-theme';(doc.head||doc.documentElement).appendChild(style)}style.textContent=`html,body{background:${p.bg}!important;color:${p.fg}!important}body,p,div,span,section,article,li,h1,h2,h3,h4,h5,h6,blockquote,td,th{color:${p.fg}!important}a{color:${p.link}!important}code,pre{background:${p.code}!important;color:${p.fg}!important}::selection{background:${p.selection}!important;color:${p.fg}!important}`;doc.documentElement.style.background=p.bg;if(doc.body){doc.body.style.background=p.bg;doc.body.style.color=p.fg}}
function currentTheme():ReaderTheme{const value=document.documentElement.dataset.readerTheme;return value==='oled'||value==='dark'||value==='sepia'?value:'paper'}
function syncThemeToFrames(){const theme=currentTheme();document.querySelectorAll('iframe').forEach(frame=>{try{const doc=(frame as HTMLIFrameElement).contentDocument;if(doc)applyReaderTheme(doc,theme)}catch{}})}
let syncFrame=0
function scheduleThemeSync(){if(syncFrame)return;syncFrame=requestAnimationFrame(()=>{syncFrame=0;syncThemeToFrames()})}
const observer=new MutationObserver(mutations=>{if(mutations.some(m=>m.type==='childList'||(m.type==='attributes'&&m.attributeName==='data-reader-theme')))scheduleThemeSync()})
observer.observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['data-reader-theme']})
document.addEventListener('load',event=>{if((event.target as HTMLElement|null)?.tagName==='IFRAME')scheduleThemeSync()},true)
scheduleThemeSync()
