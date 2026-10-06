<script setup lang="ts">
import { ref } from 'vue'
import { CircleAlert } from 'lucide-vue-next'
import InputUI from '@/components/ui/InputUI.vue'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import MainLogo from '@/assets/MainLogo.vue'
import { useAuth } from '@/composables/useAuth'

const { login } = useAuth()

const email = ref('')
const password = ref('')
const error = ref<string | null>(null)
const busy = ref(false)

async function submit() {
  if (busy.value) return
  busy.value = true
  error.value = null
  try {
    await login(email.value.trim(), password.value)
    window.location.assign('/admin') // full load boots the editor cleanly
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Login failed'
    busy.value = false
  }
}
</script>

<template>
  <div class="flex min-h-screen flex-col items-center justify-center gap-16 bg-background">
    <MainLogo class="size-12" />
    <form
      class="flex w-90 flex-col gap-2"
      @submit.prevent="submit"
    >
      <InputUI v-model="email" placeholder="Email" size="lg" type="email" />
      <InputUI v-model="password" placeholder="Password" size="lg" type="password" />

      <ButtonUI class="mt-4" variant="default" :disabled="busy" @click="submit">
        {{ busy ? 'Signing in…' : 'Sign in' }}
      </ButtonUI>
      <div
        v-if="error"
        class="flex items-center justify-center gap-1.5 rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger"
      >
        <CircleAlert class="size-3.5 shrink-0" />
        {{ error }}
      </div>
      <button type="submit" class="hidden"></button>
    </form>
  </div>
</template>
