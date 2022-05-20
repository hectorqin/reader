<script>
export default {
  name: "Content",
  data() {
    return {
      currentTime: 0,
      audioDuration: 0,
      playing: false,
      currentSpeed: 1,
      startTime: 0,
      iframeStyle: {}
    };
  },
  props: [
    "content",
    "error",
    "title",
    "showContent",
    "isScrollRead",
    "showChapterList",
    "currentShowChapter"
  ],
  render() {
    if (this.showContent) {
      if (this.isAudio) {
        // 音频
        return this.renderAudio();
      } else if (this.isEpub) {
        // epub
        return this.renderEpub();
      }
      if (this.isScrollRead) {
        return this.renderScrollChapterList();
      }
      let wordCount = this.title.length + 2; // 2为两个换行符
      return (
        <div
          class="content-body chapter-content reading-chapter"
          style={this.containerStyle}
          v-lazy-container={{
            selector: "img"
          }}
        >
          <h3 data-pos={0}>{this.title}</h3>
          {this.content.split(/\n+/).map(a => {
            a = a.replace(/^\s+/g, "");
            if (!a) {
              return null;
            }
            const pos = wordCount;
            wordCount += a.length + 2; // 2为两个换行符
            if (a.indexOf("<img") >= 0) {
              // 漫画
              // 将 src 替换为 data-src 懒加载
              a = a.replace(/src=/g, "data-src=");
              return (
                <div
                  style={this.containerStyle}
                  domPropsInnerHTML={a}
                  data-pos={pos}
                ></div>
              );
            }
            // 文本内容
            return (
              <p style={this.pStyle} domPropsInnerHTML={a} data-pos={pos} />
            );
          })}
        </div>
      );
    } else {
      return <div />;
    }
  },
  mounted() {
    if (this.isAudio) {
      this.play(true);
    } else if (this.isEpub) {
      this.initIframe();
    }
    window.contentCom = this;
  },
  computed: {
    readingBook() {
      return this.$store.state.readingBook;
    },
    chapter() {
      return (
        this.$store.state.readingBook.catalog[
          this.$store.state.readingBook.index
        ] || {}
      );
    },
    show() {
      return this.$store.state.showContent;
    },
    fontSize() {
      return this.$store.getters.config.fontSize + "px";
    },
    autoPlay: {
      get() {
        return this.$store.state.autoPlay;
      },
      set(val) {
        this.$store.commit("setAutoPlay", val);
      }
    },
    isCarToon() {
      return (
        !this.error && !this.isEpub && (this.content || "").indexOf("<img") >= 0
      );
    },
    isAudio() {
      return !this.error && this.readingBook.type === 1;
    },
    isEpub() {
      return (
        !this.error && this.readingBook.bookUrl.toLowerCase().endsWith(".epub")
      );
    },
    containerStyle() {
      return {
        fontSize: this.$store.getters.config.fontSize + "px",
        fontWeight: this.$store.getters.config.fontWeight || undefined,
        color:
          this.$store.getters.config.fontColor ||
          (this.$store.getters.isNight ? "#666" : "#262626"),
        ...this.$store.getters.currentFontFamily,
        ...(this.$store.getters.config.contentCSS || {})
      };
    },
    pStyle() {
      return {
        lineHeight: this.$store.getters.config.lineHeight,
        marginTop:
          typeof this.$store.getters.config.paragraphSpace !== "undefined"
            ? this.$store.getters.config.paragraphSpace + "em"
            : null,
        marginBottom:
          typeof this.$store.getters.config.paragraphSpace !== "undefined"
            ? this.$store.getters.config.paragraphSpace + "em"
            : null
      };
    },
    windowSize() {
      return this.$store.state.windowSize;
    }
  },
  watch: {
    containerStyle() {
      if (this.isEpub) {
        this.setIframeStyle();
      }
    },
    pStyle() {
      if (this.isEpub) {
        this.setIframeStyle();
      }
    },
    windowSize() {
      if (this.isEpub) {
        //
      }
    }
  },
  methods: {
    renderScrollChapterList() {
      let wordCount = this.title.length + 2; // 2为两个换行符
      return (
        <div
          class="content-body"
          style={this.containerStyle}
          v-lazy-container={{
            selector: "img"
          }}
        >
          {this.showChapterList.map(chapter => {
            return (
              <div
                class={[
                  "chapter-content",
                  this.readingBook.index === chapter.index
                    ? "reading-chapter"
                    : ""
                ]}
                data-index={chapter.index}
              >
                <h3 data-pos={0}>{chapter.title}</h3>;
                {chapter.content.split(/\n+/).map(a => {
                  a = a.replace(/^\s+/g, "");
                  if (!a) {
                    return null;
                  }
                  const pos = wordCount;
                  wordCount += a.length + 2; // 2为两个换行符
                  if (a.indexOf("<img") >= 0) {
                    // 漫画
                    // 将 src 替换为 data-src 懒加载
                    a = a.replace(/src=/g, "data-src=");
                    return (
                      <div
                        style={this.containerStyle}
                        domPropsInnerHTML={a}
                        data-pos={pos}
                      ></div>
                    );
                  }
                  // 文本内容
                  return (
                    <p
                      style={this.pStyle}
                      domPropsInnerHTML={a}
                      data-pos={pos}
                    />
                  );
                })}
              </div>
            );
          })}
        </div>
      );
    },
    renderAudio() {
      return (
        <div class="content-audio">
          <audio
            ref="audio"
            preload="preload"
            src={this.content}
            vOn:loadMetaData={this.audioEvent}
            vOn:progress={this.onProgress}
            vOn:playing={this.onProgress}
            vOn:timeupdate={this.onTimeupdate}
            vOn:play={this.onPlay}
            vOn:pause={this.onPause}
            vOn:ended={this.onEnd}
            vOn:error={this.onError}
            vOn:seeked={this.onSeeked}
            vOn:seeking={this.onSeeking}
            vOn:stalled={this.audioEvent}
            vOn:suspend={this.onsuspend}
            vOn:loadeddata={this.audioEvent}
            vOn:loadedmetadata={this.audioEvent}
            vOn:canplay={this.onCanPlay}
            vOn:canplaythrough={this.audioEvent}
            vOn:waiting={this.onWaiting}
          ></audio>
          <div class="book-cover">
            <img v-lazy={this.getCover(this.readingBook.coverUrl)} />
          </div>
          <div class="book-progress">
            <div class="progress-tip">{this.formatTime(this.currentTime)}</div>
            <div class="progress-container">
              <el-slider
                vModel={this.currentTime}
                min={0}
                max={this.audioDuration}
                show-tooltip={false}
                vOn:change={val => {
                  this.seekTime(val);
                }}
              ></el-slider>
            </div>
            <div class="progress-tip total-time">
              {this.formatTime(this.audioDuration)}
            </div>
          </div>
          <div class="book-operation">
            <i
              class="reader-iconfont reader-icon-jian15s"
              vOn:click_stop_prevent={() => {
                this.seekTime(this.$refs.audio.currentTime - 15);
              }}
            ></i>
            <i
              class="reader-iconfont reader-icon-player-backward-step"
              vOn:click_stop_prevent={this.prevChapter}
            ></i>
            <i
              class={[
                "reader-iconfont",
                this.playing
                  ? "reader-icon-player-play"
                  : "reader-icon-player-pause"
              ]}
              vOn:click_stop_prevent={this.toggle}
            ></i>
            <i
              class="reader-iconfont reader-icon-player-forward-step"
              vOn:click_stop_prevent={this.nextChapter}
            ></i>
            <i
              class="reader-iconfont reader-icon-15s"
              vOn:click_stop_prevent={() => {
                this.seekTime(this.$refs.audio.currentTime + 15);
              }}
            ></i>
          </div>
          <div
            class="book-info"
            style={{
              background: this.getCover(this.readingBook.coverUrl, true)
            }}
          >
            <div class="book-cover">
              <img v-lazy={this.getCover(this.readingBook.coverUrl)} />
            </div>
            <div class="book-intro">
              <div class="title">{this.title}</div>
              <div class="subtitle">
                {this.readingBook.bookName}
                {this.readingBook.author ? "•" : ""}
                {this.readingBook.author}
              </div>
            </div>
          </div>
        </div>
      );
    },
    renderEpub() {
      return (
        <iframe
          class="epub-iframe"
          ref="iframe"
          style={this.iframeStyle}
          src={this.$store.getters.apiRoot + this.content}
        ></iframe>
      );
    },
    initIframe() {
      window.addEventListener("message", event => {
        if (
          this.$refs.iframe &&
          event.source === this.$refs.iframe.contentWindow
        ) {
          //
          let message;
          try {
            message = JSON.parse(event.data);
          } catch (error) {
            return;
          }
          if (message.event === "inited") {
            this.iframeStyle = {};
            // 设置iframe样式
            this.setIframeStyle();
            // 同步iframe高度
            this.syncIframeHeight();
          } else if (message.event === "load") {
            setTimeout(() => {
              this.$emit("iframeLoad");
              this.$emit("epubLocationChange", message.data);
            }, 100);
          } else if (message.event === "setHeight") {
            this.iframeStyle = {
              ...this.iframeStyle,
              height:
                Math.max(message.data, this.windowSize.height * 0.8) + "px"
            };
            this.$emit("contentChange");
          } else if (message.event === "click") {
            this.$emit("epubClick", message.data);
          } else if (message.event === "clickHash") {
            this.$emit("epubClickHash", message.data);
          } else if (message.event === "keydown") {
            this.$emit("epubKeydown", message.data);
          } else if (message.event === "previewImageList") {
            this.$store.commit("setPreviewImageIndex", message.data.imageIndex);
            this.$store.commit("setPreviewImgList", message.data.imageList);
          }
          // else if (message.event === "clickA") {
          //   this.$emit("locationChange", message.data);
          // }
        }
      });
    },
    syncIframeHeight() {
      this.sendToIframe("execute", {
        script:
          "reader_notify('setHeight', document.documentElement.scrollHeight || document.body.scrollHeight)"
      });
    },
    setIframeStyle() {
      let bodyStyle = "";
      for (const i in this.containerStyle) {
        if (Object.hasOwnProperty.call(this.containerStyle, i)) {
          bodyStyle +=
            i.replace(/([A-Z])/g, v => "-" + v.toLowerCase()) +
            ":" +
            this.containerStyle[i] +
            ";";
        }
      }
      let pStyle = "";
      for (const i in this.pStyle) {
        if (Object.hasOwnProperty.call(this.pStyle, i)) {
          pStyle +=
            i.replace(/([A-Z])/g, v => "-" + v.toLowerCase()) +
            ":" +
            this.pStyle[i] +
            ";";
        }
      }
      this.sendToIframe("setStyle", {
        style: `
        *::-webkit-scrollbar {
          display: none;
          width: 0 !important;
          height: 0 !important;
        }
        *:focus {
          outline: none !important;
        }
        html {
          min-height: 100%;
        }
        body {
          margin: 0 !important;
          ${bodyStyle}
        }
        body p {
          ${pStyle}
        }
        img {
          display: block;
          max-width: 100vw !important;
          height: auto !important;
        }`
      });
    },
    sendToIframe(event, data) {
      if (!this.$refs.iframe) {
        setTimeout(() => {
          this.sendToIframe(event, data);
        }, 10);
        return;
      }
      this.$refs.iframe &&
        this.$refs.iframe.contentWindow &&
        this.$refs.iframe.contentWindow.postMessage(
          JSON.stringify({
            event,
            ...data
          }),
          "*"
        );
    },
    formatTime(val) {
      if (!val) {
        return "00:00";
      }
      const pad = v => (v >= 10 ? "" + v : "0" + v);
      if (val < 60) {
        return "00:" + pad(val);
      } else if (val < 3600) {
        const m = Math.round(val / 60);
        const s = val % 60;
        return pad(m) + ":" + pad(s);
      } else {
        const h = Math.round(val / 3600);
        const m = Math.round(val / 3600 / 60);
        const s = val % 60;
        return pad(h) + ":" + pad(m) + ":" + pad(s);
      }
    },
    seekTime(val) {
      if (!isNaN(val) && val !== Infinity) {
        if (this.$refs.audio) {
          this.$refs.audio.currentTime = val;
        }
      }
    },
    ensureSeekTime(val) {
      this.startTime = val;
    },
    toggle() {
      if (this.playing) {
        this.$refs.audio && this.$refs.audio.pause();
      } else {
        this.play();
      }
    },
    play(init) {
      if (!this.$refs.audio) {
        setTimeout(() => {
          this.play(init);
        }, 10);
        return;
      }
      if (init) {
        this.$refs.audio.load();

        this.stateTimer && clearInterval(this.stateTimer);

        this.stateTimer = setInterval(() => {
          if (this.$refs.audio) {
            let duration = this.$refs.audio.duration;
            if (
              this.$refs.audio.readyState >= 1 &&
              !isNaN(duration) &&
              duration !== Infinity &&
              duration
            ) {
              clearInterval(this.stateTimer);
              this.stateTimer = null;
              this.audioDuration = parseInt(duration);
              this.$refs.audio.playbackRate = this.currentSpeed;
              this.$refs.audio.currentTime = this.startTime;
              // 有时会失败（看浏览器）
              if (this.autoPlay) {
                this.$refs.audio.play();
              }
            }
          }
        }, 100);
      }
      if (!init || this.autoPlay) {
        this.$refs.audio.play();
      }
    },
    prevChapter() {
      this.autoPlay = true;
      this.$emit("prevChapter");
    },
    nextChapter() {
      this.autoPlay = true;
      this.$emit("nextChapter");
    },
    onProgress() {
      // 记录缓存进度。触发事件包括缓存数据更新时的 progress 事件，以及各种播放动作会触发的 playing 事件
    },
    onTimeupdate() {
      if (this.$refs.audio) {
        this.currentTime = this.$refs.audio.currentTime | 0;
      }
      this.$emit("updateProgress");
    },
    onPlay() {
      this.playing = true;
      this.stateTimer && clearInterval(this.stateTimer);
    },
    onPause() {
      this.playing = false;
    },
    onEnd() {
      this.playing = false;
      this.currentTime = 0;
      this.audioDuration = 0;
      this.autoPlay = true;
      this.$emit("nextChapter");
      this.stateTimer && clearInterval(this.stateTimer);
    },
    onError(event) {
      // console.log(arguments);
      this.$message.error(event.toString());
      this.playing = false;
      this.stateTimer && clearInterval(this.stateTimer);
    },
    onSeeked() {},
    onSeeking() {},
    audioEvent() {
      // console.log("audioEvent", arguments);
    },
    onsuspend() {
      // console.log("onsuspend", arguments);
    },
    onCanPlay() {
      // console.log("onCanPlay", arguments);
    },
    onWaiting() {
      // console.log("onWaiting", arguments);
    }
  }
};
</script>

