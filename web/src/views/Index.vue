<template>
  <div
    class="index-wrapper"
    :class="{
      night: isNight,
      day: !isNight
    }"
  >
    <div class="navigation-wrapper">
      <div class="navigation-title">
        阅读
      </div>
      <div class="navigation-sub-title">
        清风不识字，何故乱翻书
      </div>
      <div class="search-wrapper">
        <el-input
          size="mini"
          placeholder="搜索书籍"
          v-model="search"
          class="search-input"
          @keyup.enter.native="searchBook"
        >
          <i slot="prefix" class="el-input__icon el-icon-search"></i>
        </el-input>
      </div>
      <div class="recent-wrapper">
        <div class="recent-title">
          最近阅读
        </div>
        <div class="reading-recent">
          <el-tag
            type="warning"
            :effect="isNight ? 'dark' : 'light'"
            class="recent-book"
            @click="
              toDetail(
                readingRecent.url,
                readingRecent.name,
                readingRecent.chapterIndex
              )
            "
            :class="{ 'no-point': readingRecent.url == '' }"
          >
            {{ readingRecent.name }}
          </el-tag>
        </div>
      </div>
      <div class="setting-wrapper">
        <div class="setting-title">
          后端设定
        </div>
        <div class="setting-item">
          <el-tag
            :type="connectType"
            :effect="isNight ? 'dark' : 'light'"
            class="setting-connect"
            :class="{ 'no-point': newConnect }"
            @click="setIP"
          >
            {{ connectStatus }}
          </el-tag>
        </div>
      </div>
      <div class="setting-wrapper">
        <div class="setting-title">
          搜索书源
        </div>
        <div class="setting-item">
          <el-select
            size="mini"
            v-model="bookSourceUrl"
            class="setting-select"
            filterable
            placeholder="请选择搜索书源"
          >
            <el-option
              v-for="(item, index) in bookSourceList"
              :key="'source-' + index"
              :label="item.bookSourceName"
              :value="item.bookSourceUrl"
            >
            </el-option>
          </el-select>
        </div>
      </div>
      <div class="bottom-icons">
        <a href="https://github.com/hectorqin/reader" target="_blank">
          <div class="bottom-icon">
            <img
              v-if="isNight"
              :src="require('../assets/imgs/github.png')"
              alt=""
            />
            <img v-else :src="require('../assets/imgs/github2.png')" alt="" />
          </div>
        </a>
        <span
          class="theme-item"
          :style="themeColor"
          ref="themes"
          @click="toogleNight"
        >
          <i class="el-icon-moon" v-if="!isNight"></i>
          <i class="el-icon-sunny" v-else></i>
        </span>
      </div>
    </div>
    <div class="shelf-wrapper" ref="shelfWrapper">
      <div class="shelf-title">
        {{ isSearchResult ? "搜索结果" : "书架" }}
        <div class="title-btn" v-if="isSearchResult" @click="backToShelf">
          返回书架
        </div>
      </div>
      <div class="books-wrapper">
        <div class="wrapper">
          <div
            class="book"
            v-for="book in shelf"
            :key="book.bookUrl"
            @click="toDetail(book.bookUrl, book.name, book.durChapterIndex)"
          >
            <div class="cover-img">
              <img class="cover" :src="getCover(book.coverUrl)" alt="" />
            </div>
            <div
              class="info"
              @click="toDetail(book.bookUrl, book.name, book.durChapterIndex)"
            >
              <div class="name">{{ book.name }}</div>
              <div class="sub">
                <div class="author">
                  {{ book.author }}
                </div>
                <div class="dot" v-if="book.totalChapterNum">•</div>
                <div class="size" v-if="book.totalChapterNum">
                  共{{ book.totalChapterNum }}章
                </div>
                <div class="dot" v-if="!isSearchResult">•</div>
                <div class="date" v-if="!isSearchResult">
                  {{ dateFormat(book.lastCheckTime) }}
                </div>
              </div>
              <div class="dur-chapter" v-if="!isSearchResult">
                已读：{{ book.durChapterTitle }}
              </div>
              <div class="last-chapter">
                最新：{{ book.latestChapterTitle }}
              </div>
              <div v-if="isSearchResult">
                <el-tag
                  type="success"
                  :effect="isNight ? 'dark' : 'light'"
                  class="setting-connect"
                  @click.prevent.capture="saveBook(book)"
                >
                  加入书架
                </el-tag>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import "../assets/fonts/shelffont.css";
