import { initSlider } from '@/lib/shared/slider.js'

const still =
  /[?&]noanim\b/.test(location.search) ||
  (typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches)

function boot() {
  const hosts = document.querySelectorAll('[data-slider]')
  hosts.forEach((host) => {
    let data = {}
    try {
      data = JSON.parse(host.getAttribute('data-slider') || '{}')
    } catch {
    }
    initSlider(host as HTMLElement, data, { still })
  })
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot)
} else {
  boot()
}
