import { useActiveElement } from '@vueuse/core'

export function isInputActive() {
  const activeElement = useActiveElement()
  const el = activeElement.value
  
  if (!el) return false
  
  const tagName = el.tagName.toUpperCase()
  return (
    tagName === 'INPUT' || 
    tagName === 'TEXTAREA' || 
    (el as HTMLElement).isContentEditable
  )
}