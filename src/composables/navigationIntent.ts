let leaving = false

export function beginDeliberateNavigation() {
  leaving = true
}

export function isDeliberateNavigation() {
  return leaving
}
