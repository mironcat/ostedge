import { createApp } from 'vue'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import 'element-plus/theme-chalk/dark/css-vars.css'
import * as ElementPlusIconsVue from '@element-plus/icons-vue'

import App from './App.vue'
import * as store from './store.js'
import './styles.css'

document.documentElement.classList.add('dark')

const app = createApp(App)

for (const [name, component] of Object.entries(ElementPlusIconsVue)) {
  app.component(name, component)
}

app.use(ElementPlus)
app.mount('#app')

// Small debug/testing hook for the Electron smoke test and manual inspection.
window.__ostedge = store
