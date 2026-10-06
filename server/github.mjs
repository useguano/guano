// Push an exported static site to a GitHub repo via the Git Data API, using
// only global fetch (no @octokit, keeping the server dependency-free). The
// pushed tree has NO base_tree, so the branch's root is replaced wholesale:
// files removed from the export disappear from the repo. The token is passed
// in per call from server-side config and never appears in any thrown message.
import { readDirFiles } from './util.mjs'

const API = 'https://api.github.com'
const REPO_RE = /^[\w.-]+\/[\w.-]+$/
const BRANCH_RE = /^[\w./-]+$/

function expose(message) {
  const err = new Error(message)
  err.expose = true
  return err
}

/** Push every file under `dir` as the COMPLETE tree of `branch` (replace-root:
 * files deleted from the export disappear from the repo). Returns
 * { commit: '<sha>' }. Throws Error with .expose=true on any failure. */
export async function pushSiteToGitHub(dir, { repo, branch, token }, message = 'Publish site') {
  if (!REPO_RE.test(repo ?? '') || !BRANCH_RE.test(branch ?? '') || !token) {
    throw expose('github publishing is not configured (repo/branch/token)')
  }
  // the regexes above allow dots, so `a/../b` passes them — and these values are
  // interpolated straight into api.github.com paths under a real token. Reject
  // dot segments explicitly rather than trusting URL normalisation. (S13)
  const hasDotSegment = (value) =>
    String(value).split('/').some((seg) => seg === '.' || seg === '..')
  if (hasDotSegment(repo) || hasDotSegment(branch)) {
    throw expose('invalid repo or branch name')
  }

  async function api(path, init) {
    let res
    try {
      res = await fetch(API + path, {
        ...init,
        signal: AbortSignal.timeout(30_000),
        headers: {
          authorization: `Bearer ${token}`,
          accept: 'application/vnd.github+json',
          'x-github-api-version': '2022-11-28',
          'user-agent': 'guano',
          ...init?.headers,
        },
      })
    } catch (err) {
      throw expose(`GitHub unreachable: ${err?.message ?? 'request failed'}`)
    }
    if (!res.ok) {
      const body = await res.json().catch(() => null)
      throw expose(`GitHub ${res.status}: ${body?.message ?? res.statusText}`)
    }
    return res.json()
  }

  const files = await readDirFiles(dir)
  if (!files.length) throw expose('nothing to publish — the export is empty')

  // parent sha: 404 covers both an empty repo and a not-yet-created branch
  let parent = null
  try {
    const ref = await api(`/repos/${repo}/git/ref/heads/${branch}`)
    parent = ref.object.sha
  } catch (err) {
    if (!/^GitHub 404:/.test(err.message)) throw err
  }

  // upload blobs with a bounded worker pool (index-chasing)
  const tree = new Array(files.length)
  let next = 0
  async function worker() {
    for (let i = next++; i < files.length; i = next++) {
      const file = files[i]
      const blob = await api(`/repos/${repo}/git/blobs`, {
        method: 'POST',
        body: JSON.stringify({ content: file.data.toString('base64'), encoding: 'base64' }),
      })
      tree[i] = { path: file.path, mode: '100644', type: 'blob', sha: blob.sha }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, files.length) }, worker))

  const newTree = await api(`/repos/${repo}/git/trees`, {
    method: 'POST',
    body: JSON.stringify({ tree }), // no base_tree → replace root
  })
  const commit = await api(`/repos/${repo}/git/commits`, {
    method: 'POST',
    body: JSON.stringify({ message, tree: newTree.sha, parents: parent ? [parent] : [] }),
  })
  if (parent) {
    await api(`/repos/${repo}/git/refs/heads/${branch}`, {
      method: 'PATCH',
      body: JSON.stringify({ sha: commit.sha, force: false }),
    })
  } else {
    await api(`/repos/${repo}/git/refs`, {
      method: 'POST',
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: commit.sha }),
    })
  }
  return { commit: commit.sha }
}
