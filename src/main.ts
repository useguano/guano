import './assets/main.css'

import { createApp } from 'vue'

import App from './App.vue'
import router from './router'
import { tooltip } from './directives/tooltip'
import { installErrorReporting } from './lib/errorReporting'

const app = createApp(App)

app.use(router)
app.directive('tooltip', tooltip)
installErrorReporting(app)

app.mount('#app')
