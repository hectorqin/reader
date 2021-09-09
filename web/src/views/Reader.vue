<template>
  <div
    class="chapter-wrapper"
    :style="bodyTheme"
    :class="{ night: isNight, day: !isNight }"
    ref="chapterWrapperRef"
  >
    <div class="tool-bar" :style="leftBarTheme">
      <div class="tools">
        <el-popover
          placement="right"
          :width="popperWidth"
          trigger="click"
          :visible-arrow="false"
          v-model="popBookShelfVisible"
          popper-class="popper-component"
        >
          <BookShelf
            ref="popBookShelf"
            class="popup"
            :popBookShelfVisible="popBookShelfVisible"
            @loadCatalog="loadCatalog"
            @toShelf="toShelf"
            @close="popBookShelfVisible = false"
          />
          <div class="tool-icon" slot="reference">
            <div class="iconfont">
              &#58892;
            </div>
            <div class="icon-text">书架</div>
          </div>
        </el-popover>
        <el-popover
          placement="right"
          :width="popperWidth"
          trigger="click"
          :visible-arrow="false"
          v-model="popBookSourceVisible"
          popper-class="popper-component"
        >
          <BookSource
            ref="popBookSource"
            class="popup"
            :popBookSourceVisible="popBookSourceVisible"
            @loadCatalog="loadCatalog"
            @close="popBookSourceVisible = false"
          />

          <div
            class="tool-icon"
            :class="{ 'no-point': noPoint }"
            slot="reference"
            style="padding-top: 9px"
          >
            <i class="el-icon-menu"></i>
            <div class="icon-text">书源</div>
          </div>
        </el-popover>
        <el-popover
          placement="right"
          :width="popperWidth"
          trigger="click"
          :visible-arrow="false"
          v-model="popCataVisible"
          popper-class="popper-component"
        >
          <PopCata
            @getContent="getContent"
            ref="popCata"
            class="popup"
            @refresh="refreshCatalog"
          />

          <div
            class="tool-icon"
            :class="{ 'no-point': noPoint }"
            slot="reference"
          >
            <div class="iconfont">
              &#58905;
            </div>
            <div class="icon-text">目录</div>
          </div>
        </el-popover>
        <el-popover
          placement="right"
          :width="popperWidth"
          trigger="click"
          :visible-arrow="false"
          v-model="readSettingsVisible"
          popper-class="popper-component"
        >
          <ReadSettings
            class="popup"
            @hideSettingPop="readSettingsVisible = false"
            @showClickZone="showClickZone = true"
          />

          <div class="tool-icon" slot="reference">
            <div class="iconfont">
              &#58971;
            </div>
            <div class="icon-text">设置</div>
          </div>
        </el-popover>
        <div
          class="tool-icon"
          @click="toShelf"
          :style="$store.state.miniInterface ? { order: -1 } : {}"
        >
          <div class="iconfont">
            &#58920;
          </div>
          <div class="icon-text">首页</div>
        </div>
        <div
          class="tool-icon"
          :class="{ 'no-point': noPoint }"
          @click="toTop"
          v-if="!isSlideRead"
        >
          <div class="iconfont">
            &#58914;
          </div>
          <div class="icon-text">顶部</div>
        </div>
        <div
          class="tool-icon"
          :class="{ 'no-point': noPoint }"
          @click="toBottom"
          v-if="!isSlideRead"
        >
          <div class="iconfont">
            &#58915;
          </div>
          <div class="icon-text">底部</div>
        </div>
      </div>
    </div>
    <div class="read-bar" :style="rightBarTheme">
      <div class="tools">
        <div class="tool-icon progress-text">
          <span v-if="$store.state.miniInterface">阅读进度: </span>
          {{ readingProgress }}
        </div>
        <div
          class="tool-icon"
          :class="{ 'no-point': noPoint }"
          @click="toLastChapter"
          :style="$store.state.miniInterface ? { order: -1 } : {}"
        >
          <div class="iconfont">
            &#58920;
          </div>
          <span v-if="$store.state.miniInterface">上一章</span>
        </div>
        <div
          class="tool-icon"
          :class="{ 'no-point': noPoint }"
          @click="toNextChapter"
        >
          <span v-if="$store.state.miniInterface">下一章</span>
          <div class="iconfont">
            &#58913;
          </div>
        </div>
      </div>
    </div>
    <div class="chapter-bar"></div>
    <div
      class="chapter"
      ref="content"
      :class="chapterClass"
      :style="chapterTheme"
    >
      <div
        class="click-zone"
        v-if="showClickZone"
        :style="!isSlideRead ? { position: 'fixed' } : {}"
      >
        <div :style="showPrevPageStyle"><span>点击前一页</span></div>
        <div :style="showMenuZoneStyle"><span>点击显示菜单</span></div>
        <div :style="showNextPageStyle"><span>点击后一页</span></div>
        <div class="close-btn" @click="showClickZone = false">关闭</div>
      </div>
      <div class="top-bar" ref="top">
        {{ $store.state.miniInterface ? title : "" }}
      </div>
      <div
        class="content"
        @touchstart="handleTouchStart"
        @touchmove="handleTouchMove"
        @touchend="handleTouchEnd"
        @click="handlerClick"
      >
        <div class="content-inner">
          <Pcontent
            class="book-content"
            :title="title"
            :carray="content"
            :style="contentStyle"
            ref="bookContentRef"
          />
        </div>
      </div>
      <div class="bottom-bar" ref="bottom">
        {{ $store.getters.isSlideRead ? `${currentPage} / ${totalPages}` : "" }}
        <span
          class="bottom-btn"
          v-if="this.show && !$store.getters.isSlideRead"
          @click="toNextChapter"
          >加载下一章</span
        >
      </div>
    </div>
  </div>
