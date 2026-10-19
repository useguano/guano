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
      meta: { title: 'Join — Superbird' },
    },
    {
      path: '/authorize',
      name: 'authorize',
      component: () => import('@/views/AuthorizeView.vue'),
      meta: { title: 'Authorize a client — Superbird' },
    },
    {
      path: '/login',
      name: 'login',
      component: () => import('@/views/LoginView.vue'),
      meta: { title: 'Log in — Superbird' },
    },
    {
      path: '/setup',
      name: 'setup',
      component: () => import('@/views/SetupView.vue'),
      meta: { title: 'Set up — Superbird' },
    },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})

router.beforeEach(async (to) => {
  const auth = useAuth()
  await auth.check()
  let authed = !!auth.email.value
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
  document.title = (to.meta.title as string | undefined) ?? 'Superbird'
})

export default router
