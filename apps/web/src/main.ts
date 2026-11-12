import { createApp } from 'vue';
import App from './App.vue';
import { router } from './router';
import { initTheme } from './composables/useTheme';
import './styles/main.css';

// 挂载前应用主题（system/light/dark），避免首帧闪烁
initTheme();

createApp(App).use(router).mount('#app');