</template>

<script>
import PopCata from "../components/PopCatalog.vue";
import ReadSettings from "../components/ReadSettings.vue";
import BookSource from "../components/BookSource.vue";
import BookShelf from "../components/BookShelf.vue";
import Pcontent from "../components/Content.vue";
import Axios from "axios";
import jump from "../plugins/jump";
import Animate from "../plugins/animate";

export default {
  components: {
    PopCata,
    BookSource,
    BookShelf,
    Pcontent,
    ReadSettings
  },
  mounted() {
    //获取书籍数据
    let bookUrl = sessionStorage.getItem("bookUrl");
    let readingBook = false;
    if (bookUrl) {
      let bookName = sessionStorage.getItem("bookName");
      let chapterIndex = (sessionStorage.getItem("chapterIndex") || 0) | 0;
      readingBook = JSON.parse(localStorage.getItem(bookUrl));
      if (readingBook == null || chapterIndex > 0) {
        readingBook = {
          bookName: bookName,
          bookUrl: bookUrl,
          index: chapterIndex
        };
      }
    } else {
      try {
        //获取最近阅读书籍
        let readingRecentStr = localStorage.getItem("readingRecent");
        if (readingRecentStr != null) {
          const readingRecent = JSON.parse(readingRecentStr);
          if (typeof readingRecent.index == "undefined") {
            readingRecent.index = 0;
          }
          if (readingRecent.bookUrl && readingRecent.bookName) {
            readingBook = readingRecent;
          }
        }
      } catch (error) {
        //
      }
    }

    if (readingBook) {
      this.loading = this.$loading({
        target: this.$refs.content,
        lock: true,
        text: "正在获取内容",
        spinner: "el-icon-loading",
        background: "rgba(0,0,0,0)"
      });
      localStorage.setItem(bookUrl, JSON.stringify(readingBook));
      this.$store.commit("setReadingBook", readingBook);
      this.loadCatalog();
    } else {
      this.$message.error("请在书架选择书籍");
    }

    // window.addEventListener
    window.addEventListener("keydown", this.keydownHandler);

    window.readerPage = this;
  },
  destroyed() {
    window.removeEventListener("keydown", this.keydownHandler);
  },
  watch: {
    chapterName(to) {
      this.title = to;
    },
    content() {
      this.$store.commit("setContentLoading", false);
      this.$nextTick(() => {
        this.computePages();
      });
    },
    readSettingsVisible(visible) {
      if (!visible) {
        let configText = JSON.stringify(this.$store.state.config);
        localStorage.setItem("config", configText);
      }
    },
    title(title) {
      if (title) {
        document.title = this.$store.state.readingBook.bookName + " - " + title;
      } else {
        document.title = this.$store.state.readingBook.bookName;
      }
    },
    isSlideRead(val) {
      if (!val) {
        this.contentStyle = {};
        this.transformX = 0;
      }
      this.$nextTick(() => {
        this.computePages();
        this.showPage(this.currentPage, 0);
      });
    }
  },
  data() {
    return {
      title: "",
      content: [],
      noPoint: true,
      popBookSourceVisible: false,
      popBookShelfVisible: false,
      showToolBar: true,
      book: null,
      contentStyle: {},
      currentPage: 1,
      totalPages: 1,
      transformX: 0,
      transforming: false,
      showLastPage: false,
      showClickZone: false
    };
  },
  computed: {
    catalog() {
      return (this.$store.state.readingBook || {}).catalog || [];
    },
    chapterIndex() {
      return ((this.$store.state.readingBook || {}).index || 0) | 0;
    },
    windowHeight() {
      return window.innerHeight;
    },
    contentHeight() {
      return this.$refs.content.offsetHeight;
    },
    popCataVisible: {
      get() {
        return this.$store.state.popCataVisible;
      },
      set(value) {
        this.$store.commit("setPopCataVisible", value);
      }
    },
    readSettingsVisible: {
      get() {
        return this.$store.state.readSettingsVisible;
      },
      set(value) {
        this.$store.commit("setReadSettingsVisible", value);
      }
    },
    config() {
      return this.$store.state.config;
    },
    theme() {
      return this.config.theme;
    },
    isNight() {
      return this.$store.getters.isNight;
    },
    bodyTheme() {
      return {
        background: this.$store.getters.currentThemeConfig.body
      };
    },
    isSlideRead() {
      return this.$store.getters.isSlideRead;
    },
    chapterClass() {
      return this.$store.getters.isSlideRead ? "slide-reader" : "";
    },
    chapterTheme() {
      if (typeof this.$store.getters.currentThemeConfig.content === "string") {
        return {
          background: this.$store.getters.currentThemeConfig.content,
          width: this.readWidth
        };
      } else {
        return {
          ...this.$store.getters.currentThemeConfig.content,
          width: this.readWidth
        };
      }
    },
    leftBarTheme() {
      return {
        background: this.$store.getters.currentThemeConfig.popup,
        marginLeft: this.$store.state.miniInterface
          ? 0
          : -(this.readWidthConfig / 2 + 68) + "px",
        display:
          this.$store.state.miniInterface && !this.showToolBar
            ? "none"
            : "block"
      };
    },
    rightBarTheme() {
      return {
        background: this.$store.getters.currentThemeConfig.popup,
        marginRight: this.$store.state.miniInterface
          ? 0
          : -(this.readWidthConfig / 2 + 52) + "px",
        display:
          this.$store.state.miniInterface && !this.showToolBar
            ? "none"
            : "block"
      };
    },
    readWidth() {
      if (!this.$store.state.miniInterface) {
        return this.readWidthConfig - 130 + "px";
      } else {
        return window.innerWidth + "px";
      }
    },
    readWidthConfig() {
      var width = this.$store.state.config.readWidth;
      while (width > this.$store.state.windowWidth - 120) {
        width -= 160;
      }
      return width;
    },
    popperWidth() {
      if (!this.$store.state.miniInterface) {
        return this.readWidthConfig - 33;
      } else {
        return window.innerWidth - 33;
      }
    },
    show() {
      return this.$store.state.showContent;
    },
    readingProgress() {
      if (
        this.$store.state.readingBook &&
        this.$store.state.readingBook.catalog
      ) {
        return (
          parseInt(((this.chapterIndex + 1) * 100) / this.catalog.length) + "%"
        );
      } else {
        return "";
      }
    },
    showPrevPageStyle() {
      if (this.isSlideRead) {
        // 左半部
        return {
          left: 0,
          top: 0,
          bottom: 0,
          right: window.innerWidth / 2 + "px",
          background: "#43987324",
          paddingRight: window.innerWidth * 0.2 + "px"
        };
      } else {
        // 上半部
        return {
          left: 0,
          top: 0,
          right: 0,
          bottom: window.innerHeight / 2 + "px",
          background: "#43987324"
        };
      }
    },
    showMenuZoneStyle() {
      return {
        top: window.innerHeight * 0.3 + "px",
        bottom: window.innerHeight * 0.3 + "px",
        left: window.innerWidth * 0.3 + "px",
        right: window.innerWidth * 0.3 + "px",
        background: "#636060",
        zIndex: 10
      };
    },
    showNextPageStyle() {
      if (this.isSlideRead) {
        // 右半部
        return {
          right: 0,
          top: 0,
          bottom: 0,
          left: window.innerWidth / 2 + "px",
          background: "#6b1a7324",
          paddingLeft: window.innerWidth * 0.2 + "px"
        };
      } else {
        // 下半部
        return {
          left: 0,
          bottom: 0,
          right: 0,
          top: window.innerHeight / 2 + "px",
          background: "#6b1a7324"
        };
      }
    }
  },
  methods: {
    loadCatalog(refresh) {
      if (!localStorage.url) {
        setTimeout(() => {
          if (this.loadCatalog) {
            this.loadCatalog(refresh);
          }
        }, 1000);
        return;
      }
      // this.$message.info("获取章节列表");
      this.getCatalog(this.$store.state.readingBook.bookUrl, refresh).then(
        res => {
          // 连接后端成功，加载自定义样式
          window.customCSSLoad ||
            window.loadLink(this.$store.getters.customCSSUrl, () => {
              window.customCSSLoad = true;
            });
          if (res.data.isSuccess) {
            var book = Object.assign({}, this.$store.state.readingBook);
            book.catalog = res.data.data;
            this.$store.commit("setReadingBook", book);
            var index = book.index || 0;
            this.getContent(index);
          } else {
            this.$message.error(res.data.errorMsg);
          }
        },
        err => {
          this.loading.close();
          this.$message.error("获取书籍目录失败");
          throw err;
        }
      );
    },
    getCatalog(bookUrl, refresh) {
      return Axios.get(
        "http://" +
          localStorage.url +
          "/getChapterList?url=" +
          encodeURIComponent(bookUrl) +
          "&refresh=" +
          (refresh ? 1 : 0)
      );
    },
    refreshCatalog() {
      return this.loadCatalog(true);
    },
    getContent(index) {
      //展示进度条
      this.$store.commit("setShowContent", false);
      if (!this.loading || !this.loading.visible) {
        this.loading = this.$loading({
          target: this.$refs.content,
          lock: true,
          text: "正在获取内容",
          spinner: "el-icon-loading",
          background: "rgba(0,0,0,0)"
        });
      }
      let bookUrl = this.$store.state.readingBook.bookUrl;
      sessionStorage.setItem("bookUrl", bookUrl);
      sessionStorage.setItem(
        "bookName",
        this.$store.state.readingBook.bookName
      );
      try {
        // 保存阅读进度
        let book = JSON.parse(localStorage.getItem(bookUrl));
        book.index = index;
        localStorage.setItem(bookUrl, JSON.stringify(book));
        // this.$store.state.readingBook.index = index;
        book.catalog = this.$store.state.readingBook.catalog;
        this.$store.commit("setReadingBook", book);
        sessionStorage.setItem("chapterIndex", index);
        //
        localStorage.setItem(
          "readingRecent",
          JSON.stringify({
            bookName: book.bookName,
            bookUrl: book.bookUrl,
            index: index
          })
        );
      } catch (error) {
        //
      }
      //let chapterUrl = this.$store.state.readingBook.catalog[index].url;
      let chapterName = this.$store.state.readingBook.catalog[index].title;
      let chapterIndex = this.$store.state.readingBook.catalog[index].index;
      this.title = chapterName;
      //强制滚回顶层
      jump(this.$refs.top, { duration: 0 });
      let that = this;
      Axios.get(
        "http://" +
          localStorage.url +
          "/getBookContent?url=" +
          encodeURIComponent(bookUrl) +
          "&index=" +
          chapterIndex
      ).then(
        res => {
          let data = res.data.data;
          that.content = data.split(/\n+/);
          this.$store.commit("setContentLoading", true);
          that.loading.close();
          that.noPoint = false;
          that.$store.commit("setShowContent", true);
        },
        err => {
          that.loading.close();
          that.$message.error("获取章节内容失败");
          that.content = "　　获取章节内容失败！";
          throw err;
        }
      );
    },
    toTop() {
      if (this.$store.state.miniInterface) {
        this.scrollContent(
          -(document.documentElement.scrollTop || document.body.scrollTop),
          1000
        );
      } else {
        jump(this.$refs.top);
      }
    },
    toBottom() {
      jump(this.$refs.bottom);
    },
    toNextChapter() {
      if (
        !this.$store.state.readingBook ||
        !this.$store.state.readingBook.bookUrl ||
        !this.$store.state.readingBook.catalog
      ) {
        return;
      }
      this.$store.commit("setContentLoading", true);
      let index = this.$store.state.readingBook.index;
      index++;
      if (typeof this.$store.state.readingBook.catalog[index] !== "undefined") {
        // this.$message.info("下一章");
        this.getContent(index);
      } else {
        this.$message.error("本章是最后一章");
      }
    },
    toLastChapter() {
      if (
        !this.$store.state.readingBook ||
        !this.$store.state.readingBook.bookUrl ||
        !this.$store.state.readingBook.catalog
      ) {
        return;
      }
      this.$store.commit("setContentLoading", true);
      let index = this.$store.state.readingBook.index;
      index--;
      if (typeof this.$store.state.readingBook.catalog[index] !== "undefined") {
        // this.$message.info("上一章");
        this.getContent(index);
      } else {
        this.$message.error("本章是第一章");
      }
    },
    toShelf() {
      this.$router.push("/");
    },
    computePages() {
      if (this.isSlideRead) {
        this.totalPages = Math.ceil(
          this.$refs.bookContentRef.$el.scrollWidth / window.innerWidth
        );
      } else {
        this.totalPages = Math.ceil(
          this.$refs.bookContentRef.$el.scrollHeight / window.innerHeight
        );
      }
      if (this.showLastPage) {
        this.showPage(this.totalPages, 0);
        this.showLastPage = false;
      }
    },
    nextPage(moveX) {
      if (!this.show) {
        return;
      }
      if (this.transforming) {
        return;
      }
      this.transforming = true;
      if (this.$store.getters.isSlideRead) {
        if (this.currentPage < this.totalPages) {
          if (typeof moveX === "undefined") {
            this.transformX =
              -(window.innerWidth - 16) * (this.currentPage - 1);
          }
          this.currentPage += 1;
          this.transform(
            typeof moveX === "undefined" ? -(window.innerWidth - 16) : moveX,
            300
          );
        } else {
          this.contentStyle = {};
          this.transformX = 0;
          this.currentPage = 1;
          this.toNextChapter();
        }
      } else {
        if (
          (document.documentElement.scrollTop || document.body.scrollTop) +
            window.innerHeight <
          document.documentElement.scrollHeight
        ) {
          const moveY = window.innerHeight - 10;
          this.scrollContent(moveY, 300);
        } else {
          this.currentPage = 1;
          this.toNextChapter();
        }
      }
    },
    prevPage(moveX) {
      if (!this.show) {
        return;
      }
      if (this.transforming) {
        return;
      }
      this.transforming = true;
      if (this.$store.getters.isSlideRead) {
        if (this.currentPage > 1) {
          if (typeof moveX === "undefined") {
            this.transformX =
              -(window.innerWidth - 16) * (this.currentPage - 1);
          }
          this.currentPage -= 1;
          this.transform(
            typeof moveX === "undefined" ? window.innerWidth - 16 : moveX,
            300
          );
        } else {
          this.showLastPage = true;
          this.contentStyle = {};
          this.transformX = 0;
          this.currentPage = 1;
          this.toLastChapter();
        }
      } else {
        if (
          (document.documentElement.scrollTop || document.body.scrollTop) > 0
        ) {
          const moveY = -window.innerHeight + 10;
          this.scrollContent(moveY, 300);
        } else {
          this.currentPage = 1;
          this.toLastChapter();
        }
      }
    },
    showPage(page, duration) {
      if (!this.show) {
        return;
      }
      if (this.transforming) {
        return;
      }
      this.transforming = true;
      this.currentPage = Math.min(page, this.totalPages);
      if (this.$store.getters.isSlideRead) {
        const moveX =
          -(window.innerWidth - 16) * (this.currentPage - 1) - this.transformX;
        this.transform(moveX, typeof duration === "undefined" ? 300 : duration);
      } else {
        const moveY =
          (window.innerHeight - 10) * (this.currentPage - 1) -
          (document.documentElement.scrollTop || document.body.scrollTop);
        this.scrollContent(
          moveY,
          typeof duration === "undefined" ? 300 : duration
        );
      }
    },
    transform(moveX, duration) {
      const onEnd = () => {
        this.contentStyle = {
          transform: `translateX(${this.transformX + moveX}px)`
        };
        this.transformX += moveX;
        this.transforming = false;
      };
      if (!duration) {
        onEnd();
        return;
      }
      const timing = Animate.Utils.makeEaseInOut(
        Animate.Timings.power.bind(null, 3)
      );

      new Animate({
        duration: duration || 500,
        timing: timing,
        draw: progress => {
          this.contentStyle = {
            transform: `translateX(${this.transformX + moveX * progress}px)`
          };
        },
        onEnd
      });
    },
    scrollContent(moveY, duration) {
      // console.log("scrollContent", moveY);
      const lastScrollTop =
        document.documentElement.scrollTop || document.body.scrollTop;
      const onEnd = () => {
        document.documentElement.scrollTop = lastScrollTop + moveY;
        document.body.scrollTop = lastScrollTop + moveY;
        this.transforming = false;
      };
      if (!duration) {
        onEnd();
        return;
      }
      const timing = Animate.Utils.makeEaseInOut(
        Animate.Timings.power.bind(null, 3)
      );

      new Animate({
        duration: duration || 500,
        timing: timing,
        draw: progress => {
          document.documentElement.scrollTop = lastScrollTop + moveY * progress;
          document.body.scrollTop = lastScrollTop + moveY * progress;
        },
        onEnd
      });
    },
    handlerClick(e) {
      if (!this.lastTouch) {
        this.eventHandler(e);
      }
    },
    handleTouchStart(e) {
      // e.preventDefault();
      // e.stopPropagation();
      this.lastTouch = false;
      this.lastMoveX = false;
      if (e.touches && e.touches[0]) {
        this.lastTouch = e.touches[0];
      }
    },
    handleTouchMove(e) {
      if (e.touches && e.touches[0] && this.lastTouch) {
        e.preventDefault();
        e.stopPropagation();
        const moveX = e.touches[0].clientX - this.lastTouch.clientX;
        this.contentStyle = {
          transform: `translateX(${this.transformX + moveX}px)`
        };
        this.lastMoveX = moveX;
      }
    },
    handleTouchEnd() {
      if (this.lastMoveX) {
        this.transformX += this.lastMoveX;
        if (this.lastMoveX > 0) {
          // 上一页
          this.prevPage(window.innerWidth - 16 - this.lastMoveX);
        } else {
          // 下一页
          this.nextPage(-(window.innerWidth - 16) - this.lastMoveX);
        }
      } else if (this.lastTouch) {
        this.eventHandler(this.lastTouch);
      }
      setTimeout(() => {
        this.lastTouch = false;
        this.lastMoveX = false;
      }, 300);
    },
    eventHandler(point) {
      // console.log(point);
      if (
        this.popBookSourceVisible ||
        this.popBookShelfVisible ||
        this.popCataVisible ||
        this.readSettingsVisible
      ) {
        return;
      }
      // 根据点击位置判断操作
      const midX = window.innerWidth / 2;
      const midY = window.innerHeight / 2;
      if (
        Math.abs(point.clientY - midY) <= window.innerHeight * 0.2 &&
        Math.abs(point.clientX - midX) <= window.innerWidth * 0.2
      ) {
        // 点击中部区域显示菜单
        this.showToolBar = !this.showToolBar;
      } else if (this.$store.state.config.clickMethod === "下一页") {
        // 全屏点击下一页
        this.showToolBar = false;
        this.nextPage();
        return;
      } else if (this.isSlideRead) {
        if (point.clientX > midX) {
          // 点击右侧，下一页
          this.showToolBar = false;
          this.nextPage();
        } else if (point.clientX < midX) {
          // 点击左侧，上一页
          this.showToolBar = false;
          this.prevPage();
        }
      } else {
        if (point.clientY > midY) {
          // 点击下部，下一页
          this.showToolBar = false;
          this.nextPage();
        } else if (point.clientY < midY) {
          // 点击上部，上一页
          this.showToolBar = false;
          this.prevPage();
        }
      }
    },
    keydownHandler(event) {
      // console.log("keyup", event);
      if (
        this.popBookSourceVisible ||
        this.popBookShelfVisible ||
        this.popCataVisible ||
        this.readSettingsVisible
      ) {
        return;
      }
      const keyCodeMap = {
        37: "ArrowLeft",
        38: "ArrowUp",
        39: "ArrowRight",
        40: "ArrowDown"
      };
      const eventKey = event.key || keyCodeMap[event.keyCode];
      switch (eventKey) {
        case "ArrowLeft":
          event.preventDefault();
          event.stopPropagation();
          this.showToolBar = false;
          if (this.isSlideRead) {
            this.prevPage();
          } else {
            this.toLastChapter();
          }
          break;
        case "ArrowRight":
          event.preventDefault();
          event.stopPropagation();
          this.showToolBar = false;
          if (this.isSlideRead) {
            this.nextPage();
          } else {
            this.toNextChapter();
          }
          break;
        case "ArrowUp":
          event.preventDefault();
          event.stopPropagation();
          this.showToolBar = false;
          this.prevPage();
          break;
        case "ArrowDown":
          event.preventDefault();
          event.stopPropagation();
          this.showToolBar = false;
          this.nextPage();
          break;
      }
    }
  }
};
</script>

