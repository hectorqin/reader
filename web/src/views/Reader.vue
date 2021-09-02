<template>
  <div
    class="chapter-wrapper"
    :style="bodyTheme"
    :class="{ night: isNight, day: !isNight }"
    @click="showToolBar = !showToolBar"
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
          <ReadSettings class="popup" />

          <div class="tool-icon" slot="reference">
            <div class="iconfont">
              &#58971;
            </div>
            <div class="icon-text">设置</div>
          </div>
        </el-popover>
        <div class="tool-icon" @click="toShelf">
          <div class="iconfont">
            &#58920;
          </div>
          <div class="icon-text">首页</div>
        </div>
        <div class="tool-icon" :class="{ 'no-point': noPoint }" @click="toTop">
          <div class="iconfont">
            &#58914;
          </div>
          <div class="icon-text">顶部</div>
        </div>
        <div
          class="tool-icon"
          :class="{ 'no-point': noPoint }"
          @click="toBottom"
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
    <div class="chapter" ref="content" :style="chapterTheme">
      <div class="content">
        <div class="top-bar" ref="top"></div>
        <div class="title" ref="title" v-if="show">{{ title }}</div>
        <Pcontent :carray="content" />
        <div class="bottom-bar" ref="bottom"></div>
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
import config from "../plugins/config";
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
    const that = this;
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

    // window.addEventListener keyup 声明函数

    this.func_keyup = function(event) {
      switch (event.key) {
        case "ArrowLeft":
          event.stopPropagation();
          event.preventDefault();
          if (
            that.$store.state.readingBook &&
            that.$store.state.readingBook.bookUrl
          ) {
            that.toLastChapter();
          }
          break;
        case "ArrowRight":
          event.stopPropagation();
          event.preventDefault();
          if (
            that.$store.state.readingBook &&
            that.$store.state.readingBook.bookUrl
          ) {
            that.toNextChapter();
          }
          break;
        case "ArrowUp":
          event.stopPropagation();
          event.preventDefault();
          if (document.documentElement.scrollTop === 0) {
            that.$message.warning("已到达页面顶部");
          } else {
            jump(0 - document.documentElement.clientHeight + 100);
          }
          break;
        case "ArrowDown":
          event.stopPropagation();
          event.preventDefault();
          if (
            document.documentElement.clientHeight +
              document.documentElement.scrollTop ===
            document.documentElement.scrollHeight
          ) {
            that.$message.warning("已到达页面底部");
          } else {
            jump(document.documentElement.clientHeight - 100);
          }
          break;
      }
    };

    window.addEventListener("keyup", this.func_keyup);

    // console.log(this);
  },
  destroyed() {
    window.removeEventListener("keyup", this.func_keyup);
  },
  watch: {
    chapterName(to) {
      this.title = to;
    },
    content() {
      this.$store.commit("setContentLoading", false);
    },
    theme(theme) {
      if (theme == 6) {
        this.isNight = true;
      } else {
        this.isNight = false;
      }
    },
    readSettingsVisible(visible) {
      if (!visible) {
        let configText = JSON.stringify(this.$store.state.config);
        localStorage.setItem("config", configText);
      }
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
      book: null
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
      return this.$store.state.config.theme == 6;
    },
    bodyTheme() {
      return {
        background: config.themes[this.$store.state.config.theme].body
      };
    },
    chapterTheme() {
      return {
        background: config.themes[this.$store.state.config.theme].content,
        width: this.readWidth
      };
    },
    leftBarTheme() {
      return {
        background: config.themes[this.$store.state.config.theme].popup,
        marginLeft: this.$store.state.miniInterface
          ? 0
          : -(this.$store.state.config.readWidth / 2 + 68) + "px",
        display:
          this.$store.state.miniInterface && !this.showToolBar
            ? "none"
            : "block"
      };
    },
    rightBarTheme() {
      return {
        background: config.themes[this.$store.state.config.theme].popup,
        marginRight: this.$store.state.miniInterface
          ? 0
          : -(this.$store.state.config.readWidth / 2 + 52) + "px",
        display:
          this.$store.state.miniInterface && !this.showToolBar
            ? "none"
            : "block"
      };
    },
    readWidth() {
      if (!this.$store.state.miniInterface) {
        return this.$store.state.config.readWidth - 130 + "px";
      } else {
        return window.innerWidth + "px";
      }
    },
    popperWidth() {
      if (!this.$store.state.miniInterface) {
        return this.$store.state.config.readWidth - 33;
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
      jump(this.$refs.top);
    },
    toBottom() {
      jump(this.$refs.bottom);
    },
    toNextChapter() {
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

    >>>.el-icon-loading {
      font-size: 36px;
      color: #B5B5B5;
    }

    >>>.el-loading-text {
      font-weight: 500;
      color: #B5B5B5;
    }

    .content {
      font-size: 18px;
      line-height: 1.8;
      overflow: hidden;
      font-family: 'Microsoft YaHei', PingFangSC-Regular, HelveticaNeue-Light, 'Helvetica Neue Light', sans-serif;

      .title {
        margin-bottom: 57px;
        font: 24px / 32px PingFangSC-Regular, HelveticaNeue-Light, 'Helvetica Neue Light', 'Microsoft YaHei', sans-serif;
      }

      .bottom-bar, .top-bar {
        height: 64px;
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
        justify-content: space-between;
        .tool-icon {
          border: none;
        }
      }
    }

    .read-bar {
      right: 0;
      width: 100vw;
      margin-right: 0 !important;

      .tools {
        flex-direction: row;
        justify-content: space-between;
        padding: 0 15px;
        .tool-icon {
          border: none;
          width: auto;
          .iconfont {
            display: inline-block;
          }
        }
      }
    }

    .chapter {
      width: 100vw !important;
      padding: 0 20px;
      box-sizing: border-box;
    }
  }
}
</style>
