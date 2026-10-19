import { createRouter, createWebHistory } from 'vue-router'
import { useAuth } from '@/composables/useAuth'
import { hostBridge } from '@/lib/hostBridge'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'build',
      component: () => import('@/views/BuildView.vue'),
    },
    {
      path: '/invite/:token',
      name: 'invite',
      component: () => import('@/views/SetPasswordView.vue'),
      meta: { title: 'Join — Guano' },
    },
    {
      path: '/authorize',
      name: 'authorize',
      component: () => import('@/views/AuthorizeView.vue'),
      meta: { title: 'Authorize a client — Guano' },
    },
    {
      path: '/login',
      name: 'login',
      component: () => import('@/views/LoginView.vue'),
      meta: { title: 'Log in — Guano' },
    },
    {
      path: '/setup',
      name: 'setup',
      component: () => import('@/views/SetupView.vue'),
      meta: { title: 'Set up — Guano' },
    },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})

router.beforeEach(async (to) => {
  const auth = useAuth()
  await auth.check()
  let authed = !!auth.email.value
  // Ask the app for a BUILDER session when this page does not have one.
  //
  // Two cases, and the second is new: no session at all (expiry, a password
  // changed in a browser), and a session that is not the launcher's. The
  // second happens whenever setup was completed in the webview — the editor
  // still serves `/setup` for any instance the app did not create, and the
  // cookie that route sets is an ordinary BROWSER session, which the server
  // caps at contributor. Without this, a person who set up a project inside
  // the app's own window would be pinned to Play in it.
  const wrongKind = authed && auth.host.value !== 'launcher'
  if ((!authed || wrongKind) && !auth.needsSetup.value && hostBridge.available) {
    await hostBridge.requestReauth().catch(() => {})
    await auth.recheck()
    authed = !!auth.email.value
  }
  if ((to.name === 'build' || to.name === 'authorize') && !authed) {
    return auth.needsSetup.value ? '/setup' : '/login'
  }
  if ((to.name === 'login' || to.name === 'setup') && authed) return '/'
  if (to.name === 'login' && auth.needsSetup.value) return '/setup'
  if (to.name === 'setup' && !auth.needsSetup.value && !authed) return '/login'
  return true
})

router.afterEach((to) => {
  document.title = (to.meta.title as string | undefined) ?? 'Guano'
})

export default router
