import type { InjectionKey } from 'vue'

/**
 * How a dialog learns its own name.
 *
 * A ModalHeader registers the id of its heading with the ModalHost above it,
 * which puts that id in `aria-labelledby`. Done through provide/inject rather
 * than a prop because the two are not always adjacent: some dialogs compose
 * ModalDialog, and others drop a ModalHeader straight into a ModalHost.
 */
export const MODAL_LABEL = Symbol('modal-label') as InjectionKey<(id: string) => void>
