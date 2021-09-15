<template>
  <div class="popup-wrapper" :style="popupTheme">
    <div class="title-zone">
      <div class="title">书架({{ bookList.length }})</div>
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
      <div class="cata">
        <div
          class="log"
          v-for="(book, index) in bookList"
          :class="{ selected: isSelected(book) }"
          :key="index"
          @click="changeBook(book)"
          ref="book"
        >
          <div class="book-name">
            {{ book.name }}
          </div>
          <div class="chapter-text">
            {{ book.durChapterTitle }}
          </div>
          <div class="extra-text">
            {{ book.durChapterIndex + 1 }} / {{ book.totalChapterNum }}
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
  name: "BookShelf",
  data() {
    return {
      bookList: [],
      refreshLoading: false
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
      Axios.get(this.api + `/getBookshelf`, {
        params: {
          refresh: refresh ? 1 : 0
        }
      }).then(
        res => {
          this.refreshLoading = false;
          if (res.data.isSuccess) {
            this.bookList = res.data.data || [];
            if (this.bookList.length) {
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
      this.$message.info("换书成功");
      const readingBook = {
        bookName: book.name,
        bookUrl: book.bookUrl,
        index: book.durChapterIndex
      };
      this.$store.commit("setReadingBook", readingBook);
      this.$emit("close");
      this.$emit("loadCatalog");
    },
    refreshShelf() {
      if (this.refreshLoading) return;
      this.refreshLoading = true;
      this.getBookshelf(true);
    },
    jumpToActive() {
      this.$nextTick(() => {
        let index = -1;
        this.bookList.some((v, i) => {
          if (v.bookUrl == this.$store.state.readingBook.bookUrl) {
            index = i;
            return true;
          }
        });
        if (index < 0) {
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
        font: 16px / 40px PingFangSC-Regular, HelveticaNeue-Light, 'Helvetica Neue Light', 'Microsoft YaHei', sans-serif;

        .book-name {
          margin-right: 26px;
          overflow: hidden;
          white-space: nowrap;
          text-overflow: ellipsis;
          width: 25%;
        }

        .chapter-text {
          overflow: hidden;
          white-space: nowrap;
          text-overflow: ellipsis;
          flex: 1;
        }

        .extra-text {
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
