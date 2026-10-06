import type { ElementNode, Page, Project } from '@/types/editor'
import { isComponentType } from './components'
import { BUILTIN_LIST_SOURCES } from './nodeState'
// the SAME scope/binding resolution the three renderers run, so a field this
// reports as unknown is a field none of them could have resolved
import { pagesListScope, resolveBinding, resolveListScope } from './shared/fields.js'
import { CHANNEL_NAME_RE, isChannelName } from './shared/interactionKeys.js'

/**
 * What is wrong with a page's structure — the only place a human sees that a
 * document is broken, now that the code column is gone.
 *
 * This replaces the half of `validateDocument` that still means something. The
 * other half was grammar (indentation, unclosed blocks, leaf-vs-container form,
 * invalid tokens) and cannot be expressed in a tree at all: a node is a node,
 * its children are its children. What remains are the rules about MEANING, and
 * they still arrive broken — from agents, from a 3-way merge, and from projects
 * written before a rule existed.
 *
 * Diagnostics address a NODE, not a line, so the issues footer selects the
 * element it is talking about.
 */

export interface TreeDiagnostic {
  nodeId: string
  message: string
}

/**
 * A collection as the field checks read one — name plus fields. Deliberately
 * NOT `Collection`: the scope a `multi-image` field or `@pages` presents is
 * SYNTHETIC (shared/fields.js), with no template page and no id of its own,
 * and it is exactly the scope `data-field` resolves against inside such a list.
 */
export interface FieldSource {
  name: string
  fields: { name: string; type: string; refCollectionId?: string }[]
}

export interface ValidateContext {
  componentNames: string[]
  collectionNames: string[]
  /** multi-reference / multi-image field names — also valid list sources */
  listFieldNames: string[]
  /** collections with `detailRoutes: false`: they render inside other pages and
   *  own no route, so an `@item` link inside one points nowhere */
  dataOnlyCollections: string[]
  /** every collection, fields included — what a `data-field` or a `fieldAttrs`
   *  entry is checked against. Omitted = that check is skipped. */
  collections?: FieldSource[]
  /** the site's own pages, for the `@pages` built-in list source */
  pages?: Page[]
}

/**
 * The context, from a project. ONE builder: the editor's issues footer and the
 * HTML writer's diagnostics have to agree about what is broken, and they were
 * two copies of the same four lines — so a check added to one reported nothing
 * in the other.
 */
export function validateContext(
  project: Pick<Project, 'components' | 'collections' | 'pages'>,
): ValidateContext {
  const collections = project.collections ?? []
  return {
    componentNames: (project.components ?? []).map((c) => c.name),
    collectionNames: collections.map((c) => c.name),
    listFieldNames: collections.flatMap((c) =>
      c.fields
        .filter((f) => f.type === 'multi-reference' || f.type === 'multi-image')
        .map((f) => f.name),
    ),
    dataOnlyCollections: collections.filter((c) => c.detailRoutes === false).map((c) => c.name),
    collections,
    pages: project.pages ?? [],
  }
}

/** an open entry scope: what a `:collection-list` / `:collection-item` / bound
 *  `:slider` (or a collection template's `:body[name]`) is iterating */
interface Scope {
  type: string
  arg?: string
  /** the collection this scope PRESENTS — the one a `data-field` inside it
   *  reads from. Not always the collection the arg names: a `multi-image`
   *  field presents a synthetic one-image collection, which is why
   *  `data-bind-alt="name"` inside such a list resolved to nothing. */
  collection?: FieldSource | null
}

/** the types whose `arg` names a SOURCE (and opens an entry scope) rather
 *  than a field of the scope around them */
const SCOPE_TYPES = new Set(['collection-list', 'collection-item', 'slider', 'body'])

