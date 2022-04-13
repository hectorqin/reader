import Vue from "vue";
import App from "./App.vue";
import router from "./router";
import "./plugins/element.js";
import store from "./plugins/vuex.js";
import "./plugins/md5.js";
import { registerServiceWorker } from "./registerServiceWorker";
import noCover from "./assets/imgs/noCover.jpeg";
import noImage from "./assets/imgs/noImage.png";
import VueLazyload from "vue-lazyload";

import localforage from "localforage";
window.$cacheStorage = localforage.createInstance({
  name: "cacheStorage"
});

registerServiceWorker();

Vue.config.productionTip = false;

Vue.use(VueLazyload, {
  observer: true
});

Vue.mixin({
  computed: {
    api() {
      return this.$store.getters.api;
    },
    isWebApp() {
      return window.navigator.standalone;
    },
    isPWA() {
      return ["fullscreen", "standalone", "minimal-ui"].some(
        displayMode =>
          window.matchMedia("(display-mode: " + displayMode + ")").matches
      );
    }
  },
  methods: {
    getImagePath(url, useSW) {
      if (
        url &&
        (url.startsWith("http://") ||
          url.startsWith("https://") ||
          url.startsWith("//"))
      ) {
        if (useSW && window.serviceWorkerReady) {
          return url;
        }
        return this.api + "/cover?path=" + url;
      }
      if (!url) return false;
      // 默认是接口服务器上的资源
      return this.$store.getters.apiRoot + url;
    },
    getCover(coverUrl, normal, useSW) {
      coverUrl = this.getImagePath(coverUrl, useSW);
      if (coverUrl) {
        return normal
          ? coverUrl
          : {
              src: coverUrl,
              error: noCover
            };
      }
      return noCover;
    },
    getImage(imageUrl, normal, useSW) {
      imageUrl = this.getImagePath(imageUrl, useSW);
      if (imageUrl) {
        return normal
          ? imageUrl
          : {
              src: imageUrl,
              error: noCover
            };
      }
      return noImage;
    }
  }
});

new Vue({
  router,
  store,
  render: h => h(App)
}).$mount("#app");
