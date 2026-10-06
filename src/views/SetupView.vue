<script setup lang="ts">
import { ref } from 'vue'
import { CircleAlert } from 'lucide-vue-next'
import InputUI from '@/components/ui/InputUI.vue'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import MainLogo from '@/assets/MainLogo.vue'
import { useAuth } from '@/composables/useAuth'

const { setup } = useAuth()

const projectName = ref('')
const email = ref('')
const password = ref('')
const confirm = ref('')
const error = ref<string | null>(null)
const busy = ref(false)

async function submit() {
  if (busy.value) return
  error.value = null
  if (!projectName.value.trim()) {
    error.value = 'Give your project a name'
    return
  }
  if (password.value !== confirm.value) {
    error.value = 'Passwords do not match'
    return
  }
  busy.value = true
  try {
    // the server seeds the project blob with this name as part of setup
    await setup(email.value.trim(), password.value, projectName.value.trim())
    // fallback only: if the server couldn't seed (editor-logic bundle missing),
    // the browser still creates the project and the editor boot applies the
    // name to it (a hard reload follows, so it can't be handed over in memory)
    localStorage.setItem('guano-setup-name', projectName.value.trim())
    window.location.assign('/admin')
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Setup failed'
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
      <div class="mb-4 flex flex-col items-center gap-1.5 text-center">
        <h1 class="text-xl font-semibold text-foreground">Setup your project</h1>
        <p class="text-sm text-muted-foreground">
          Name your project and create the admin login. Everything else is set up inside.
        </p>
      </div>
      <InputUI size="lg" v-model="projectName" placeholder="Project name" />
      <InputUI size="lg" v-model="email" placeholder="Email" type="email" />
      <InputUI size="lg" v-model="password" placeholder="Password (min. 8 characters)" type="password" />
      <InputUI size="lg" v-model="confirm" placeholder="Confirm password" type="password" />

      <ButtonUI class="mt-4" variant="default" :disabled="busy" @click="submit">
        {{ busy ? 'Setting up…' : 'Setup project' }}
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
