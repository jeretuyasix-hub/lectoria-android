import { useState } from 'react'
import Library from './components/Library'
import Reader from './components/Reader'
import type { BookRecord } from './types'

export default function App() {
  const [activeBook, setActiveBook] = useState<BookRecord | null>(null)
  return activeBook
    ? <Reader bookRecord={activeBook} onBack={() => setActiveBook(null)} />
    : <Library onOpen={setActiveBook} />
}
