import type { ElementNode, Page, Project } from '@/types/editor'
import { isComponentType } from './components'
import { BUILTIN_LIST_SOURCES } from './nodeState'
import { pagesListScope, resolveBinding, resolveListScope } from './shared/fields.js'
import { CHANNEL_NAME_RE, isChannelName } from './shared/interactionKeys.js'

export interface TreeDiagnostic {
  nodeId: string
  message: string
}

export interface FieldSource {
  name: string
  fields: { name: string; type: string; refCollectionId?: string }[]
}

export interface ValidateContext {
  componentNames: string[]
  collectionNames: string[]
  listFieldNames: string[]

  dataOnlyCollections: string[]

  collections?: FieldSource[]
  pages?: Page[]
}

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

interface Scope {
  type: string
  arg?: string

  collection?: FieldSource | null
}

const SCOPE_TYPES = new Set(['collection-list', 'collection-item', 'slider', 'body'])

export function validateTree(root: ElementNode, ctx: ValidateContext): TreeDiagnostic[] {
  const diags: TreeDiagnostic[] = []
  const refAt = new Map<string, ElementNode>()
  const channelAt = new Map<string, ElementNode>()
  const collections = ctx.collections

  const scopeCollectionFor = (
    outer: FieldSource | null | undefined,
    arg: string | undefined,
  ): FieldSource | null => {
    if (!collections || !arg) return null
    if (arg === '@pages') return pagesListScope(ctx.pages ?? []).collection as FieldSource
    return (resolveListScope(collections, outer ?? null, null, arg, ctx.pages ?? [])?.collection ??
      null) as FieldSource | null
  }

  const visit = (
    node: ElementNode,
    parent: ElementNode | null,
    scopes: Scope[],
    instances: string[],
    forms: ElementNode[],
  ) => {
    if (node.ref) {
      if (refAt.has(node.ref)) {
        diags.push({
          nodeId: node.id,
          message: `'#${node.ref}' is already used by another element — refs must be unique on a page`,
        })
      } else {
        refAt.set(node.ref, node)
      }
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
      if (!isChannelName(node.channel)) {
        diags.push({
          nodeId: node.id,
          message:
            `'${node.channel}' is not a channel name — lowercase letters, digits and hyphens, ` +
            `starting with a letter, at most 40 characters (${CHANNEL_NAME_RE.source})`,
        })
      } else if (channelAt.has(node.channel)) {
        diags.push({
          nodeId: node.id,
          message:
            `channel '${node.channel}' is already declared by another element here — a channel ` +
            'is site-wide, so two listeners both open and the page shows it twice',
        })
      } else {
        channelAt.set(node.channel, node)
      }
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
        diags.push({
          nodeId: node.id,
          message:
            `<${node.type}> emits no element of its own, so it cannot listen on a channel — ` +
            `declare the channel on an element inside ${node.type} instead`,
        })
      }
    }

    if (node.type === 'list-empty') {
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
      diags.push({
        nodeId: node.id,
        message:
          'a form cannot contain another form — browsers close the outer one, so the inner ' +
          'fields are not submitted.',
      })
    }

    if (node.link === '@item') {
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
