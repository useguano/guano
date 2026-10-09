import type { Breakpoint, ElementNode, Page, Project } from '@/types/editor'
import { createNode } from './elements'
import { SCHEMA_VERSION } from './migrate'
import { defaultSettings } from './settings'
import { uid } from './shared/ids.js'

export function defaultBreakpoints(): Breakpoint[] {
  return [
    { id: uid(), name: 'Desktop', width: 1440, height: 900 },
    { id: uid(), name: 'Tablet', width: 768, height: 1024 },
    { id: uid(), name: 'Mobile', width: 390, height: 844 },
  ]
}

export function createBody(arg?: string): ElementNode {
  const body = createNode('body')
  if (arg) body.arg = arg
  return body
}

export function createPage(name: string, path: string, _locale = 'en'): Page {
  const now = Date.now()
  return {
    id: uid(),
    name,
    path,
    status: 'published',
    elements: [createBody()],
    createdAt: now,
    updatedAt: now,
  }
}

export function createProject(name: string): Project {
  return {
    id: uid(),
    name,
    schemaVersion: SCHEMA_VERSION,
    pages: [createPage('Home', '/')],
    components: [],
    collections: [],
    interactions: [],
    animations: [],
    breakpoints: defaultBreakpoints(),
    comments: [],
    locales: ['en'],
    defaultLocale: 'en',
    settings: defaultSettings(),
  }
}
