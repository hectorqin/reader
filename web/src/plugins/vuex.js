import Vue from "vue";
import Vuex from "vuex";
import themeConfig from "./config";

Vue.use(Vuex);

export default new Vuex.Store({
  state: {
    connectStatus: "正在连接后端服务器……",
    connectType: "",
    newConnect: true,
    shelf: [],
    catalog: "",
    readingBook: {},
    popCataVisible: false,
    contentLoading: true,
    showContent: false,
    config: {
      theme: 0,
      font: 0,
      fontSize: 18,
      fontWeight: 400,
      readMethod: "上下滑动",
      readWidth: 800
    },
    miniInterface: false,
    readSettingsVisible: false,
    windowWidth: window.innerWidth,
    touchable: "ontouchstart" in document
  },
  mutations: {
    setConnectStatus(state, connectStatus) {
      state.connectStatus = connectStatus;
    },
    setConnectType(state, connectType) {
      state.connectType = connectType;
    },
    setNewConnect(state, newConnect) {
      state.newConnect = newConnect;
    },
    addBooks(state, books) {
      state.shelf = books;
    },
    setCatalog(state, catalog) {
      state.catalog = catalog;
    },
    setPopCataVisible(state, visible) {
      state.popCataVisible = visible;
    },
    setContentLoading(state, loading) {
      state.contentLoading = loading;
    },
    setReadingBook(state, readingBook) {
      state.readingBook = readingBook;
    },
    setConfig(state, config) {
      state.config = config;
    },
    setReadSettingsVisible(state, visible) {
      state.readSettingsVisible = visible;
    },
    setShowContent(state, visible) {
      state.showContent = visible;
    },
    setMiniInterface(state, mini) {
      state.miniInterface = mini;
    },
    setWindowWidth(state, width) {
      state.windowWidth = width;
    },
    setTouchable(state, touchable) {
      state.touchable = touchable;
    }
  },
  getters: {
    isSlideRead: state => {
      return (
        state.miniInterface &&
        state.touchable &&
        state.config.readMethod === "左右滑动"
      );
    },
    isNight: state => {
      return state.config.theme == 6;
    },
    currentContentBGImg: state => {
      if (state.config.contentBGImg) {
        return state.config.contentBGImg.startsWith("bg/") ||
          state.config.contentBGImg.startsWith("http://") ||
          state.config.contentBGImg.startsWith("https://") ||
          state.config.contentBGImg.startsWith("//")
          ? state.config.contentBGImg
          : "//" +
              localStorage.url.replace(/\/reader3\/?/, "") +
              state.config.contentBGImg;
      }
      return undefined;
    },
    customCSSUrl: () => {
      if (localStorage.url) {
        return (
          "//" +
          localStorage.url.replace(/\/reader3\/?/, "") +
          "/assets/reader.css"
        );
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
