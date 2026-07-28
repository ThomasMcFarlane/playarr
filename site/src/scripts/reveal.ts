/**
 * Fades/slides [data-reveal] elements in as they cross the viewport.
 *
 * Deliberately JS-additive rather than CSS-default: elements are visible
 * until this script explicitly hides them (.reveal-pending), and only once
 * it has also set up the observer that will unhide them. If this script
 * fails to run at all, disabled JS, a thrown error, a slow/blocked load , 
 * content simply never gets hidden, instead of getting hidden forever with
 * nothing left to reveal it. See global.css for the corresponding CSS.
 */
const targets = document.querySelectorAll<HTMLElement>('[data-reveal]')

if (targets.length > 0 && 'IntersectionObserver' in window) {
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        entry.target.classList.remove('reveal-pending')
        observer.unobserve(entry.target)
      }
    },
    { rootMargin: '0px 0px -10% 0px', threshold: 0.15 },
  )

  for (const el of targets) {
    const delay = el.dataset.revealDelay
    if (delay) el.style.transitionDelay = `${delay}ms`
    el.classList.add('reveal-pending')
    observer.observe(el)
  }
}
