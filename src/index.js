import { createApp } from 'vue'
import { createRouter, createWebHashHistory, createWebHistory } from 'vue-router'
import './style.css'
import App from './components/App.vue'
import Actors from './components/Actors.vue'
import Apps from './components/Apps.vue'

const Router = createRouter({
  history: ["localhost","127.0.0.1"].includes(window.location.hostname)?
    createWebHashHistory() : createWebHistory(),
  routes: [
    { path: '/', component: Actors },
    { path: '/apps', component: Apps },
  ],
})

createApp(App)
  .use(Router)
  .directive('focus', { mounted: e=> e.focus() })
  .mount('#app')
