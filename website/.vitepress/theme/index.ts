import type { Theme } from "vitepress";
import { inBrowser } from "vitepress";
import DefaultTheme from "vitepress/theme";
import HomeLanding from "./components/HomeLanding.vue";
import { keepScrollOnLocaleSwitch } from "./locale-scroll";
import "./custom.css";

export default {
  extends: DefaultTheme,
  enhanceApp({ app, router, siteData }) {
    app.component("HomeLanding", HomeLanding);
    if (inBrowser) keepScrollOnLocaleSwitch(router, siteData.value.base);
  },
} satisfies Theme;