<style lang="stylus" scoped>
>>>.popper-component {
  margin-left: 10px;
}

.chapter-wrapper {
  padding: 0 4%;
  flex-direction: column;
  align-items: center;

  >>>.no-point {
    pointer-events: none;
  }

  .tool-bar {
    position: fixed;
    top: 0;
    left: 50%;
    z-index: 100;

    .tools {
      display: flex;
      flex-direction: column;

      .tool-icon {
        font-size: 18px;
        width: 58px;
        height: 48px;
        text-align: center;
        padding-top: 12px;
        cursor: pointer;
        outline: none;

        .iconfont {
          font-family: iconfont;
          width: 16px;
          height: 16px;
          font-size: 16px;
          margin: 0 auto 6px;
        }

        .icon-text {
          font-size: 12px;
        }
      }
    }
  }

  .read-bar {
    position: fixed;
    bottom: 0;
    right: 50%;
    z-index: 100;

    .tools {
      display: flex;
      flex-direction: column;

      .tool-icon {
        font-size: 18px;
        width: 42px;
        height: 31px;
        padding-top: 12px;
        text-align: center;
        align-items: center;
        cursor: pointer;
        outline: none;
        margin-top: -1px;

        &.progress-text {
          font-size: 16px;
        }

        .iconfont {
          font-family: iconfont;
          width: 16px;
          height: 16px;
          font-size: 16px;
          margin: 0 auto 6px;
        }
      }
    }
  }

  .chapter-bar {
    .el-breadcrumb {
      .item {
        font-size: 14px;
        color: #606266;
      }
    }
  }

  .chapter {
    font-family: 'Microsoft YaHei', PingFangSC-Regular, HelveticaNeue-Light, 'Helvetica Neue Light', sans-serif;
    text-align: left;
    padding: 0 65px;
    min-height: 100vh;
    width: 670px;
    margin: 0 auto;
    background-size: cover;
    position: relative;

    >>>.el-icon-loading {
      font-size: 36px;
      color: #B5B5B5;
    }

    >>>.el-loading-text {
      font-weight: 500;
      color: #B5B5B5;
    }

    .click-zone {
      position: absolute;
      z-index: 120;
      top: 0;
      bottom: 0;
      left: 0;
      right: 0;
      background: #333;
      opacity: 0.8;
      color: #fff;
      font-size: 14px;
      pointer-events: none;

      div {
        position: absolute;
        text-align: center;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .close-btn {
        left: 0;
        right: 0;
        bottom: 20px;
        height: 45px;
        line-height: 45px;
        z-index: 10;
        padding: 0;
        pointer-events: all;
      }
    }

    .content {
      font-size: 18px;
      line-height: 1.8;
      overflow: hidden;
      font-family: 'Microsoft YaHei', PingFangSC-Regular, HelveticaNeue-Light, 'Helvetica Neue Light', sans-serif;
    }

    .bottom-bar, .top-bar {
      height: 44px;
      box-sizing: border-box;
      font-size: 0.8em;
    }
    .top-bar {
      height: 44px;
      padding: 10px;
    }
    .bottom-bar {
      width: 100%;
      text-align: center;
      .bottom-btn {
        font-size: 14px;
        cursor: pointer;
        display: inline-block;
        margin: 10px auto;
      }
    }
  }
}

.day {
  >>>.popup {
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.12), 0 0 6px rgba(0, 0, 0, 0.04);
  }

  >>>.tool-icon {
    border: 1px solid rgba(0, 0, 0, 0.1);
    margin-top: -1px;
    color: #000;

    .icon-text {
      color: rgba(0, 0, 0, 0.4);
    }
  }

  >>>.chapter {
    border: 1px solid #d8d8d8;
    color: #262626;
  }

  .bottom-bar, .top-bar {
    color: rgba(0, 0, 0, 0.4);
  }
}

