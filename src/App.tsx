import { useEffect, useState } from 'react'
import { App as NativeApp } from '@capacitor/app'
import Library from './components/Library'
import Reader from './components/ReaderV9'
import type { BookRecord } from './types'

export default function App() {
  const [activeBook, setActiveBook] = useState<BookRecord | null>(null)

  useEffect(() => {
    let disposed = false
    let listener: { remove: () => Promise<void> } | null = null

    void NativeApp.addListener('backButton', () => {
      if (activeBook) {
        setActiveBook(null)
        return
      }
      void NativeApp.exitApp()
    }).then(handle => {
      if (disposed) void handle.remove()
      else listener = handle
    }).catch(() => {})

    return () => {
      disposed = true
      if (listener) void listener.remove()
    }
  }, [activeBook])

  return activeBook
    ? <Reader bookRecord={activeBook} onBack={() => setActiveBook(null)} />
    : <Library onOpen={setActiveBook} />
}
