import type { InjectionKey } from 'vue'

export const MODAL_LABEL = Symbol('modal-label') as InjectionKey<(id: string) => void>
