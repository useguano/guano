// SPDX-License-Identifier: MIT — see LICENSE-EXCEPTIONS.md (embedded in exported sites; deliberately not AGPL)
// The published site's slider runtime, emitted as /assets/slider.js for routes
// that carry a :slider. A thin boot: every carousel behaviour lives in
// src/lib/shared/slider.js, which the editor's Preview surface calls too — so
// the live site and the preview cannot drift.
//
// The markup is already in the page (server/export.mjs emits the same DOM the
// Vue renderers do), so this only attaches behaviour.

import { initSlider } from '@/lib/shared/slider.js'

// ?noanim (deterministic screenshots/crawlers) and the OS reduce-motion
// preference both mean "no smooth scrolling, and never auto-advance" — an
// autoplaying carousel is exactly what WCAG 2.2.2 is about
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
      // a malformed attribute means defaults, never a dead carousel
    }
    initSlider(host as HTMLElement, data, { still })
  })
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot)
} else {
  boot()
}
