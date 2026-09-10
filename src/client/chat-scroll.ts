import { useCallback, useLayoutEffect, useRef, useState } from 'react'

// Follow new content only while the reader stays at the end of this conversation.
export function useChatScroll(revision: string, conversationId: string) {
  const ref = useRef<HTMLDivElement | null>(null)
  const following = useRef(true)
  const resumeIntent = useRef(false)
  const [paused, setPaused] = useState(false)
  const jumpToLatest = useCallback(() => {
    following.current = true
    resumeIntent.current = false
    setPaused(false)
    const node = ref.current
    if (node) node.scrollTop = node.scrollHeight
  }, [])
  useLayoutEffect(() => { jumpToLatest() }, [conversationId, jumpToLatest])
  useLayoutEffect(() => {
    const node = ref.current
    if (!node) return
    let frame = 0
    let lastTop = node.scrollTop
    let touchY = 0
    const pause = () => { following.current = false; resumeIntent.current = false; setPaused(true); cancelAnimationFrame(frame) }
    const onScroll = () => {
      const top = node.scrollTop
      if (Math.abs(top - lastTop) < 1) return
      if (top < lastTop) pause()
      else if (resumeIntent.current && node.scrollHeight - node.clientHeight - top <= 4) {
        following.current = true; setPaused(false)
      }
      lastTop = top
    }
    // Stop the pending animation frame before wheel/touch scrolling takes effect.
    const onWheel = (event: WheelEvent) => { if (event.deltaY < 0) pause(); else if (event.deltaY > 0) resumeIntent.current = true }
    const onTouchStart = (event: TouchEvent) => { touchY = event.touches[0]?.clientY ?? 0 }
    const onTouchMove = (event: TouchEvent) => {
      const y = event.touches[0]?.clientY ?? touchY
      if (y > touchY) pause(); else if (y < touchY) resumeIntent.current = true
      touchY = y
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (['ArrowUp', 'PageUp', 'Home'].includes(event.key)) pause()
      else if (['ArrowDown','PageDown','End',' '].includes(event.key)) resumeIntent.current = true
    }
    const onPointerDown = () => { resumeIntent.current = true }
    const scroll = () => {
      if (!following.current) return
      node.scrollTop = node.scrollHeight
      lastTop = node.scrollTop
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        if (!following.current) return
        node.scrollTop = node.scrollHeight
        lastTop = node.scrollTop
      })
    }
    node.addEventListener('pointerdown', onPointerDown, {passive:true})
    node.addEventListener('scroll', onScroll, { passive: true })
    node.addEventListener('wheel', onWheel, { passive: true })
    node.addEventListener('touchstart', onTouchStart, { passive: true })
    node.addEventListener('touchmove', onTouchMove, { passive: true })
    node.addEventListener('keydown', onKeyDown)
    scroll()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(scroll)
    observer?.observe(node)
    const observed = new Set<Element>()
    const observeChildren = () => {
      for (const child of observed) if (child.parentElement !== node) { observer?.unobserve(child); observed.delete(child) }
      for (const child of node.children) if (!observed.has(child)) { observer?.observe(child); observed.add(child) }
    }
    observeChildren()
    const mutations = typeof MutationObserver === 'undefined' ? null : new MutationObserver(() => {
      observeChildren()
      scroll()
    })
    mutations?.observe(node, { childList: true, subtree: true, characterData: true })
    return () => {
      cancelAnimationFrame(frame); observer?.disconnect(); mutations?.disconnect()
      node.removeEventListener('pointerdown', onPointerDown)
      node.removeEventListener('scroll', onScroll); node.removeEventListener('wheel', onWheel)
      node.removeEventListener('touchstart', onTouchStart); node.removeEventListener('touchmove', onTouchMove)
      node.removeEventListener('keydown', onKeyDown)
    }
  }, [revision, conversationId])
  return { ref, paused, jumpToLatest }
}
