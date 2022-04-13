<template>
  <div class="popup-wrapper" :style="popupTheme">
    <div class="title-zone">
      <div class="title">
        目录
        <span v-if="catalog.length">({{ catalog.length }})</span>
      </div>
      <div :class="{ 'title-btn': true }">
        <span class="span-btn" v-if="catalog.length" @click="asc = !asc">{{
          asc ? "倒序" : "顺序"
        }}</span>
        <span class="span-btn" v-if="catalog.length" @click="toTop">顶部</span>
        <span class="span-btn" v-if="catalog.length" @click="toBottom"
          >底部</span
        >
        <span
          :class="{ loading: refreshLoading, 'refresh-btn': true }"
          @click="refreshChapter"
        >
          <i class="el-icon-loading" v-if="refreshLoading"></i>
          {{ refreshLoading ? "刷新中..." : "刷新" }}
        </span>
      </div>
    </div>
    <div
      class="data-wrapper"
      ref="cataData"
      :class="{ night: $store.getters.isNight, day: !$store.getters.isNight }"
    >
      <div class="cata">
        <div
          class="log"
          v-for="(note, index) in cataList"
          :class="{ selected: isSelected(index) }"
          :key="note.durChapterIndex"
          @click="gotoChapter(note)"
          ref="cata"
        >
          <div class="log-text">
            {{ note.title }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import jump from "../plugins/jump";
export default {
  name: "PopCata",
  data() {
    return {
      refreshLoading: false,
      asc: true
    };
  },
  props: ["visible"],
  computed: {
    index() {
      return this.$store.state.readingBook.index;
    },
    catalog() {
      return this.$store.state.readingBook.catalog || [];
    },
    cataList() {
      if (this.asc) {
        return this.catalog;
      } else {
        return [].concat(this.catalog).reverse();
      }
    },
    theme() {
      return this.$store.getters.config.theme;
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
        this.$nextTick(() => {
          this.jumpToCurrent();
        });
      }
    },
    catalog() {
      this.refreshLoading = false;
    },
    asc() {
      this.jumpToCurrent();
    }
  },
  methods: {
    isSelected(index) {
      if (this.asc) {
        return index == this.$store.state.readingBook.index;
      } else {
        return (
          this.catalog.length - 1 - index == this.$store.state.readingBook.index
        );
      }
    },
    gotoChapter(note) {
      const index = this.catalog.indexOf(note);
      this.$emit("close");
      this.$emit("getContent", index);
    },
    refreshChapter() {
      this.refreshLoading = true;
      this.$emit("refresh");
    },
    jumpToCurrent(index) {
      if (typeof index === "undefined") {
        index = this.asc
          ? this.$store.state.readingBook.index
          : this.catalog.length - 1 - this.$store.state.readingBook.index;
      }
      if (!this.$refs.cata || !this.$refs.cata[index]) {
        setTimeout(() => {
          this.jumpToCurrent(index);
        }, 10);
        return;
      }
      let wrapper = this.$refs.cataData;
      jump(this.$refs.cata[index], { container: wrapper, duration: 0 });
    },
    toTop() {
      this.jumpToCurrent(0);
    },
    toBottom() {
      this.jumpToCurrent(this.catalog.length - 1);
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
    color: #606266;
    .progress-percent {
      display: inline-block;
      margin-right: 25px;
    }
    .span-btn {
      display: inline-block;
      color: #ed4259;
      margin-left: 15px;
      cursor: pointer;
    }
    .refresh-btn {
      display: inline-block;
      margin-left: 15px;
      color: #ed4259;
      cursor: pointer;
      &.loading {
        color: #606266;
      }
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
        width: 50%;
        height: 40px;
        cursor: pointer;
        float: left;
        font: 16px / 40px PingFangSC-Regular, HelveticaNeue-Light, 'Helvetica Neue Light', 'Microsoft YaHei', sans-serif;

        .log-text {
          margin-right: 26px;
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
      border-bottom: 1px solid #333;
    }
  }

  .day {
    >>>.log {
      border-bottom: 1px solid #eee;
    }
  }
}
@media screen and (max-width: 500px) {
  .popup-wrapper .data-wrapper .cata .log {
    width: 100%;

    .log-text {
      margin-right: 0;
    }
  }
}
</style>