<style lang="stylus" scoped>
p {
  display: block;
  word-wrap: break-word;
  word-break: break-all;
  text-indent: 2em;
}
p.reading {
  color: red !important;
}
h3 {
  font-size: 28px;
  line-height: 1.2;
  margin: 1em 0;
  text-align: center;
}
h3.reading {
  color: red !important;
}
.content-audio {
  margin: 0 auto;
  width: 100%;

  .book-cover {

    img {
      max-width: 200px;
      margin: 0 auto;
      display: block;
    }
  }

  .book-progress {
    padding: 25px 15px;
    display: flex;
    flex-direction: row;
    align-items: center;

    .progress-tip {
      padding-top: 5px;
      padding-bottom: 5px;
      font-size: 14px;
      width: 45px;
    }

    .progress-container {
      flex: 1;
      margin-left: 10px;
      margin-right: 10px;
    }

    .total-time {
      text-align: right;
    }
  }

  .book-operation {
    padding: 0px 15px 25px;
    display: flex;
    flex-direction: row;
    justify-content: space-around;

    i {
      display: inline-block;
      cursor: pointer;
      font-size: 24px;
    }
  }

  .book-info {
    padding: 10px 15px;
    display: flex;
    flex-direction: row;
    align-items: center;

    .book-cover {
      width: 50px;

      img {
        width: 100%;
        max-height: 100%;
      }
    }

    .book-intro {
      flex: 1;
      padding-left: 15px;

      .title {
        font-size: 16px;
      }

      .subtitle {
        margin-top: 5px;
        font-size: 14px;
      }
    }
  }
}
.epub-iframe {
  border: none;
  width: 100%;
  min-height: calc(var(--vh, 1vh) * 50);
  // pointer-events: none;
}
</style>
<style lang="stylus">
.content-body {
  img {
    width: 100%;
    max-width: 100vw;
    display: block;
  }
}
.day {
  .content-audio {
    .book-operation {
      color: #222;
    }

    .book-intro {
      .title {
        color: #121212;
      }
      .subtitle {
        color: #666;
      }
    }
  }
}
.night {
  .content-audio {
    .book-operation {
      color: #888;
    }

    .book-intro {
      .title {
        color: #888;
      }
      .subtitle {
        color: #666;
      }
    }
  }
}
</style>