export function validateTree(root: ElementNode, ctx: ValidateContext): TreeDiagnostic[] {
  const diags: TreeDiagnostic[] = []
  /** every ref seen so far → the node that claimed it */
  const refAt = new Map<string, ElementNode>()
  /** every channel declared so far → the node that declared it */
  const channelAt = new Map<string, ElementNode>()
  const collections = ctx.collections

  /** the collection an arg presents, resolved the way the renderers resolve it */
  const scopeCollectionFor = (
    outer: FieldSource | null | undefined,
    arg: string | undefined,
  ): FieldSource | null => {
    if (!collections || !arg) return null
    // a synthetic scope (`@pages`, a multi-image field) is a collection only
    // in the shape that matters here: a name and a field list
    if (arg === '@pages') return pagesListScope(ctx.pages ?? []).collection as FieldSource
    return (resolveListScope(collections, outer ?? null, null, arg, ctx.pages ?? [])?.collection ??
      null) as FieldSource | null
  }

  const visit = (
    node: ElementNode,
    parent: ElementNode | null,
    /** the entry scopes around this node, outermost first */
    scopes: Scope[],
    /** the KNOWN component instances it is inside, outermost first */
    instances: string[],
    /** the `form` ancestors, so a nested form can be named */
    forms: ElementNode[],
  ) => {
    if (node.ref) {
      // refs are page-scope addresses, so a second use makes both ambiguous —
      // an agent addressing by one can't be told which element it meant
      if (refAt.has(node.ref)) {
        diags.push({
          nodeId: node.id,
          message: `'#${node.ref}' is already used by another element — refs must be unique on a page`,
        })
      } else {
        refAt.set(node.ref, node)
      }
      // inside an instance the structure is the master's, copied into every
      // instance on every page — a ref there would be duplicated across all of
      // them. The instance's own wrapper is fine: that is a real page node.
      const host = instances[instances.length - 1]
      if (host) {
        diags.push({
          nodeId: node.id,
          message:
            `'#${node.ref}' is inside the '${host}' component — refs are page-scope, and a ` +
            `component's structure is copied into every instance. Put the ref on the ` +
            `'${host}' element instead.`,
        })
      }
    }

    if (node.channel !== undefined && node.channel !== '') {
      // a channel is an address, so a bad name is an address nothing can
      // reach — and the charset is what keeps it readable in `@name` form
      if (!isChannelName(node.channel)) {
        diags.push({
          nodeId: node.id,
          message:
            `'${node.channel}' is not a channel name — lowercase letters, digits and hyphens, ` +
            `starting with a letter, at most 40 characters (${CHANNEL_NAME_RE.source})`,
        })
      } else if (channelAt.has(node.channel)) {
        // both listeners open, so the overlay appears twice
        diags.push({
          nodeId: node.id,
          message:
            `channel '${node.channel}' is already declared by another element here — a channel ` +
            'is site-wide, so two listeners both open and the page shows it twice',
        })
      } else {
        channelAt.set(node.channel, node)
      }
      // a REPEAT is the one place it can never work: the listener would be
      // rendered once per row, and every row would open together
      const repeat = [...scopes]
        .reverse()
        .find((s) => s.type === 'collection-list' || (s.type === 'slider' && !!s.arg))
      if (repeat) {
        diags.push({
          nodeId: node.id,
          message:
            `a channel listener inside '${repeat.type}${repeat.arg ? `[${repeat.arg}]` : ''}' ` +
            'would open once per row — move it outside the list and open the one copy from ' +
            'every row',
        })
      }
      if (isComponentType(node.type)) {
        // an instance wrapper renders no element of its own, so the classes a
        // channel effect applies would land nowhere
        diags.push({
          nodeId: node.id,
          message:
            `<${node.type}> emits no element of its own, so it cannot listen on a channel — ` +
            `declare the channel on an element inside ${node.type} instead`,
        })
      }
    }

    if (node.type === 'list-empty') {
      // it renders only when a list has nothing to repeat, so it is meaningful
      // ONLY as a direct child of a list or a bound slider. Anywhere else it
      // renders never — a silent no-op worth saying out loud.
      const inList =
        !!parent &&
        (parent.type === 'collection-list' || (parent.type === 'slider' && !!parent.arg))
      if (!inList) {
        diags.push({
          nodeId: node.id,
          message:
            "'list-empty' is a list's empty state — it only renders as a DIRECT child of a " +
            "'collection-list' or a bound 'slider'. Elsewhere it never renders at all.",
        })
      }
    }

    if (node.type === 'form-success' || node.type === 'form-error') {
      // like `list-empty`: it renders only in one position, so anywhere else is
      // a silent no-op worth saying out loud.
      if (parent?.type !== 'form') {
        diags.push({
          nodeId: node.id,
          message:
            `'${node.type}' is a form's ${node.type === 'form-success' ? 'success' : 'error'} ` +
            "state — it only renders as a DIRECT child of a 'form'. Elsewhere it never " +
            'renders at all.',
        })
      } else {
        const twins = (parent.children ?? []).filter((c) => c.type === node.type)
        if (twins.length > 1 && twins[0] !== node) {
          diags.push({
            nodeId: node.id,
            message: `this form already has a '${node.type}' — only the first one renders.`,
          })
        }
      }
    }

    if (node.type === 'form' && forms.length) {
      // the browser does not nest forms: it closes the outer one, so the inner
      // controls silently submit to the wrong place (or nowhere)
      diags.push({
        nodeId: node.id,
        message:
          'a form cannot contain another form — browsers close the outer one, so the inner ' +
          'fields are not submitted.',
      })
    }

    if (node.link === '@item') {
      // '@item' links to the entry's own page — which a data-only collection
      // does not have. Caught here rather than silently rendering unlinked.
      const scope = [...scopes].reverse().find((s) => s.arg && ctx.collectionNames.includes(s.arg))
      if (scope && ctx.dataOnlyCollections.includes(scope.arg!)) {
        diags.push({
          nodeId: node.id,
          message:
            `'@item' links to an entry's own page, but the collection '${scope.arg}' has no ` +
            'detail routes (detailRoutes: false). Remove the link, or give the collection a ' +
            'template page.',
        })
      }
    }

    // --- a FIELD binding that names no field of the scope it is in ---
    //
    // `data-field` and every `fieldAttrs` entry resolve through
    // `resolveBinding` against the innermost entry scope. A name that is not
    // there renders EMPTY — on the canvas, in Play and on the published page —
    // and nothing said so: an agent binding `data-field="title"` to a
    // collection whose field is called `name` got a blank element and a
    // response that reported success.
    //
    // Only reported when the scope is actually RESOLVED, so a component master
    // (no scope of its own) and an unknown collection (already reported above)
    // are never second-guessed.
    const scope = scopes[scopes.length - 1]
    const scopeCollection = scope?.collection ?? null
    if (collections && scopeCollection) {
      const where =
        scope!.type === 'body'
          ? `the '${scopeCollection.name}' template`
          : `'${scope!.type}${scope!.arg ? `[${scope!.arg}]` : ''}'`
      const known = (name: string) =>
        !!resolveBinding(collections, scopeCollection, null, name)
      const names = (scopeCollection.fields ?? []).map((f) => f.name)
      const hint = names.length ? ` (fields here: ${names.join(', ')})` : ''
      if (node.arg && !SCOPE_TYPES.has(node.type) && !known(node.arg)) {
        diags.push({
          nodeId: node.id,
          message: `'${node.arg}' is not a field of ${where}, so this element renders empty${hint}`,
        })
      }
      for (const [attr, field] of Object.entries(node.fieldAttrs ?? {})) {
        if (field && !known(field)) {
          diags.push({
            nodeId: node.id,
            message:
              `the '${attr}' attribute is bound to '${field}', which is not a field of ` +
              `${where} — it renders as the static value, or empty${hint}`,
          })
        }
      }
    }

    let childScopes = scopes
    let childInstances = instances

    if (node.slot) {
      if (node.type === 'body' || isComponentType(node.type) || !node.children) {
        diags.push({ nodeId: node.id, message: `'${node.type}' can't be a slot — a slot is a container inside the component` })
      } else if (parent === null) {
        diags.push({ nodeId: node.id, message: "The component's own element can't be a slot" })
      }
      // what is under a slot belongs to the holder: a page's own structure
      // again, where a ref is fine and an instance is an instance
      childInstances = []
    }

    if (isComponentType(node.type)) {
      if (!ctx.componentNames.includes(node.type)) {
        diags.push({ nodeId: node.id, message: `Unknown component '${node.type}'` })
      } else {
        if (instances.includes(node.type)) {
          diags.push({ nodeId: node.id, message: `'${node.type}' can't contain itself` })
        }
        childInstances = [...instances, node.type]
      }
    } else if (node.type === 'collection-list' || node.type === 'collection-item') {
      const arg = node.arg
      const known =
        !!arg &&
        (ctx.collectionNames.includes(arg) ||
          // built-in list sources ('@pages' — the site's own pages)
          (node.type === 'collection-list' && BUILTIN_LIST_SOURCES.includes(arg)) ||
          (node.type === 'collection-list' && ctx.listFieldNames.includes(arg)))
      if (!known) {
        diags.push({
          nodeId: node.id,
          message: `Unknown collection '${node.type}${arg ? `[${arg}]` : ''}'`,
        })
      }
      childScopes = [...scopes, { type: node.type, arg, collection: scopeCollectionFor(scopeCollection, arg) }]
    } else if (node.type === 'slider') {
      // a slider's arg is OPTIONAL: with one it repeats per entry like a
      // :collection-list, without one each direct child is a slide
      const arg = node.arg
      if (
        arg &&
        !ctx.collectionNames.includes(arg) &&
        !BUILTIN_LIST_SOURCES.includes(arg) &&
        !ctx.listFieldNames.includes(arg)
      ) {
        diags.push({ nodeId: node.id, message: `Unknown collection 'slider[${arg}]'` })
      }
      if (arg) {
        childScopes = [
          ...scopes,
          { type: node.type, arg, collection: scopeCollectionFor(scopeCollection, arg) },
        ]
      }
    } else if (node.type === 'body' && node.arg) {
      // a collection template page: its whole body renders per entry
      childScopes = [
        ...scopes,
        {
          type: node.type,
          arg: node.arg,
          collection: scopeCollectionFor(null, node.arg),
        },
      ]
    }

    const childForms = node.type === 'form' ? [...forms, node] : forms
    for (const child of node.children) {
      visit(child, node, childScopes, childInstances, childForms)
    }
  }

  visit(root, null, [], [], [])
  return diags
}
