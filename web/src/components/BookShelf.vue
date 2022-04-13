<template>
  <div class="popup-wrapper" :style="popupTheme">
    <div class="title-zone">
      <div class="title">书架({{ shelfBooks.length }})</div>
      <div :class="{ 'title-btn': true, loading: refreshLoading }">
        <!-- <span class="home-btn" @click="backToHome">回首页</span> -->
        <span :class="{ loading: refreshLoading }" @click="refreshShelf">
          <i class="el-icon-loading" v-if="refreshLoading"></i>
          {{ refreshLoading ? "刷新中..." : "刷新" }}
        </span>
      </div>
    </div>
    <div
      class="data-wrapper"
      ref="bookList"
      :class="{ night: $store.getters.isNight, day: !$store.getters.isNight }"
    >
      <div class="shelfbook-list">
        <div
          class="book-item"
          v-for="book in shelfBooks"
          :class="{ selected: isSelected(book) }"
          :key="book.bookUrl"
          @click="changeBook(book)"
          ref="book"
        >
          <div class="book-title">
            <div class="book-name">
              {{ book.name }}
            </div>
            <div
              class="book-progress"
              v-if="book.totalChapterNum - 1 - book.durChapterIndex"
            >
              {{ book.totalChapterNum - 1 - book.durChapterIndex }}
            </div>
          </div>
          <div class="chapter-text">
            {{ book.durChapterTitle }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import jump from "../plugins/jump";
import Axios from "../plugins/axios";
import { networkFirstRequest } from "../plugins/helper";
export default {
  name: "BookShelf",
  data() {
    return {
      refreshLoading: false
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
    shelfBooks() {
      return this.$store.getters.shelfBooks;
    }
  },
  mounted() {},
  watch: {
    visible(isVisible) {
      if (isVisible) {
        this.getBookshelf();
      }
    }
  },
  methods: {
    isSelected(book) {
      return book.bookUrl == this.$store.state.readingBook.bookUrl;
    },
    getBookshelf(refresh) {
      if (this.shelfBooks.length) {
        return;
      }
      networkFirstRequest(
        () =>
          Axios.get(this.api + `/getBookshelf`, {
            params: {
              refresh: refresh ? 1 : 0
            }
          }),
        "getBookshelf" +
          ((this.$store.state.userInfo || {}).username || "default")
      ).then(
        res => {
          this.refreshLoading = false;
          if (res.data.isSuccess) {
            this.$store.commit("setShelfBooks", res.data.data);
            if (this.shelfBooks.length) {
              this.jumpToActive();
            }
          }
        },
        error => {
          this.refreshLoading = false;
          this.$message.error(
            "获取书架书籍失败 " + (error && error.toString())
          );
          throw error;
        }
      );
    },
    changeBook(book) {
      const readingBook = {
        bookName: book.name,
        bookUrl: book.bookUrl,
        index: book.durChapterIndex,
        type: book.type,
        coverUrl: book.coverUrl,
        author: book.author
      };
      this.$emit("changeBook", readingBook);
    },
    refreshShelf() {
      if (this.refreshLoading) return;
      this.refreshLoading = true;
      this.getBookshelf(true);
    },
    jumpToActive() {
      this.$nextTick(() => {
        let index = -1;
        this.shelfBooks.some((v, i) => {
          if (v.bookUrl == this.$store.state.readingBook.bookUrl) {
            index = i;
            return true;
          }
        });
        if (index < 0) {
          return;
        }
        if (!this.$refs.book || !this.$refs.book[index]) {
          setTimeout(() => {
            this.jumpToActive();
          }, 10);
          return;
        }
        let wrapper = this.$refs.bookList;
        jump(this.$refs.book[index], {
          container: wrapper,
          duration: 0
        });
      });
    },
    backToHome() {
      this.$emit("toShelf");
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
    .home-btn {
      display: inline-block;
      margin-right: 25px;
    }
    &.loading {
      color: #606266;
    }
  }

  .data-wrapper {
    height: 300px;
    overflow: auto;

    .shelfbook-list {

      .book-item {
        width: 100%;
        cursor: pointer;
        display: flex;
        flex-direction: column;
        max-width: 100%;
        overflow: hidden;
        padding: 8px 0;

        .book-title {
          display: flex;
          flex-direction: row;
          flex-wrap: wrap;
          justify-content: space-between;
          align-items: center;

          .book-name {
            font-size: 16px;
            overflow: hidden;
            white-space: nowrap;
            text-overflow: ellipsis;
          }
          .book-progress {
            float: right;
            font-size: 12px;
          }
        }

        .chapter-text {
          overflow: hidden;
          white-space: nowrap;
          text-overflow: ellipsis;
          color: #888;
          font-size: 14px;
          margin-top: 6px;
        }

        &.selected {
          .book-name {
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
    .shelfbook-list {
      .book-item {
        border-bottom: 1px solid #333;

        .book-title {
          color: #888;
        }

        .chapter-text {
          color: #555;
        }
      }
    }
  }

  .day {
    >>>.book-item {
      border-bottom: 1px solid #eee;
    }
  }
}
</style>
