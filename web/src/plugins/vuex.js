import Vue from "vue";
import Vuex from "vuex";
import settings from "./config";

Vue.use(Vuex);

export default new Vuex.Store({
  state: {
    connected: false,
    api:
      (window.localStorage && window.localStorage.getItem("api_prefix")) ||
      location.host + "/reader3",
    shelfBooks: [],
    readingBook: {},
    config: { ...settings.config },
    miniInterface: false,
    windowSize: {
      width: window.innerWidth,
      height: window.innerHeight
    },
    touchable: "ontouchstart" in document,
    showLogin: false,
    loginAuth: true,
    token:
      (window.localStorage && window.localStorage.getItem("api_token")) || "",
    bookSourceList: [],
    isSecureMode: false,
    secureKey: "",
    userNS: "",
    showManagerMode: false
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
    },
    setBookSourceList(state, list) {
      state.bookSourceList = list;
    },
    setUserNS(state, userNS) {
      state.userNS = userNS;
    },
    setSecureKey(state, secureKey) {
      state.secureKey = secureKey;
    },
    setIsSecureMode(state, isSecureMode) {
      state.isSecureMode = isSecureMode;
    },
    setShowManagerMode(state, showManagerMode) {
      state.showManagerMode = showManagerMode;
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
      return settings.fonts[state.config.font];
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
        return settings.themes[state.config.theme];
      }
    }
  }
});
