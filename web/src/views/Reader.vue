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
            :visible="popBookShelfVisible"
            @loadCatalog="loadCatalog(true, true)"
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
            :visible="popBookSourceVisible"
            @loadCatalog="loadCatalog(true, true)"
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
            :visible="popCataVisible"
            @close="popCataVisible = false"
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
            :visible="readSettingsVisible"
            @close="readSettingsVisible = false"
            @showClickZone="showClickZone = true"
            @readMethodChange="beforeReadMethodChange"
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
      <div
        class="headset-item"
        :style="popupAbsoluteBtnStyle"
        @click="showReadBar = true"
      >
        <i class="el-icon-headset"></i>
      </div>
      <div
        class="theme-item"
        :style="popupAbsoluteBtnStyle"
        @click="toogleNight"
      >
        <i class="el-icon-moon" v-if="!isNight"></i>
        <i class="el-icon-sunny" v-else></i>
      </div>
      <div class="progress" v-if="$store.state.miniInterface">
        <div class="progress-bar">
          <el-slider
            v-model="currentPage"
            :min="1"
            :max="totalPages"
            :show-tooltip="false"
            @change="showPage"
            @input="progressValue = $event"
          ></el-slider>
        </div>
        <span class="progress-tip">{{ formatProgressTip() }}</span>
      </div>
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
    <div class="read-bar" :style="readBarTheme">
      <div class="reader-bar-inner">
        <div class="operate-bar">
          <div class="close-btn" @click="exitRead">
            <i class="el-icon-close"></i>
          </div>
          <div class="center">
            <span class="ctrl-btn" @click="speechPrev">上一段</span>
            <span class="play-pause-btn" @click="toggleSpeech">
              <i
                class="el-icon-video-pause"
                :style="popupAbsoluteBtnStyle"
                v-if="speechSpeaking"
              ></i>
              <i
                class="el-icon-video-play"
                :style="popupAbsoluteBtnStyle"
                v-else
              ></i>
            </span>
            <span class="ctrl-btn" @click="speechNext">下一段</span>
          </div>
          <div
            class="collapse-btn"
            @click="showSpeechConfig = !showSpeechConfig"
          >
            <i class="el-icon-bottom" v-if="showSpeechConfig"></i>
            <i class="el-icon-top" v-else></i>
          </div>
        </div>
        <div class="setting-item" v-if="showSpeechConfig">
          <div class="setting-title">语音库</div>
          <div class="setting-value">
            <div class="voice-list">
              <el-radio-group
                v-model="voiceName"
                size="small"
                class="radio-group"
              >
                <el-radio-button
                  class="radio-button"
                  :label="voice.name"
                  :key="index"
                  v-for="(voice, index) in voiceList"
                ></el-radio-button>
              </el-radio-group>
            </div>
          </div>
        </div>
        <div class="setting-item" v-if="showSpeechConfig">
          <div class="setting-title">语音设置</div>
          <div class="setting-value">
            <div class="progress">
              <span class="progress-tip">语速</span>
              <div class="progress-bar">
                <el-slider
                  v-model="speechRate"
                  :min="0.5"
                  :max="2"
                  :step="0.1"
                  :show-tooltip="false"
                  @change="changeSpeechRate"
                ></el-slider>
              </div>
              <span class="setting-btn" @click="changeSpeechRate(1)">重置</span>
            </div>
            <div class="progress">
              <span class="progress-tip">语调</span>
              <div class="progress-bar">
                <el-slider
                  v-model="speechPitch"
                  :min="0"
                  :max="2"
                  :step="0.1"
                  :show-tooltip="false"
                  @change="changeSpeechPitch"
                ></el-slider>
              </div>
              <span class="setting-btn" @click="changeSpeechPitch(1)"
                >重置</span
              >
            </div>
          </div>
        </div>
      </div>
    </div>
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
        <div class="content-inner" v-if="show">
          <Pcontent
            class="book-content"
            :title="title"
            :content="filterContent"
            :showContent="show"
            :style="contentStyle"
            ref="bookContentRef"
          />
        </div>
      </div>
      <div class="bottom-bar" ref="bottom">
        <span v-if="isSlideRead">{{
          `第${currentPage}/${totalPages}页 ${readingProgress}`
        }}</span>
        <span v-if="isSlideRead">{{ timeStr }}</span>
        <span
          class="bottom-btn"
          v-if="show && !isSlideRead && !error"
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
import Axios from "../plugins/axios";
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
    window.readerPage = this;
    this.speechAvalable =
      window.speechSynthesis && window.speechSynthesis.getVoices;
    if (this.speechAvalable) {
      this.fetchVoiceList();
      if (window.speechSynthesis.onvoiceschanged !== undefined) {
        window.speechSynthesis.onvoiceschanged = this.fetchVoiceList;
      }
    }
    window.addEventListener("unload", this.saveReadingPosition);
  },
  activated() {
    this.init();
    window.addEventListener("keydown", this.keydownHandler);
    if (this.title) {
      document.title =
        this.$store.state.readingBook.bookName + " - " + this.title;
    } else {
      document.title = this.$store.state.readingBook.bookName;
    }
    this.formatTime();
    this.timer = setInterval(() => {
      this.formatTime();
    }, 5000);
    this.unwatchFn = this.$store.watch(
      state => state.config,
      () => {
        this.$nextTick(() => {
          this.computePages(() => {
            if (this.currentPage > this.totalPages) {
              this.showPage(this.totalPages, 0);
            }
          });
        });
      },
      {
        deep: true
      }
    );
    window.addEventListener("scroll", this.scrollHandler);
    try {
      this.releaseWakeLockFn = this.wakeLock();
    } catch (e) {
      //
    }
  },
  deactivated() {
    this.startSavePosition = false;
    this.lastReadingBook = this.$store.state.readingBook;
    this.timer && clearInterval(this.timer);
    window.removeEventListener("keydown", this.keydownHandler);
    window.removeEventListener("scroll", this.scrollHandler);
    this.unwatchFn && this.unwatchFn();
    this.releaseWakeLockFn && this.releaseWakeLockFn();
  },
  watch: {
    chapterName(to) {
      this.title = to;
    },
    content() {
      this.contentStyle = {};
      this.transformX = 0;
      this.currentPage = 1;
      this.$nextTick(() => {
        this.computePages();
        this.saveReadingPosition();
      });
    },
    readSettingsVisible(visible) {
      if (!visible) {
        //
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
        this.computePages(() => {
          if (this.currentParagraph) {
            this.showParagraph(this.currentParagraph, true);
          } else {
            this.showPage(this.currentPage, 0);
          }
        });
      });
    },
    windowSize() {
      this.$nextTick(() => {
        this.computePages(() => {
          this.showPage(this.currentPage, 0);
        });
      });
    },
    loginAuth(val) {
      if (val) {
        this.init();
      }
    },
    showReadBar(val) {
      if (val) {
        this.showToolBar = false;
      }
    },
    readingBook(val, oldVal) {
      if (val.bookUrl !== oldVal.bookUrl) {
        this.startSavePosition = false;
        this.autoShowPosition();
      }
    }
  },
  data() {
    return {
      title: "",
      content: "",
      error: false,
      noPoint: true,
      popCataVisible: false,
      readSettingsVisible: false,
      popBookSourceVisible: false,
      popBookShelfVisible: false,
      showToolBar: true,
      book: null,
      show: false,
      contentStyle: {},
      currentPage: 1,
      totalPages: 1,
      transformX: 0,
      transforming: false,
      showLastPage: false,
      showClickZone: false,
      timeStr: "",
      progressValue: 1,

      speechAvalable: false,
      showReadBar: false,
      voiceList: [],
      speechSpeaking: false,
      showSpeechConfig: true,

      currentParagraph: null,

      startSavePosition: false
    };
  },
  computed: {
    readingBook() {
      return this.$store.state.readingBook || {};
    },
    catalog() {
      return (this.$store.state.readingBook || {}).catalog || [];
    },
    chapterIndex() {
      return ((this.$store.state.readingBook || {}).index || 0) | 0;
    },
    windowSize() {
      return this.$store.state.windowSize;
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
      return this.showReadBar ? false : this.$store.getters.isSlideRead;
    },
    chapterClass() {
      return this.isSlideRead ? "slide-reader" : "";
    },
    chapterTheme() {
      let readingStyle = this.showReadBar
        ? { paddingBottom: (this.showSpeechConfig ? 280 : 80) + "px" }
        : {};
      if (typeof this.$store.getters.currentThemeConfig.content === "string") {
        return {
          ...readingStyle,
          background: this.$store.getters.currentThemeConfig.content,
          width: this.readWidth
        };
      } else {
        return {
          ...readingStyle,
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
        background: this.$store.getters.currentThemeConfig.popupPure,
        marginRight: this.$store.state.miniInterface
          ? 0
          : -(this.readWidthConfig / 2 + 52) + "px",
        display:
          this.$store.state.miniInterface && !this.showToolBar
            ? "none"
            : "block"
      };
    },
    readBarTheme() {
      return {
        background: this.$store.getters.currentThemeConfig.popupPure,
        marginRight: this.$store.state.miniInterface
          ? 0
          : -(this.readWidthConfig / 2) + "px",
        zIndex: 200,
        display: this.speechAvalable && this.showReadBar ? "block" : "none",
        width: this.$store.state.miniInterface ? "100vw" : "500px"
      };
    },
    readWidth() {
      if (!this.$store.state.miniInterface) {
        return this.readWidthConfig - 130 + "px";
      } else {
        return this.windowSize.width + "px";
      }
    },
    readWidthConfig() {
      var width = this.$store.state.config.readWidth;
      while (width > this.$store.state.windowSize.width - 140) {
        width -= 20;
      }
      return width;
    },
    popperWidth() {
      if (!this.$store.state.miniInterface) {
        return this.readWidthConfig - 33;
      } else {
        return this.windowSize.width - 33;
      }
    },
    readingProgress() {
      if (this.catalog && this.catalog.length) {
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
          right: this.windowSize.width / 2 + "px",
          background: "#43987324",
          paddingRight: this.windowSize.width * 0.2 + "px"
        };
      } else {
        // 上半部
        return {
          left: 0,
          top: 0,
          right: 0,
          bottom: this.windowSize.height / 2 + "px",
          background: "#43987324"
        };
      }
    },
    showMenuZoneStyle() {
      return {
        top: this.windowSize.height * 0.3 + "px",
        bottom: this.windowSize.height * 0.3 + "px",
        left: this.windowSize.width * 0.3 + "px",
        right: this.windowSize.width * 0.3 + "px",
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
          left: this.windowSize.width / 2 + "px",
          background: "#6b1a7324",
          paddingLeft: this.windowSize.width * 0.2 + "px"
        };
      } else {
        // 下半部
        return {
          left: 0,
          bottom: 0,
          right: 0,
          top: this.windowSize.height / 2 + "px",
          background: "#6b1a7324"
        };
      }
    },
    loginAuth() {
      return this.$store.state.loginAuth;
    },
    filterRules() {
      return this.$store.state.filterRules;
    },
    filterContent() {
      let content = this.content;
      try {
        this.filterRules.forEach(rule => {
          const scope = rule.scope.split(";");
          if (scope[0] === this.$store.state.readingBook.bookName) {
            content = content.replace(rule.pattern, rule.replacement);
          }
        });
      } catch (error) {
        //
      }
      return content;
    },
    themeBtnStyle() {
      // if (this.$store.getters.isNight) {
      //   return {
      //     background: "#f7f7f7"
      //   };
      // } else {
      //   return {
      //     background: "#222"
      //   };
      // }
      return {
        background: this.$store.getters.currentThemeConfig.popupPure
      };
    },
    popupAbsoluteBtnStyle() {
      return {
        background: this.$store.getters.currentThemeConfig.popupPure
      };
    },
    voiceName: {
      get() {
        return this.$store.state.speechVoiceConfig.voiceName;
      },
      set(val) {
        if (val !== this.$store.state.speechVoiceConfig.voiceName) {
          if (this.speechSpeaking) {
            this.restartSpeech();
          }
        }
        this.$store.commit("setSpeechVoiceConfig", {
          ...this.$store.state.speechVoiceConfig,
          voiceName: val
        });
      }
    },
    speechRate: {
      get() {
        return this.$store.state.speechVoiceConfig.speechRate;
      },
      set(val) {
        if (val !== this.$store.state.speechVoiceConfig.speechRate) {
          if (this.speechSpeaking) {
            this.restartSpeech();
          }
        }
        this.$store.commit("setSpeechVoiceConfig", {
          ...this.$store.state.speechVoiceConfig,
          speechRate: val
        });
      }
    },
    speechPitch: {
      get() {
        return this.$store.state.speechVoiceConfig.speechPitch;
      },
      set(val) {
        if (val !== this.$store.state.speechVoiceConfig.speechPitch) {
          if (this.speechSpeaking) {
            this.restartSpeech();
          }
        }
        this.$store.commit("setSpeechVoiceConfig", {
          ...this.$store.state.speechVoiceConfig,
          speechPitch: val
        });
      }
    }
  },
  methods: {
    init() {
      if (this.$store.state.readingBook) {
        if (
          !this.lastReadingBook ||
          this.lastReadingBook.bookUrl !== this.$store.state.readingBook.bookUrl
        ) {
          this.loading = this.$loading({
            target: this.$refs.content,
            lock: true,
            text: "正在获取内容",
            spinner: "el-icon-loading",
            background: "rgba(0,0,0,0)"
          });
          this.lastReadingBook = this.$store.state.readingBook;
          // 跳转记住的位置
          this.autoShowPosition();
          this.loadCatalog(false, true);
        } else {
          this.startSavePosition = true;
          setTimeout(() => {
            // console.log("setReadingBook", this.lastReadingBook);
            this.$store.commit("setReadingBook", this.lastReadingBook);
          }, 100);
        }
      } else {
        this.$message.error("请在书架选择书籍");
      }
    },
    loadCatalog(refresh, init) {
      if (!this.api) {
        setTimeout(() => {
          if (this.loadCatalog) {
            this.loadCatalog(refresh);
          }
        }, 1000);
        return;
      }
      this.getCatalog(this.$store.state.readingBook.bookUrl, refresh).then(
        res => {
          if (res.data.isSuccess) {
            var book = Object.assign({}, this.$store.state.readingBook);
            book.catalog = res.data.data;
            this.$store.commit("setReadingBook", book);
            var index = book.index || 0;
            this.getContent(index);
          } else {
            if (init) {
              this.title = "";
              this.content = "获取章节目录失败！\n" + res.data.errorMsg;
              this.error = true;
              this.show = true;
              this.$emit("showContent");
            }
            this.loading.close();
          }
        },
        error => {
          this.loading.close();
          this.$message.error(
            "获取书籍目录列表 " + (error && error.toString())
          );
        }
      );
    },
    getCatalog(bookUrl, refresh) {
      return Axios.get(
        this.api +
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
      this.show = false;
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
      try {
        // 保存阅读进度
        let book = { ...this.$store.state.readingBook };
        book.index = index;
        this.$store.commit("setReadingBook", book);
      } catch (error) {
        //
      }
      //强制滚回顶层
      jump(this.$refs.top, { duration: 0 });
      // 如果超出目录范围，尝试刷新目录
      if (!this.$store.state.readingBook.catalog[index]) {
        if (this.tryRefresh) {
          this.tryRefresh = false;
          this.content = "获取章节内容失败，请更新目录！";
          this.error = true;
          this.show = true;
          this.$emit("showContent");
          this.loading.close();
        } else {
          this.tryRefresh = true;
          this.refreshCatalog();
        }
        return;
      }
      //let chapterUrl = this.$store.state.readingBook.catalog[index].url;
      let chapterName = this.$store.state.readingBook.catalog[index].title;
      let chapterIndex = this.$store.state.readingBook.catalog[index].index;
      this.title = chapterName;
      Axios.get(
        this.api +
          "/getBookContent?url=" +
          encodeURIComponent(bookUrl) +
          "&index=" +
          chapterIndex
      ).then(
        res => {
          if (res.data.isSuccess) {
            let data = res.data.data;
            this.content = data;
            this.loading.close();
            this.noPoint = false;
            this.error = false;
            this.show = true;
            this.$emit("showContent");
          } else {
            this.content = "获取章节内容失败！\n" + res.data.errorMsg;
            this.error = true;
            this.show = true;
            this.$emit("showContent");
            this.loading.close();
          }
        },
        error => {
          this.content = "获取章节内容失败！\n" + (error && error.toString());
          this.error = true;
          this.show = true;
          this.$emit("showContent");
          this.loading.close();
          this.$message.error(
            "获取章节内容失败 " + (error && error.toString())
          );
          throw error;
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
    toNextChapter(onError) {
      if (
        !this.$store.state.readingBook ||
        !this.$store.state.readingBook.bookUrl ||
        !this.$store.state.readingBook.catalog
      ) {
        onError && onError();
        return;
      }
      let index = this.$store.state.readingBook.index;
      index++;
      if (typeof this.$store.state.readingBook.catalog[index] !== "undefined") {
        this.getContent(index);
      } else {
        onError && onError();
        this.$message.error("本章是最后一章");
      }
    },
    toLastChapter(onError) {
      if (
        !this.$store.state.readingBook ||
        !this.$store.state.readingBook.bookUrl ||
        !this.$store.state.readingBook.catalog
      ) {
        onError && onError();
        return;
      }
      let index = this.$store.state.readingBook.index;
      index--;
      if (typeof this.$store.state.readingBook.catalog[index] !== "undefined") {
        this.getContent(index);
      } else {
        this.$message.error("本章是第一章");
        onError && onError();
      }
    },
    toShelf() {
      this.$router.push("/");
    },
    computePages(cb) {
      if (!this.$refs.bookContentRef || !this.$refs.bookContentRef.$el) {
        setTimeout(() => {
          this.computePages(cb);
        }, 30);
        return;
      }
      if (this.isSlideRead) {
        this.totalPages = Math.ceil(
          this.$refs.bookContentRef.$el.scrollWidth /
            (this.windowSize.width - 16)
        );
      } else {
        this.totalPages = Math.ceil(
          this.$refs.bookContentRef.$el.scrollHeight /
            (this.windowSize.height - 35)
        );
      }
      if (this.showLastPage) {
        this.showPage(this.totalPages, 0);
        this.showLastPage = false;
      }
      cb && cb();
    },
    nextPage(moveX) {
      if (!this.show) {
        return;
      }
      if (this.transforming) {
        return;
      }
      if (this.isSlideRead) {
        if (this.currentPage < this.totalPages) {
          if (typeof moveX === "undefined") {
            this.transformX =
              -(this.windowSize.width - 16) * (this.currentPage - 1);
          }
          this.currentPage += 1;
          this.transforming = true;
          this.transform(
            typeof moveX === "undefined"
              ? -(this.windowSize.width - 16)
              : moveX,
            300
          );
        } else {
          this.toNextChapter(() => {
            if (typeof moveX !== "undefined") {
              // 没有下一章，但是已经做了动画，恢复
              this.showPage(this.currentPage, 0);
            }
          });
        }
      } else {
        if (
          (document.documentElement.scrollTop || document.body.scrollTop) +
            this.windowSize.height <
          document.documentElement.scrollHeight
        ) {
          this.currentPage += 1;
          const moveY = this.windowSize.height - 35;
          this.transforming = true;
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
      if (this.isSlideRead) {
        if (this.currentPage > 1) {
          if (typeof moveX === "undefined") {
            this.transformX =
              -(this.windowSize.width - 16) * (this.currentPage - 1);
          }
          this.currentPage -= 1;
          this.transforming = true;
          this.transform(
            typeof moveX === "undefined" ? this.windowSize.width - 16 : moveX,
            300
          );
        } else {
          this.showLastPage = true;
          this.toLastChapter(() => {
            if (typeof moveX !== "undefined") {
              // 没有下一章，但是已经做了动画，恢复
              this.showPage(this.currentPage, 0);
            }
          });
        }
      } else {
        if (
          (document.documentElement.scrollTop || document.body.scrollTop) > 0
        ) {
          this.currentPage -= 1;
          const moveY = -this.windowSize.height + 35;
          this.transforming = true;
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
      this.currentPage = Math.min(page, this.totalPages);
      if (this.isSlideRead) {
        const moveX =
          -(this.windowSize.width - 16) * (this.currentPage - 1) -
          this.transformX;
        this.transform(moveX, typeof duration === "undefined" ? 300 : duration);
      } else {
        const moveY =
          (this.windowSize.height - 10) * (this.currentPage - 1) -
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
        // 保存进度
        setTimeout(this.saveReadingPosition, duration);
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
        // 保存进度
        setTimeout(this.saveReadingPosition, duration);
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
      if (!this.lastTouch && !this.ignoreNextClick) {
        this.eventHandler(e);
      }
      this.ignoreNextClick = false;
    },
    handleTouchStart(e) {
      this.lastSelection = this.checkSelection();
      if (this.lastSelection) {
        return;
      }
      // e.preventDefault();
      // e.stopPropagation();
      this.lastTouch = false;
      this.lastMoveX = false;
      if (e.touches && e.touches[0]) {
        this.lastTouch = e.touches[0];
      }
    },
    handleTouchMove(e) {
      if (this.checkSelection()) {
        return;
      }
      if (e.touches && e.touches[0] && this.lastTouch) {
        this.lastMoveY = e.touches[0].clientY - this.lastTouch.clientY;
        if (this.isSlideRead) {
          e.preventDefault();
          e.stopPropagation();
          const moveX = e.touches[0].clientX - this.lastTouch.clientX;
          this.contentStyle = {
            transform: `translateX(${this.transformX + moveX}px)`
          };
          this.lastMoveX = moveX;
        }
      }
    },
    handleTouchEnd() {
      if (this.checkSelection(true)) {
        return;
      }
      if (this.lastSelection) {
        setTimeout(() => {
          this.showTextFilterPrompt(this.lastSelection);
          this.lastSelection = false;
        }, 200);
        return;
      }
      if (this.lastMoveX) {
        this.transformX += this.lastMoveX;
        if (this.lastMoveX > 0) {
          // 上一页
          this.prevPage(this.windowSize.width - 16 - this.lastMoveX);
        } else {
          // 下一页
          this.nextPage(-(this.windowSize.width - 16) - this.lastMoveX);
        }
      } else if (Math.abs(this.lastMoveY) <= 3 && this.lastTouch) {
        this.eventHandler(this.lastTouch);
      }
      setTimeout(() => {
        this.lastTouch = false;
        this.lastMoveX = false;
        this.lastMoveY = false;
      }, 300);
    },
    eventHandler(point) {
      // console.log(point);
      if (this.checkSelection(true)) {
        // 选择文本
        this.ignoreNextClick = true;
        return;
      }
      if (
        this.popBookSourceVisible ||
        this.popBookShelfVisible ||
        this.popCataVisible ||
        this.readSettingsVisible
      ) {
        return;
      }
      // 根据点击位置判断操作
      const midX = this.windowSize.width / 2;
      const midY = this.windowSize.height / 2;
      if (
        Math.abs(point.clientY - midY) <= this.windowSize.height * 0.2 &&
        Math.abs(point.clientX - midX) <= this.windowSize.width * 0.2
      ) {
        // 点击中部区域显示菜单
        if (!this.showReadBar) {
          this.showToolBar = !this.showToolBar;
        }
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
    },
    formatProgressTip(value) {
      return `第 ${value || this.progressValue}/${this.totalPages} 页`;
    },
    formatTime() {
      const now = new Date();
      const pad = v => (v > 10 ? "" + v : "0" + v);
      this.timeStr = pad(now.getHours()) + ":" + pad(now.getMinutes());
    },
    checkSelection(show) {
      let text = "";
      if (window.getSelection) {
        text = window.getSelection().toString();
      } else if (document.selection && document.selection.type != "Control") {
        text = document.selection.createRange().text;
      }
      if (text && show) {
        setTimeout(() => {
          this.showTextFilterPrompt(text);
        }, 200);
      }
      return text;
    },
    async showTextFilterPrompt(text) {
      if (this.showTextFilterPrompting) {
        return;
      }
      this.showTextFilterPrompting = true;
      const h = this.$createElement;
      const bgColor = this.isNight ? "#121212" : "#eee";
      const result = await this.$prompt(
        h("div", null, [
          h("p", null, "是否要将下列文字替换为输入内容:"),
          h(
            "pre",
            {
              style: `margin-top: 10px;background: ${bgColor};padding: 10px;border: 1px solid ${bgColor};border-radius: 5px;white-space: pre-wrap;word-wrap: break-word;word-break: break-all;`
            },
            text
          )
        ]),
        "操作确认",
        {
          inputPlaceholder: "留空为过滤"
        }
      ).catch(() => {});
      if (result && result.action === "confirm") {
        this.$store.commit("addFilterRule", {
          name: "文本替换",
          pattern: text,
          replacement: result.value || "",
          scope:
            this.$store.state.readingBook.bookName +
            ";" +
            this.$store.state.readingBook.bookUrl
        });
      }
      this.showTextFilterPrompting = false;
    },
    toogleNight() {
      if (this.isNight) {
        this.$store.commit("setNightTheme", false);
      } else {
        this.$store.commit("setNightTheme", true);
      }
    },
    fetchVoiceList() {
      this.voiceList = window.speechSynthesis.getVoices().sort((a, b) => {
        if (a.lang.startsWith("zh-") && b.lang.startsWith("zh-")) {
          return a.lang > b.lang ? 1 : a.lang < b.lang ? -1 : 0;
        } else if (a.lang.startsWith("zh-")) {
          return -1;
        } else if (b.lang.startsWith("zh-")) {
          return 1;
        }
        return a.lang > b.lang ? 1 : a.lang < b.lang ? -1 : 0;
      });
    },
    changeSpeechRate(rate) {
      this.speechRate = rate;
    },
    changeSpeechPitch(pitch) {
      this.speechPitch = pitch;
    },
    startSpeech() {
      if (this.error) {
        return;
      }
      if (!this.voiceName) {
        return;
      }
      const voice = this.voiceList.find(v => v.name === this.voiceName);
      if (!voice) {
        return;
      }

      if (window.speechSynthesis.speaking) {
        return;
      }

      const paragraph = this.getCurrentParagraph();
      this.utterance = new SpeechSynthesisUtterance(paragraph.innerText);

      this.utterance.onstart = () => {
        this.speechSpeaking = true;
        this.skipAutoNext = false;
      };
      this.utterance.onend = () => {
        // 下一段
        if (!this.skipAutoNext) {
          this.speechNext();
        } else {
          this.skipAutoNext = false;
          this.speechSpeaking = false;
        }
      };
      this.utterance.onerror = event => {
        this.$message.error("朗读错误:  " + event);
        this.speechSpeaking = false;
      };
      this.utterance.voice = voice;
      this.utterance.pitch = this.speechPitch;
      this.utterance.rate = this.speechRate;

      this.scrollContent(paragraph.getBoundingClientRect().top - 30);
      paragraph.className = "reading";
      this.speechSpeaking = true;
      window.speechSynthesis.speak(this.utterance);
    },
    stopSpeech() {
      this.skipAutoNext = true;
      window.speechSynthesis.cancel();
      const current = this.getCurrentParagraph();
      current.className = "";
    },
    restartSpeech() {
      this.stopSpeech();
      setTimeout(() => {
        this.startSpeech();
      }, 100);
    },
    toggleSpeech() {
      this.speechSpeaking ? this.stopSpeech() : this.startSpeech();
    },
    speechPrev() {
      if (window.speechSynthesis.speaking) {
        this.stopSpeech();
      }
      const current = this.getCurrentParagraph();
      const prev = this.getPrevParagraph();
      if (prev) {
        this.scrollContent(prev.getBoundingClientRect().top - 30);
        current.className = "";
        prev.className = "reading";
        this.startSpeech();
      } else {
        // 上一章
        this.$once("showContent", () => {
          setTimeout(() => {
            this.startSpeech();
          }, 100);
        });
        this.toLastChapter();
      }
    },
    speechNext() {
      if (window.speechSynthesis.speaking) {
        this.stopSpeech();
      }
      const current = this.getCurrentParagraph();
      const next = this.getNextParagraph();
      if (next) {
        this.scrollContent(next.getBoundingClientRect().top - 30);
        current.className = "";
        next.className = "reading";
        this.startSpeech();
      } else {
        // 下一章
        this.$once("showContent", () => {
          setTimeout(() => {
            this.startSpeech();
          }, 100);
        });
        this.toNextChapter();
      }
    },
    getCurrentParagraph() {
      const readingEle = this.$refs.bookContentRef.$el.querySelectorAll(
        ".reading"
      );
      let currentParagraph = null;
      if (!readingEle.length) {
        // 没有正在读的段落，遍历找到当前页面的第一段
        const list = this.$refs.bookContentRef.$el.querySelectorAll("h3,p");
        for (let i = 0; i < list.length; i++) {
          const elePos = list[i].getBoundingClientRect();
          if (this.isSlideRead) {
            if (elePos.right > 0) {
              currentParagraph = list[i];
              break;
            }
          } else {
            if (elePos.bottom > 50) {
              currentParagraph = list[i];
              break;
            }
          }
        }
      } else {
        currentParagraph = readingEle[0];
      }
      return currentParagraph;
    },
    getPrevParagraph() {
      const current = this.getCurrentParagraph();
      const list = this.$refs.bookContentRef.$el.querySelectorAll("h3,p");
      for (let i = 0; i < list.length; i++) {
        if (i > 0 && current === list[i]) {
          return list[i - 1];
        }
      }
      return null;
    },
    getNextParagraph() {
      const current = this.getCurrentParagraph();
      const list = this.$refs.bookContentRef.$el.querySelectorAll("h3,p");
      for (let i = 0; i < list.length; i++) {
        if (current === list[i]) {
          return list[i + 1];
        }
      }
      return null;
    },
    exitRead() {
      this.stopSpeech();
      const current = this.getCurrentParagraph();
      this.showReadBar = false;
      this.showParagraph(current);
    },
    showParagraph(paragraph, scroll) {
      if (!paragraph) {
        return;
      }
      if (this.isSlideRead) {
        // 跳转位置
        this.$nextTick(() => {
          const pos = paragraph.getBoundingClientRect();
          if (pos.left > this.windowSize.width - 16) {
            this.showPage(
              Math.round(pos.left / (this.windowSize.width - 16)) + 1,
              0
            );
          }
        });
      } else if (scroll) {
        // 跳转位置
        this.$nextTick(() => {
          const pos = paragraph.getBoundingClientRect();
          this.scrollContent(pos.top - 30, 0);
        });
      }
    },
    scrollHandler() {
      if (!this.isSlideRead) {
        this.currentPage = Math.round(
          ((document.documentElement.scrollTop || document.body.scrollTop) +
            this.windowSize.height) /
            (this.windowSize.height - 35)
        );
      }
      this.saveReadingPosition();
    },
    beforeReadMethodChange() {
      this.currentParagraph = this.getCurrentParagraph();
    },
    showPosition(pos) {
      const list = this.$refs.bookContentRef.$el.querySelectorAll("h3,p");
      for (let i = 0; i < list.length; i++) {
        if (
          list[i].dataset &&
          typeof list[i].dataset.pos !== "undefined" &&
          +list[i].dataset.pos >= pos
        ) {
          this.showParagraph(list[i], true);
          break;
        }
      }
    },
    saveReadingPosition() {
      try {
        if (this.error || !this.startSavePosition) {
          return;
        }
        this.currentParagraph = this.getCurrentParagraph();
        if (this.currentParagraph) {
          const firstCharPos = this.$refs.bookContentRef.$el.innerText.indexOf(
            this.currentParagraph.innerText
          );
          window.localStorage &&
            window.localStorage.setItem(
              this.$store.state.readingBook.bookUrl + "@pos",
              firstCharPos
            );
        }
      } catch (error) {
        //
      }
    },
    autoShowPosition() {
      this.$once("showContent", () => {
        setTimeout(() => {
          this.startSavePosition = true;
        }, 200);
        if (this.error) {
          return;
        }
        const lastPosition =
          window.localStorage &&
          window.localStorage.getItem(
            this.$store.state.readingBook.bookUrl + "@pos"
          );
        if (+lastPosition) {
          this.$nextTick(() => {
            this.showPosition(+lastPosition);
          });
        }
      });
    },
    wakeLock() {
      if ("WakeLock" in window && "request" in window.WakeLock) {
        let wakeLock = null;
        const requestWakeLock = () => {
          const controller = new AbortController();
          const signal = controller.signal;
          window.WakeLock.request("screen", { signal }).catch(e => {
            if (e.name === "AbortError") {
              // console.log("Wake Lock was aborted");
            } else {
              // console.error(`${e.name}, ${e.message}`);
            }
          });
          // console.log("Wake Lock is active");
          return controller;
        };

        wakeLock = requestWakeLock();

        const handleVisibilityChange = () => {
          if (wakeLock !== null && document.visibilityState === "visible") {
            wakeLock = requestWakeLock();
          }
        };

        document.addEventListener("visibilitychange", handleVisibilityChange);
        document.addEventListener("fullscreenchange", handleVisibilityChange);
        return () => {
          if (wakeLock != null) {
            wakeLock.abort();
            wakeLock = null;
          }
          document.removeEventListener(
            "visibilitychange",
            handleVisibilityChange
          );
          document.removeEventListener(
            "fullscreenchange",
            handleVisibilityChange
          );
        };
      } else if ("wakeLock" in navigator && "request" in navigator.wakeLock) {
        let wakeLock = null;
        const requestWakeLock = async () => {
          try {
            wakeLock = await navigator.wakeLock.request("screen");
            wakeLock.addEventListener("release", () => {
              // console.log("Wake Lock was released");
            });
            // console.log("Wake Lock is active");
          } catch (e) {
            // console.error(`${e.name}, ${e.message}`);
          }
        };
        requestWakeLock();
        const handleVisibilityChange = () => {
          if (wakeLock !== null && document.visibilityState === "visible") {
            requestWakeLock();
          }
        };
        document.addEventListener("visibilitychange", handleVisibilityChange);
        document.addEventListener("fullscreenchange", handleVisibilityChange);
        return () => {
          if (wakeLock != null) {
            wakeLock.release();
            wakeLock = null;
          }
          document.removeEventListener(
            "visibilitychange",
            handleVisibilityChange
          );
          document.removeEventListener(
            "fullscreenchange",
            handleVisibilityChange
          );
        };
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
  padding: 0;
  flex-direction: column;
  align-items: center;

  >>>.no-point {
    pointer-events: none;
  }

  .tool-bar {
    position: fixed;
    top: 0;
    padding-top: constant(safe-area-inset-top) !important;
    padding-top: env(safe-area-inset-top) !important;
    left: 50%;
    z-index: 2001;

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

    .progress {
      padding: 10px 36px;
      display: flex;
      justify-content: space-between;
      align-items: center;

      .progress-bar {
        flex: 1;
        padding: 0 10px;
      }

      .progress-tip {
        font-size: 14px;
        margin-left: 5px;
      }
    }

    .headset-item {
      line-height: 32px;
      width: 36px;
      height: 36px;
      border-radius: 100%;
      display: block;
      cursor: pointer;
      text-align: center;
      vertical-align: middle;
      pointer-events: all;
      position: absolute;
      top: -120px;
      left: 4px;
      right: auto;

      .el-icon-headset {
        line-height: 34px;
      }
    }

    .theme-item {
      line-height: 32px;
      width: 36px;
      height: 36px;
      border-radius: 100%;
      display: block;
      cursor: pointer;
      text-align: center;
      vertical-align: middle;
      pointer-events: all;
      position: absolute;
      top: -60px;
      left: 4px;
      right: auto;

      .el-icon-moon {
        color: #121212;
        line-height: 34px;
      }
      .el-icon-sunny {
        color: #666;
        line-height: 34px;
      }
    }

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

    .reader-bar-inner {
      display: flex;
      flex-direction: column;
      padding-bottom: calc(10px + constant(safe-area-inset-top));
      padding-bottom: calc(10px + env(safe-area-inset-top));
      padding-left: 5px;
      padding-right: 5px;

      .operate-bar {
        display: flex;
        flex-direction: row;
        justify-content: space-between;
        padding: 10px 10px 0 10px;
        align-items: center;

        .close-btn, .collapse-btn {
          font-size: 22px;
          height: 35px;
        }

        .center {
          span {
            display: inline-block;
            cursor: pointer;
          }
          .play-pause-btn {
            font-size: 50px;
            margin-top: -40px;
            i {
              border-radius: 100%;
            }
          }
          .ctrl-btn {
            margin: 0px 15px;
          }
        }
      }

      .setting-item {
        display: flex;
        flex-direction: column;
        padding: 5px 10px;

        .setting-title {
          font-size: 14px;
        }

        .setting-btn {
          font-size: 14px;
          cursor: pointer;
          display: inline-block;
          margin-left: 5px;
        }

        .voice-list {
          display: flex;
          flex-direction: row;
          overflow-x: auto;
          padding: 5px 10px;

          .radio-group {
            white-space: nowrap;

            .radio-button {
              margin-right: 10px;

              .el-radio-button__inner {
                border-radius: 4px 4px 4px 4px;
              }
            }
          }
        }

        .progress {
          padding: 5px 10px;

          .progress-tip {
            margin-left: 0;
            margin-right: 5px;
          }
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
    min-height: calc(var(--vh, 1vh) * 100);
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
        cursor: pointer;
        pointer-events: all;
      }
    }

    .content {
      font-size: 18px;
      line-height: 1.8;
      overflow: hidden;
      font-family: 'Microsoft YaHei', PingFangSC-Regular, HelveticaNeue-Light, 'Helvetica Neue Light', sans-serif;

      .content-inner {
        min-height: calc(var(--vh, 1vh) * 80);
      }
    }

    .bottom-bar, .top-bar {
      height: 44px;
      box-sizing: border-box;
      font-size: 12px;
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

  >>>.progress-tip {
    color: rgba(0, 0, 0, 0.4);
  }

  >>>.reader-bar-inner {
    color: #121212;

    .setting-title {
      color: rgba(0, 0, 0, 0.8);
    }

    .setting-value {
      color: rgba(0, 0, 0, 0.4);
    }
  }

  >>>.headset-item {
    color: #121212;
  }

  >>>.chapter {
    border: 1px solid #d8d8d8;
    color: #262626;
  }

  .bottom-bar, .top-bar {
    color: rgba(0, 0, 0, 0.4);
  }

  >>>.el-slider__runway {
    background-color: #fff;
  }

  >>>.play-pause-btn {
    color: #409EFF;
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

  >>>.progress-tip {
    color: #666;
  }

  >>>.reader-bar-inner {
    color: #666;
  }

  >>>.headset-item {
    color: #666;
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

  >>>.el-slider__runway {
    background-color: #282828;
  }
  >>>.el-slider__bar {
    background-color: #185798;
  }
  >>>.el-slider__button {
    border: 2px solid #185798;
    background-color: #282828;
  }
  >>>.play-pause-btn {
    color: #185798;
  }
}
@media screen and (max-width: 750px) {
  .chapter-wrapper {
    padding: 0;
    position: relative;
    height: 100%;

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

      .headset-item {
        left: auto;
        right: 20px;
      }

      .theme-item {
        left: auto;
        right: 20px;
      }

      .tools {
        flex-direction: row;
        justify-content: space-around;
        padding: 0 15px;
        height: 45px;
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
      position: relative;

      .top-bar {
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        z-index: 50;
        background: inherit;
        height: 30px;
        height: calc(30px + constant(safe-area-inset-top));
        height: calc(30px + env(safe-area-inset-top));
        padding: 6px 16px;
        padding-top: calc(6px + constant(safe-area-inset-top));
        padding-top: calc(6px + env(safe-area-inset-top));
      }

      .content-inner {
        margin-top: calc(30px + constant(safe-area-inset-top));
        margin-top: calc(30px + env(safe-area-inset-top));
        padding-top: 15px;
      }
    }

    .chapter.slide-reader {
      padding: 0;
      height: 100%;

      .bottom-bar {
        height: 24px;
        position: absolute;
        bottom: 0;
        padding: 0 16px;
        padding-bottom: 6px;
        display: flex;
        justify-content: space-between;
      }

      .top-bar {
        position: relative;
      }

      .content {
        position: absolute;
        overflow: visible;
        top: 30px;
        top: calc(30px + constant(safe-area-inset-top));
        top: calc(30px + env(safe-area-inset-top));
        bottom: 24px;
      }

      .content-inner {
        margin: 0 16px;
        overflow: hidden;
        text-align: justify;
        padding: 0;
        height: 100%;
      }

      .book-content {
        height: 100%;
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
<style lang="stylus">
.voice-list {
  .el-radio-button__inner {
    border-radius: 4px !important;
    border-left: 1px solid #DCDFE6;
    box-shadow: none;
  }
}
.night-theme {
  .voice-list {
    .el-radio-button__inner {
      background-color: #bbb;
      border-color: #bbb;
    }
    .el-radio-button__orig-radio:checked+.el-radio-button__inner {
      background-color: #185798;
      border-color: #185798;
      box-shadow: none;
    }
  }
}
</style>
