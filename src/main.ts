import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "@/App.vue";
import "@/style.css";
import "./styles/markdown-theme.css";
import "./styles/node-themes.css";

createApp(App).use(createPinia()).mount("#app");
