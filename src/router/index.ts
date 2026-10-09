import { createRouter, createWebHistory } from 'vue-router'
import { useAuth } from '@/composables/useAuth'

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
  const authed = !!auth.email.value
  if (to.name === 'build' && !authed) {
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
