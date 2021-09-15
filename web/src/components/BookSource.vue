<template>
  <div class="popup-wrapper" :style="popupTheme">
    <div class="title-zone">
      <div class="title">来源({{ bookSource.length }})</div>
      <div :class="{ 'title-btn': true, loading: loadingMore }">
        <span :class="{ loading: loading }" @click="refresh">
          <i class="el-icon-loading" v-if="loading"></i>
          {{ loading ? "刷新中..." : "刷新" }}
        </span>
        <span :class="{ loading: loadingMore }" @click="loadMoreSource">
          <i class="el-icon-loading" v-if="loadingMore"></i>
          {{ loadingMore ? "加载中..." : "加载更多" }}
        </span>
      </div>
    </div>
    <div
      class="data-wrapper"
      ref="sourceList"
      :class="{ night: $store.getters.isNight, day: !$store.getters.isNight }"
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
import Axios from "../plugins/axios";
export default {
  name: "BookSource",
  data() {
    return {
      index: this.$store.state.readingBook.index,
      bookSource: [],
      loading: false,
      loadingMore: false,
      lastIndex: 0
    };
  },
  props: ["visible"],
  computed: {
    theme() {
      return this.$store.state.config.theme;
    },
    popupTheme() {
      return {
        background: this.$store.getters.currentThemeConfig.popup
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
    visible(isVisible) {
      if (isVisible) {
        this.getBookSource();
      }
    }
  },
  methods: {
    isSelected(searchBook) {
      return searchBook.bookUrl == this.$store.state.readingBook.bookUrl;
    },
    getBookSource(refresh) {
      Axios.get(this.api + `/getBookSource`, {
        params: {
          url: this.$store.state.readingBook.bookUrl,
          refresh: refresh ? 1 : 0
        }
      }).then(
        res => {
          this.loading = false;
          if (res.data.isSuccess) {
            this.bookSource = res.data.data || [];
            if (this.bookSource.length) {
              this.lastIndex = Math.max(this.lastIndex, this.bookSource.length);
              this.jumpToActive();
            } else {
              this.loadMoreSource();
            }
          }
        },
        error => {
          this.loading = false;
          this.$message.error(
            "获取书籍来源信息失败 " + (error && error.toString())
          );
          throw error;
        }
      );
    },
    changeBookSource(searchBook) {
      Axios.get(this.api + `/saveBookSource`, {
        params: {
          bookUrl: this.$store.state.readingBook.bookUrl,
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
            this.$emit("close");
            this.$emit("loadCatalog");
          }
        },
        error => {
          this.$message.error("换源失败 " + (error && error.toString()));
          throw error;
        }
      );
    },
    refresh() {
      if (this.loadingMore) return;
      this.loading = true;
      this.getBookSource(true);
    },
    loadMoreSource() {
      if (this.loadingMore) return;
      this.loadingMore = true;
      Axios.get(this.api + `/searchBookSource`, {
        params: {
          url: this.$store.state.readingBook.bookUrl,
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
          }
        },
        error => {
          this.loadingMore = false;
          this.$message.error(
            "加载更多书籍来源失败 " + (error && error.toString())
          );
          throw error;
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
.popup-wrapper {
  margin: -16px;
  margin-bottom: -13px;
  padding: 18px 25px 24px 25px;

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
    font-family: -apple-system, "Noto Sans", "Helvetica Neue", Helvetica, "Nimbus Sans L", Arial, "Liberation Sans", "PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC", "Source Han Sans SC", "Source Han Sans CN", "Microsoft YaHei", "Wenquanyi Micro Hei", "WenQuanYi Zen Hei", "ST Heiti", SimHei, "WenQuanYi Zen Hei Sharp", sans-serif;
    color: #ed4259;
    border-bottom: 1px solid #ed4259;
    width: fit-content;
  }

  .title-btn {
    font-size: 14px;
    line-height: 26px;
    color: #ed4259;
    cursor: pointer;
    .source-count {
      display: inline-block;
      color: #606266;
    }
    span {
      margin-left: 15px;
    }
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
        max-width: 100%;
        overflow: hidden;

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

  .data-wrapper::-webkit-scrollbar {
    width: 0 !important;
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
