import Vue from "vue";
import Vuex from "vuex";
import themeConfig from "./config";

Vue.use(Vuex);

export default new Vuex.Store({
  state: {
    connected: false,
    api:
      (window.localStorage && window.localStorage.getItem("api_prefix")) ||
      location.host + "/reader3",
    shelfBooks: [],
    readingBook: {},
    config: {
      theme: 0,
      font: 0,
      fontSize: 18,
      fontWeight: 400,
      readMethod: "上下滑动",
      clickMethod: "自动",
      readWidth: 800
    },
    miniInterface: false,
    windowSize: {
      width: window.innerWidth,
      height: window.innerHeight
    },
    touchable: "ontouchstart" in document,
    showLogin: false,
    loginAuth: true,
    token:
      (window.localStorage && window.localStorage.getItem("api_token")) || ""
  },
  mutations: {
    setShelfBooks(state, books) {
      state.shelfBooks = books;
    },
    setReadingBook(state, readingBook) {
      state.readingBook = readingBook;
      window.localStorage &&
        window.localStorage.setItem(
          "readingRecent",
          JSON.stringify(readingBook)
        );
    },
    setConfig(state, config) {
      state.config = config;
      window.localStorage &&
        window.localStorage.setItem("config", JSON.stringify(config));
    },
    setMiniInterface(state, mini) {
      state.miniInterface = mini;
    },
    setWindowSize(state, size) {
      state.windowSize = size;
    },
    setTouchable(state, touchable) {
      state.touchable = touchable;
    },
    setApi(state, api) {
      state.api = api;
    },
    setConnected(state, connected) {
      state.connected = connected;
    },
    setShowLogin(state, showLogin) {
      state.showLogin = showLogin;
      if (showLogin) {
        state.loginAuth = false;
      }
    },
    setLoginAuth(state, loginAuth) {
      state.loginAuth = loginAuth;
    },
    setToken(state, token) {
      state.token = token;
      window.localStorage && window.localStorage.setItem("api_token", token);
    }
  },
  getters: {
    api: state => {
      if (
        state.api.startsWith("http://") ||
        state.api.startsWith("https://") ||
        state.api.startsWith("//")
      ) {
        return state.api;
      }
      return "//" + state.api;
    },
    isSlideRead: state => {
      return state.miniInterface && state.config.readMethod === "左右滑动";
    },
    isNight: state => {
      return state.config.theme == 6;
    },
    currentContentBGImg: (state, getters) => {
      if (state.config.contentBGImg) {
        return state.config.contentBGImg.startsWith("bg/") ||
          state.config.contentBGImg.startsWith("http://") ||
          state.config.contentBGImg.startsWith("https://") ||
          state.config.contentBGImg.startsWith("//")
          ? state.config.contentBGImg
          : getters.api.replace(/\/reader3\/?/, "") + state.config.contentBGImg;
      }
      return undefined;
    },
    customCSSUrl: (_, getters) => {
      if (getters.api) {
        return getters.api.replace(/\/reader3\/?/, "") + "/assets/reader.css";
      }
      return false;
    },
    currentFontFamily: state => {
      return themeConfig.fonts[state.config.font];
    },
    currentThemeConfig: (state, getters) => {
      if (state.config.theme === "custom") {
        return {
          body: state.config.bodyColor || "#eadfca",
          content: {
            backgroundImage: getters.currentContentBGImg
              ? `url(${getters.currentContentBGImg})`
              : null,
            backgroundPosition: "center",
            backgroundRepeat: "no-repeat",
            backgroundAttachment: "fixed",
            backgroundColor: state.config.contentColor || "#ede7da",
            backgroundSize: "cover"
          },
          popup: state.config.popupColor || "#ede7da"
        };
      } else {
        return themeConfig.themes[state.config.theme];
      }
    }
  }
});
