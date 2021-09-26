import Vue from "vue";
import Vuex from "vuex";
import settings from "./config";

const defaultNS = [{ username: "默认", userNS: "default" }];
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
    isManagerMode: false,
    secureKey: "",
    userInfo: {},
    userList: [].concat(defaultNS),
    userNS: "default",
    showManagerMode: false,
    version: process.env.VUE_APP_BUILD_VERSION,
    filterRules: []
  },
  mutations: {
    setShelfBooks(state, books) {
      state.shelfBooks = books;
    },
    setReadingBook(state, readingBook) {
      state.readingBook = readingBook;
      // 更新书架信息
      for (let i = 0; i < state.shelfBooks.length; i++) {
        if (state.shelfBooks[i].bookUrl === readingBook.bookUrl) {
          state.shelfBooks[i] = {
            ...state.shelfBooks[i],
            durChapterTime: new Date().getTime(),
            durChapterIndex: readingBook.index,
            durChapterTitle: (
              (readingBook.catalog || [])[readingBook.index] || {}
            ).title
          };
          break;
        }
      }
      state.shelfBooks = [].concat(state.shelfBooks);
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
    setIsSecureMode(state, isSecureMode) {
      state.isSecureMode = isSecureMode;
    },
    setSecureKey(state, secureKey) {
      state.secureKey = secureKey;
    },
    setIsManagerMode(state, isManagerMode) {
      state.isManagerMode = isManagerMode;
    },
    setShowManagerMode(state, showManagerMode) {
      state.showManagerMode = showManagerMode;
    },
    setUserInfo(state, userInfo) {
      state.userInfo = userInfo;
    },
    setUserList(state, userList) {
      if (userList.length) {
        state.userList = []
          .concat([{ username: "系统默认", userNS: "default" }])
          .concat(userList);
      } else {
        state.userList = [].concat(defaultNS);
      }
    },
    setFilterRules(state, filterRules) {
      state.filterRules = filterRules;
      window.localStorage &&
        window.localStorage.setItem("filterRules", JSON.stringify(filterRules));
    },
    addFilterRule(state, rule) {
      const filterRules = [].concat(state.filterRules).concat([rule]);
      state.filterRules = filterRules;
      window.localStorage &&
        window.localStorage.setItem("filterRules", JSON.stringify(filterRules));
    },
    setNightTheme(state, isNight) {
      let config = { ...state.config };
      if (isNight) {
        if (config.theme !== 6) {
          window.localStorage &&
            window.localStorage.setItem("lastDayTheme", config.theme);
        }
        config.theme = 6;
      } else if (config.theme === 6) {
        const lastDayTheme =
          (window.localStorage &&
            window.localStorage.getItem("lastDayTheme")) ||
          0;
        config.theme = lastDayTheme;
      }
      state.config = config;
      window.localStorage &&
        window.localStorage.setItem("config", JSON.stringify(config));
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
          body:
            (state.miniInterface
              ? "linear-gradient(to bottom,rgba(0,0,0,.2) 0,transparent 56px), "
              : "") + (state.config.bodyColor || "#eadfca"),
          content: {
            backgroundImage: getters.currentContentBGImg
              ? `${
                  state.miniInterface
                    ? "linear-gradient(to bottom,rgba(0,0,0,.2) 0,transparent 56px), "
                    : ""
                }url(${getters.currentContentBGImg})`
              : null,
            backgroundPosition: "center",
            backgroundRepeat: "no-repeat",
            backgroundAttachment: "fixed",
            backgroundColor: state.config.contentColor || "#ede7da",
            backgroundSize: "cover"
          },
          popup:
            (state.miniInterface
              ? "linear-gradient(to bottom,rgba(0,0,0,.2) 0,transparent 36px), "
              : "") + (state.config.popupColor || "#ede7da")
        };
      } else {
        const config = {
          ...settings.themes[state.config.theme]
        };
        if (state.miniInterface) {
          config.body =
            "linear-gradient(to bottom,rgba(0,0,0,.2) 0,transparent 36px), " +
            config.body;
          config.content =
            "linear-gradient(to bottom,rgba(0,0,0,.2) 0,transparent 36px), " +
            config.content;
          config.popup =
            "linear-gradient(to bottom,rgba(0,0,0,.2) 0,transparent 36px), " +
            config.popup;
        }
        return config;
      }
    },
    shelfBooks: state => {
      return state.shelfBooks.sort(function(a, b) {
        var x = a["durChapterTime"] || 0;
        var y = b["durChapterTime"] || 0;
        return y - x;
      });
    }
  }
});