import Axios from "axios";

export default {
  data() {
    return {
      search: "",
      bookSourceUrl: "",
      bookSourceList: [],
      isSearchResult: false,
      searchResult: [],
      readingRecent: {
        name: "尚无阅读记录",
        url: "",
        chapterIndex: 0
      }
    };
  },
  watch: {
    bookSourceUrl(val) {
      localStorage.setItem("bookSourceUrl", val);
      if (this.isSearchResult && val) {
        this.searchBook();
      }
    }
  },
  mounted() {
    try {
      //获取最近阅读书籍
      let readingRecentStr = localStorage.getItem("readingRecent");
      if (readingRecentStr != null) {
        this.readingRecent = JSON.parse(readingRecentStr);
        if (typeof this.readingRecent.chapterIndex == "undefined") {
          this.readingRecent.chapterIndex = 0;
        }
      }
      this.bookSourceUrl = localStorage.getItem("bookSourceUrl") || "";
    } catch (error) {
      //
    }
    this.loadBookshelf()
      .then(() => {
        if (!this.bookSourceList.length) {
          // 加载书源列表
          this.loadBookSource();
        }
      })
      .catch(() => {});
  },
  methods: {
    setIP() {
      this.$prompt("请输入接口地址 ( 如：127.0.0.1:9527 )", "提示", {
        confirmButtonText: "确定",
        cancelButtonText: "取消",
        // inputPattern: /^((2[0-4]\d|25[0-5]|[1]?\d\d?)\.){3}(2[0-4]\d|25[0-5]|[1]?\d\d?):([1-9]|[1-9][0-9]|[1-9][0-9][0-9]|[1-9][0-9][0-9][0-9]|[1-6][0-5][0-5][0-3][0-5])$/,
        // inputErrorMessage: "url 形式不正确",
        beforeClose: (action, instance, done) => {
          if (action === "confirm") {
            this.$store.commit("setNewConnect", true);
            instance.confirmButtonLoading = true;
            instance.confirmButtonText = "校验中……";
            this.loadBookshelf(instance.inputValue)
              .then(() => {
                instance.confirmButtonLoading = false;
                done();
              })
              .catch(() => {
                instance.confirmButtonLoading = false;
                instance.confirmButtonText = "确定";
              });
          } else {
            done();
          }
        }
      })
        .then(({ value }) => {
          localStorage.url = value;
          this.$message({
            type: "success",
            message: "与" + value + "连接成功"
          });
        })
        .catch(() => {});
    },
    loadBookSource() {
      if (!localStorage.url) {
        this.$message.error("请先设置后端 url 与端口");
        this.$store.commit("setConnectStatus", "点击设置后端 url 与 端口");
        this.$store.commit("setNewConnect", false);
        this.$store.commit("setConnectType", "danger");
        return;
      }
      Axios.get("http://" + localStorage.url + "/getSources", {
        timeout: 3000
      }).then(
        res => {
          this.loading.close();
          if (res.data.isSuccess) {
            //
            this.bookSourceList = res.data.data;
            if (this.bookSourceList.length) {
              this.bookSourceUrl =
                this.bookSourceUrl || this.bookSourceList[0].bookSourceUrl;
            }
          } else {
            this.$message.error(res.data.errorMsg);
          }
        },
        () => {
          //
          this.loading.close();
          this.$message.error("后端连接失败");
        }
      );
    },
    searchBook() {
      if (!localStorage.url) {
        this.$message.error("请先设置后端 url 与端口");
        this.$store.commit("setConnectStatus", "点击设置后端 url 与 端口");
        this.$store.commit("setNewConnect", false);
        this.$store.commit("setConnectType", "danger");
        return;
      }
      if (!this.search) {
        this.$message.error("请输入关键词进行搜索");
        return;
      }
      this.loading = this.$loading({
        target: this.$refs.shelfWrapper,
        lock: true,
        text: "正在搜索书籍",
        spinner: "el-icon-loading",
        background: this.isNight ? "#121212" : "rgb(247,247,247)"
      });

      Axios.get("http://" + localStorage.url + "/searchBook", {
        timeout: 3000,
        params: {
          key: this.search,
          bookSourceUrl: this.bookSourceUrl
        }
      }).then(
        res => {
          this.loading.close();
          if (res.data.isSuccess) {
            //
            this.isSearchResult = true;
            this.searchResult = res.data.data;
          } else {
            this.$message.error(res.data.errorMsg);
          }
        },
        () => {
          //
          this.loading.close();
          this.$message.error("后端连接失败");
        }
      );
    },
    loadBookshelf(api) {
      api = api || localStorage.url;
      if (!api) {
        this.$message.error("请先设置后端 url 与端口");
        this.$store.commit("setConnectStatus", "点击设置后端 url 与 端口");
        this.$store.commit("setNewConnect", false);
        this.$store.commit("setConnectType", "danger");
        return Promise.reject(false);
      }

      this.loading = this.$loading({
        target: this.$refs.shelfWrapper,
        lock: true,
        text: "正在获取书籍信息",
        spinner: "el-icon-loading",
        background: this.isNight ? "#121212" : "rgb(247,247,247)"
      });

      return Axios.get("http://" + api + "/getBookshelf", {
        timeout: 3000
      })
        .then(response => {
          if (response.data.isSuccess) {
            this.loading.close();
            this.$store.commit("setConnectType", "success");
            // this.$store.commit("increaseBookNum", response.data.data.length);
            this.$store.commit(
              "addBooks",
              response.data.data.sort(function(a, b) {
                var x = a["durChapterTime"] || 0;
                var y = b["durChapterTime"] || 0;
                return y - x;
              })
            );
            this.$store.commit(
              "setConnectStatus",
              "已连接 " + localStorage.url
            );
            this.$store.commit("setNewConnect", false);
          } else {
            this.$message.error(response.data.errorMsg);
          }
        })
        .catch(error => {
          this.loading.close();
          this.$store.commit("setConnectType", "danger");
          this.$store.commit("setConnectStatus", "点击设置后端 url 与 端口");
          this.$message.error("后端连接失败");
          this.$store.commit("setNewConnect", false);
          throw error;
        });
    },
    toDetail(bookUrl, bookName, chapterIndex) {
      if (this.isSearchResult) {
        // this.$message.error("请先加入书架");
        // return;
      }
      chapterIndex = chapterIndex || 0;
      sessionStorage.setItem("bookUrl", bookUrl);
      sessionStorage.setItem("bookName", bookName);
      sessionStorage.setItem("chapterIndex", chapterIndex);
      this.readingRecent = {
        name: bookName,
        url: bookUrl,
        chapterIndex: chapterIndex
      };
      localStorage.setItem("readingRecent", JSON.stringify(this.readingRecent));
      this.$router.push({
        path: "/chapter"
      });
    },
    saveBook(book) {
      if (!localStorage.url) {
        this.$message.error("请先设置后端 url 与端口");
        this.$store.commit("setConnectStatus", "点击设置后端 url 与 端口");
        this.$store.commit("setNewConnect", false);
        this.$store.commit("setConnectType", "danger");
        return;
      }
      if (!book || !book.bookUrl || !book.origin) {
        this.$message.error("书籍信息错误");
        return;
      }
      Axios.post("http://" + localStorage.url + "/saveBook", book).then(
        res => {
          if (res.data.isSuccess) {
            //
            this.$message.success("加入书架成功");
          } else {
            this.$message.error(res.data.errorMsg);
          }
        },
        () => {
          //
          this.$message.error("后端连接失败");
        }
      );
    },
    dateFormat(t) {
      let time = new Date().getTime();
      let int = parseInt((time - t) / 1000);
      let str = "";

      Date.prototype.format = function(fmt) {
        var o = {
          "M+": this.getMonth() + 1, //月份
          "d+": this.getDate(), //日
          "h+": this.getHours(), //小时
          "m+": this.getMinutes(), //分
          "s+": this.getSeconds(), //秒
          "q+": Math.floor((this.getMonth() + 3) / 3), //季度
          S: this.getMilliseconds() //毫秒
        };
        if (/(y+)/.test(fmt)) {
          fmt = fmt.replace(
            RegExp.$1,
            (this.getFullYear() + "").substr(4 - RegExp.$1.length)
          );
        }
        for (var k in o) {
          if (new RegExp("(" + k + ")").test(fmt)) {
            fmt = fmt.replace(
              RegExp.$1,
              RegExp.$1.length == 1
                ? o[k]
                : ("00" + o[k]).substr(("" + o[k]).length)
            );
          }
        }
        return fmt;
      };

      if (int <= 30) {
        str = "刚刚";
      } else if (int < 60) {
        str = int + "秒前";
      } else if (int < 3600) {
        str = parseInt(int / 60) + "分钟前";
      } else if (int < 86400) {
        str = parseInt(int / 3600) + "小时前";
      } else if (int < 2592000) {
        str = parseInt(int / 86400) + "天前";
      } else {
        str = new Date(t).format("yyyy-MM-dd hh:mm");
      }
      return str;
    },
    getCover(coverUrl) {
      if (coverUrl) {
        return "http://" + localStorage.url + "/cover?path=" + coverUrl;
      }
      return null;
    },
    backToShelf() {
      this.isSearchResult = false;
      this.searchResult = [];
    },
    toogleNight() {
      let config = this.config;
      if (this.isNight) {
        config.theme = 0;
      } else {
        config.theme = 6;
      }
      this.$store.commit("setConfig", config);
      localStorage.setItem("config", JSON.stringify(config));
    }
  },
  computed: {
    config() {
      return this.$store.state.config;
    },
    isNight() {
      return this.$store.state.config.theme == 6;
    },
    themeColor() {
      if (this.$store.state.config.theme == 6) {
        return {
          background: "#f7f7f7"
        };
      } else {
        return {
          background: "#222"
        };
      }
    },
    shelf() {
      return this.isSearchResult ? this.searchResult : this.$store.state.shelf;
    },
    connectStatus() {
      return this.$store.state.connectStatus;
    },
    connectType() {
      return this.$store.state.connectType;
    },
    newConnect() {
      return this.$store.state.newConnect;
    }
  }
};
</script>