.night {
  >>>.popup {
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.48), 0 0 6px rgba(0, 0, 0, 0.16);
  }

  >>>.tool-icon {
    border: 1px solid #444;
    margin-top: -1px;
    color: #666;

    .icon-text {
      color: #666;
    }
  }

  >>>.chapter {
    border: 1px solid #444;
    color: #666;
  }

  >>>.popper__arrow {
    background: #666;
  }

  .bottom-bar, .top-bar {
    color: #666;
  }
}
@media screen and (max-width: 750px) {
  .chapter-wrapper {
    padding: 0;

    .tool-bar {
      left: 0;
      width: 100vw;
      margin-left: 0 !important;

      .tools {
        flex-direction: row;
        justify-content: space-around;
        .tool-icon {
          border: none;
        }
      }
    }

    .read-bar {
      right: 0;
      width: 100vw;
      margin-right: 0 !important;
      height: 45px;

      .tools {
        flex-direction: row;
        justify-content: space-around;
        padding: 0 15px;
        .tool-icon {
          border: none;
          width: auto;
          padding: 0;
          height: 45px;
          line-height: 45px;
          .iconfont {
            display: inline-block;
          }
          span {
            vertical-align: middle;
          }
        }
      }
    }

    .chapter {
      width: 100vw !important;
      padding: 0 16px;
      box-sizing: border-box;
      border: none;
      text-align: justify;

      .top-bar {
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        z-index: 50;
        background: inherit;
      }

      .content-inner {
        padding-top: 45px;
      }
    }

    .chapter.slide-reader {
      padding: 0;

      .bottom-bar {
        height: 18px;
        position: absolute;
        bottom: 0;
        padding: 0 16px;
      }

      .top-bar {
        position: relative;
      }

      .content {
        position: absolute;
        overflow: visible;
        top: 44px;
        bottom: 18px;
      }

      .content-inner {
        margin: 0 16px;
        overflow: hidden;
        text-align: justify;
        padding: 0;
      }

      .book-content {
        height: calc(100vh - 44px - 18px);
        -webkit-columns: calc(100vw - 32px) 1;
        -webkit-column-gap: 32px;
        columns: calc(100vw - 16px) 1;
        column-gap: 16px;
      }
    }
  }
  .chapter-wrapper::-webkit-scrollbar {
    width: 0 !important;
  }
}
</style>
