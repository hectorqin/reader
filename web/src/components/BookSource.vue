<template>
  <div class="cata-wrapper" :style="popupTheme">
    <div class="title-zone">
      <div class="title">来源</div>
      <div
        :class="{ 'title-btn': true, loading: loadingMore }"
        @click="loadMoreSource"
      >
        <i class="el-icon-loading" v-if="loadingMore"></i>
        {{ loadingMore ? "加载中..." : "加载更多" }}
      </div>
    </div>
    <div
      class="data-wrapper"
      ref="sourceList"
      :class="{ night: isNight, day: !isNight }"
    >
      <div class="cata">
        <div
          class="log"
          v-for="(searchBook, index) in bookSource"
          :class="{ selected: isSelected(searchBook) }"
          :key="index"
          @click="changeBookSource(searchBook)"
          ref="source"
        >
          <div class="log-text">
            {{ searchBook.latestChapterTitle }}
          </div>
          <div class="extra-text">
            {{ searchBook.originName }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import jump from "../plugins/jump";
import config from "../plugins/config";
import Axios from "axios";
import "../assets/fonts/popfont.css";
export default {
  name: "BookSource",
  data() {
    return {
      isNight: this.$store.state.config.theme == 6,
      index: this.$store.state.readingBook.index,
      bookSource: [],
      loadingMore: false,
      lastIndex: 0
    };
  },
  props: ["popBookSourceVisible"],
  computed: {
    theme() {
      return this.$store.state.config.theme;
    },
    popupTheme() {
      return {
        background: config.themes[this.theme].popup
      };
    },
    bookSourceMap() {
      return this.bookSource.reduce((c, v) => {
        c[v.bookUrl] = v;
        return c;
      }, {});
    }
  },
  mounted() {},
  watch: {
    theme(theme) {
      if (theme == 6) {
        this.isNight = true;
      } else {
        this.isNight = false;
      }
    },
    popBookSourceVisible(isVisible) {
      if (isVisible) {
        this.getBookSource();
      }
    }
  },
  methods: {
    isSelected(searchBook) {
      return searchBook.bookUrl == this.$store.state.readingBook.bookUrl;
    },
    getBookSource() {
      Axios.get("http://" + localStorage.url + `/getBookSource`, {
        params: {
          url: this.$store.state.readingBook.bookUrl
        }
      }).then(
        res => {
          if (res.data.isSuccess) {
            this.bookSource = res.data.data || [];
            if (this.bookSource.length) {
              this.lastIndex = Math.max(this.lastIndex, this.bookSource.length);
              this.jumpToActive();
            } else {
              this.loadMoreSource();
            }
          } else {
            this.$message.error(res.data.errorMsg);
          }
        },
        err => {
          this.loading.close();
          this.$message.error("加载书籍来源失败");
          throw err;
        }
      );
    },
    changeBookSource(searchBook) {
      Axios.get("http://" + localStorage.url + `/saveBookSource`, {
        params: {
          name: this.$store.state.readingBook.bookName,
          newUrl: searchBook.bookUrl,
          bookSourceUrl: searchBook.origin
        }
      }).then(
        res => {
          if (res.data.isSuccess) {
            this.$message.info("换源成功");
            var book = Object.assign({}, this.$store.state.readingBook);
            book.bookUrl = searchBook.bookUrl;
            this.$store.commit("setReadingBook", book);
            sessionStorage.setItem("bookUrl", book.bookUrl);
            localStorage.setItem(book.bookUrl, JSON.stringify(book));
            this.$emit("close");
            this.$emit("loadCatalog");
          } else {
            this.$message.error(res.data.errorMsg);
          }
        },
        err => {
          this.loading.close();
          this.$message.error("修改书籍来源失败");
          throw err;
        }
      );
    },
    loadMoreSource() {
      if (this.loadingMore) return;
      this.loadingMore = true;
      Axios.get("http://" + localStorage.url + `/searchBookSource`, {
        params: {
          name: this.$store.state.readingBook.bookName,
          lastIndex: this.lastIndex
        }
      }).then(
        res => {
          this.loadingMore = false;
          if (res.data.isSuccess) {
            var list = res.data.data.list || [];
            this.bookSource = [].concat(
              this.bookSource,
              list.filter(v => {
                return !this.bookSourceMap[v.bookUrl];
              })
            );
            if (res.data.data.lastIndex) {
              this.lastIndex = res.data.data.lastIndex;
            }
          } else {
            this.$message.error(res.data.errorMsg);
          }
        },
        err => {
          this.loadingMore = false;
          this.loading.close();
          this.$message.error("加载书籍来源失败");
          throw err;
        }
      );
    },
    jumpToActive() {
      this.$nextTick(() => {
        let index = -1;
        this.bookSource.some((v, i) => {
          if (v.bookUrl == this.$store.state.readingBook.bookUrl) {
            index = i;
            return true;
          }
        });
        if (index < 0) {
          return;
        }
        let wrapper = this.$refs.sourceList;
        jump(this.$refs.source[index], {
          container: wrapper,
          duration: 0
        });
      });
    }
  }
};
</script>

<style lang="stylus" scoped>
.cata-wrapper {
  margin: -16px;
  padding: 18px 25px 24px 25px;

  // background: #ede7da url('../assets/imgs/themes/popup_1.png') repeat;
  .title-zone {
    margin: 0 0 20px 0;
    width: 100%;
    display: flex;
    flex-direction: row;
    flex-wrap: wrap;
    justify-content: space-between;
  }

  .title {
    font-size: 18px;
    font-weight: 400;
    font-family: FZZCYSK;
    color: #ed4259;
    border-bottom: 1px solid #ed4259;
    width: fit-content;
  }

  .title-btn {
    font-size: 14px;
    line-height: 26px;
    color: #ed4259;
    cursor: pointer;
    &.loading {
      color: #606266;
    }
  }

  .data-wrapper {
    height: 300px;
    overflow: auto;

    .cata {
      display: flex;
      flex-direction: row;
      flex-wrap: wrap;
      justify-content: space-between;

      .selected {
        color: #EB4259;
      }

      .log {
        width: 100%;
        height: 40px;
        cursor: pointer;
        float: left;
        display: flex;
        flex-direction: row;
        flex-wrap: wrap;
        justify-content: space-between;
        font: 16px / 40px PingFangSC-Regular, HelveticaNeue-Light, 'Helvetica Neue Light', 'Microsoft YaHei', sans-serif;

        .log-text {
          margin-right: 26px;
          overflow: hidden;
          white-space: nowrap;
          text-overflow: ellipsis;
        }

        .extra-text {
          overflow: hidden;
          white-space: nowrap;
          text-overflow: ellipsis;
        }
      }
    }
  }

  .night {
    >>>.log {
      border-bottom: 1px solid #666;
    }
  }

  .day {
    >>>.log {
      border-bottom: 1px solid #f2f2f2;
    }
  }
}
</style>