<style lang="stylus" scoped>
.index-wrapper {
  height: 100%;
  width: 100%;
  display: flex;
  flex-direction: row;

  .navigation-wrapper {
    width: 260px;
    min-width: 260px;
    padding: 48px 36px;
    background-color: #F7F7F7;

    .navigation-title {
      font-size: 24px;
      font-weight: 500;
      font-family: FZZCYSK;
    }

    .navigation-sub-title {
      font-size: 16px;
      font-weight: 300;
      font-family: FZZCYSK;
      margin-top: 16px;
      color: #b1b1b1;
    }

    .search-wrapper {
      .search-input {
        border-radius: 50%;
        margin-top: 24px;

        >>> .el-input__inner {
          border-radius: 50px;
          border-color: #E3E3E3;
        }
      }
    }

    .recent-wrapper {
      margin-top: 36px;

      .recent-title {
        font-size: 14px;
        color: #b1b1b1;
        font-family: FZZCYSK;
      }

      .reading-recent {
        margin: 18px 0;

        .recent-book {
          font-size: 10px;
          // font-weight: 400;
          // margin: 12px 0;
          // font-weight: 500;
          // color: #6B7C87;
          cursor: pointer;
          // padding: 6px 18px;
        }
      }
    }

    .setting-wrapper {
      margin-top: 36px;

      .setting-title {
        font-size: 14px;
        color: #b1b1b1;
        font-family: FZZCYSK;
      }

      .no-point {
        pointer-events: none;
      }

      .setting-connect {
        font-size: 8px;
        // color: #6B7C87;
        cursor: pointer;
      }

      .setting-item {
        padding-top: 16px;
      }

      .setting-select {
        width: 100%;
      }
    }

    .bottom-icons {
      position: fixed;
      bottom: 0;
      height: 120px;
      width: 260px;
      align-items: center;
      display: flex;
      flex-direction: row;

      .bottom-icon {
        height: 36px;
        img {
          width: 36px;
          height: 36px;
        }
      }

      .theme-item {
        line-height: 32px;
        width: 36px;
        height: 36px;
        margin-right: 16px;
        border-radius: 100%;
        display: inline-block;
        cursor: pointer;
        text-align: center;
        vertical-align: middle;
        margin-left: 150px;

        .el-icon-moon {
          color: #f7f7f7;
          line-height: 34px;
        }
        .el-icon-sunny {
          color: #121212;
          line-height: 34px;
        }
      }
    }
  }

  .shelf-wrapper {
    padding: 48px 48px;
    width: 100%;
    background-color: #fff;

    .shelf-title {
      font-size: 20px;
      font-weight: 500;
      font-family: FZZCYSK;
      margin-bottom: 15px;

      .title-btn {
        font-size: 14px;
        line-height: 28px;
        float: right;
        cursor: pointer;
        user-select: none;
      }
    }

    >>>.el-icon-loading {
      font-size: 36px;
      color: #B5B5B5;
    }

    >>>.el-loading-text {
      font-weight: 500;
      color: #B5B5B5;
    }

    .books-wrapper {
      height: 100%;
      overflow: scroll;

      .wrapper {
        display: grid ;
        grid-template-columns: repeat(auto-fill, 380px);
        justify-content: space-around;
        grid-gap: 10px;

        .book {
          user-select: none;
          display: flex;
          cursor: pointer;
          margin-bottom: 18px;
          padding: 24px 24px;
          width: 360px;
          flex-direction: row;
          justify-content: space-around;

          .cover-img {
            width: 84px;
            height: 112px;

            .cover {
              width: 84px;
              height: 112px;
            }
          }

          .info {
            display: flex;
            flex-direction: column;
            justify-content: space-around;
            align-items: left;
            height: 112px;
            margin-left: 20px;
            flex: 1;

            .name {
              width: fit-content;
              font-size: 16px;
              font-weight: 700;
              color: #33373D;
            }

            .sub {
              display: flex;
              flex-direction: row;
              font-size: 12px;
              font-weight: 600;
              color: #6b6b6b;

              .dot {
                margin: 0 7px;
              }
            }

            .intro, .dur-chapter, .last-chapter {
              color: #969ba3;
              font-size: 13px;
              margin-top: 3px;
              font-weight: 500;
              word-wrap: break-word;
              overflow: hidden;
              text-overflow: ellipsis;
              display: -webkit-box;
              -webkit-box-orient: vertical;
              -webkit-line-clamp: 1;
              text-align: left;
            }
          }
        }

        .book:hover {
          background: rgba(0, 0, 0, 0.1);
          transition-duration: 0.5s;
        }
      }

      .wrapper:last-child {
        margin-right: auto;
      }
    }

    .books-wrapper::-webkit-scrollbar {
      width: 0 !important;
    }
  }
}

.night {
  >>>.navigation-wrapper {
    background-color: #121212;
    border-right: 1px solid #555;
  }
  >>>.navigation-title {
    color: #bbb;
  }
  >>>.shelf-title {
    color: #bbb;
  }
  >>>.shelf-wrapper {
    background-color: #222;
  }
  >>>.el-input__inner {
    background-color: #444;
    border: 1px solid #444 !important;
    color: #aaa;
  }
  .book .info .name {
    color: #bbb !important;
  }
}
</style>
