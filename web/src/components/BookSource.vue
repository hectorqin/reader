<template>
  <div class="popup-wrapper" :style="popupTheme">
    <div class="title-zone">
      <div class="title">来源({{ bookSource.length }})</div>
      <div :class="{ 'title-btn': true, loading: loadingMore }">
        <el-select
          size="mini"
          v-model="bookSourceGroup"
          class="booksource-group-select"
          filterable
          placeholder="全部分组"
        >
          <el-option
            v-for="(item, index) in $store.getters.bookSourceGroupList"
            :key="'source-group-' + index"
            :label="item.name + ' (' + item.count + ')'"
            :value="item.value"
          >
          </el-option>
        </el-select>
        <span :class="{ loading: loading }" @click="refresh">
          <i class="el-icon-loading" v-if="loading"></i>
          {{ loading ? "刷新中..." : "刷新" }}
        </span>
        <span
          :class="{ loading: loadingMore }"
          @click="searchBookSourceByEventStream"
        >
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
      <div class="source-list">
        <div
          class="source-item"
          v-for="(searchBook, index) in bookSource"
          :class="{ selected: isSelected(searchBook) }"
          :key="index"
          @click="changeBookSource(searchBook)"
          ref="source"
        >
          <div class="source-title">
            <div class="source-name">
              {{ searchBook.originName }}
            </div>
            <div class="source-time">
              {{ searchBook.time ? "⏱ " + searchBook.time + "ms" : "" }}
            </div>
          </div>
          <div class="source-latest-chapter">
            {{ searchBook.latestChapterTitle || "无最新章节" }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import jump from "../plugins/jump";
import Axios from "../plugins/axios";
const buildURL = require("axios/lib/helpers/buildURL");

export default {
  name: "BookSource",
  data() {
    return {
      index: this.$store.state.readingBook.index,
      bookSource: [],
      bookSourceGroup: "",
      bookSourceGroupIndexMap: {},
      loading: false,
      loadingMore: false
    };
  },
  props: ["visible"],
  computed: {
    theme() {
      return this.$store.getters.config.theme;
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
    },
    readingBook() {
      return this.$store.state.readingBook || {};
    }
  },
  mounted() {},
  watch: {
    visible(isVisible) {
      if (isVisible) {
        this.getBookSource();
      }
    },
    readingBook(val, oldVal) {
      if (val.bookUrl !== oldVal.bookUrl) {
        this.bookSourceGroupIndexMap = {};
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
              this.bookSourceGroupIndexMap[""] = Math.max(
                this.bookSourceGroupIndexMap[""] ?? 0,
                this.bookSource.length
              );
              this.jumpToActive();
            } else {
              // this.loadMoreSource();
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
    async changeBookSource(searchBook) {
      const isInShelf = await this.$root.$children[0].isInShelf(
        this.$store.state.readingBook,
        "加入书架之后才能切换书源, 是否加入书架?"
      );
      if (!isInShelf) {
        return;
      }
      Axios.post(this.api + `/saveBookSource`, {
        bookUrl: this.$store.state.readingBook.bookUrl,
        newUrl: searchBook.bookUrl,
        bookSourceUrl: searchBook.origin
      }).then(
        res => {
          if (res.data.isSuccess) {
            this.$message.info("换源成功");
            var book = Object.assign({}, this.$store.state.readingBook);
            book.bookUrl = searchBook.bookUrl;
            book.type =
              typeof searchBook.type !== "undefined"
                ? searchBook.type
                : book.type;
            book.coverUrl =
              typeof searchBook.coverUrl !== "undefined"
                ? searchBook.coverUrl
                : book.coverUrl;
            this.$store.commit("setReadingBook", book);
            this.$emit("changeBookSource");

            // 重新加载书架
            Axios.get(this.api + `/getBookshelf`, {}).then(
              res => {
                if (res.data.isSuccess) {
                  this.$store.commit("setShelfBooks", res.data.data);
                }
              },
              () => {
                //
              }
            );
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
          bookSourceGroup: this.bookSourceGroup,
          lastIndex: this.bookSourceGroupIndexMap[this.bookSourceGroup]
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
              this.bookSourceGroupIndexMap[this.bookSourceGroup] =
                res.data.data.lastIndex;
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
    searchBookSourceByEventStream() {
      const tryClose = () => {
        try {
          if (
            this.searchEventSource &&
            this.searchEventSource.readyState != this.searchEventSource.CLOSED
          ) {
            this.searchEventSource.close();
          }
          this.searchEventSource = null;
        } catch (error) {
          //
        }
      };
      if (this.loadingMore) {
        tryClose();
        this.loadingMore = false;
        return;
      }
      const params = {
        accessToken: this.$store.state.token,
        concurrentCount: this.$store.state.searchConfig.concurrentCount,
        url: this.$store.state.readingBook.bookUrl,
        bookSourceGroup: this.bookSourceGroup,
        lastIndex: this.bookSourceGroupIndexMap[this.bookSourceGroup]
      };
      this.loadingMore = true;

      const url = buildURL(this.api + "/searchBookSourceSSE", params);

      tryClose();

      this.searchEventSource = new EventSource(url, {
        withCredentials: true
      });
      this.searchEventSource.addEventListener("error", e => {
        this.loadingMore = false;
        tryClose();
        try {
          if (e.data) {
            const result = JSON.parse(e.data);
            if (result && result.errorMsg) {
              this.$message.error(result.errorMsg);
            }
          }
        } catch (error) {
          //
        }
      });
      let oldBookSourceLength = this.bookSource.length;
      this.searchEventSource.addEventListener("end", e => {
        this.loadingMore = false;
        tryClose();
        try {
          if (e.data) {
            const result = JSON.parse(e.data);
            if (result && result.lastIndex) {
              this.bookSourceGroupIndexMap[this.bookSourceGroup] =
                result.lastIndex;
            }
          }
          if (this.bookSource.length === oldBookSourceLength) {
            this.$message.error("没有更多啦");
          }
        } catch (error) {
          //
        }
      });
      this.searchEventSource.addEventListener("message", e => {
        try {
          if (e.data) {
            const result = JSON.parse(e.data);
            if (result && result.lastIndex) {
              this.bookSourceGroupIndexMap[this.bookSourceGroup] =
                result.lastIndex;
            }
            if (result.data) {
              this.bookSource = [].concat(
                this.bookSource,
                result.data.filter(v => {
                  return !this.bookSourceMap[v.bookUrl];
                })
              );
            }
          }
        } catch (error) {
          //
        }
      });
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
  padding: 24px;
  padding-top: calc(24px + constant(safe-area-inset-top));
  padding-top: calc(24px + env(safe-area-inset-top));

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

    .booksource-group-select {
      width: 140px;
    }
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

    .source-list {
      .source-item {
        width: 100%;
        cursor: pointer;
        display: flex;
        flex-direction: column;
        max-width: 100%;
        overflow: hidden;
        padding: 8px 0;

        .source-title {
          display: flex;
          flex-direction: row;
          flex-wrap: wrap;
          justify-content: space-between;
          align-items: center;

          .source-name {
            font-size: 16px;
            overflow: hidden;
            white-space: nowrap;
            text-overflow: ellipsis;

          }
          .source-time {
            float: right;
            font-size: 12px;
          }
        }

        .source-latest-chapter {
          overflow: hidden;
          white-space: nowrap;
          text-overflow: ellipsis;
          color: #888;
          font-size: 14px;
          margin-top: 6px;
        }

        &.selected {
          .source-name {
            color: #EB4259;
          }
        }
      }
    }
  }

  .data-wrapper::-webkit-scrollbar {
    width: 0 !important;
  }

  .night {
    >>>.source-item {
      border-bottom: 1px solid #333;
    }
  }

  .day {
    >>>.source-item {
      border-bottom: 1px solid #eee;
    }
  }
}
</style>
