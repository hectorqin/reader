<template>
  <div class="cata-wrapper" :style="popupTheme">
    <div class="title-zone">
      <div class="title">
        目录
      </div>
      <div :class="{ 'title-btn': true }">
        <span class="progress-percent">
          已读{{ parseInt(((index + 1) * 100) / catalog.length) }}%
        </span>
        <span>{{ index + 1 }} / {{ catalog.length }}</span>
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
      :class="{ night: isNight, day: !isNight }"
    >
      <div class="cata">
        <div
          class="log"
          v-for="(note, index) in catalog"
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
import config from "../plugins/config";
import "../assets/fonts/popfont.css";
export default {
  name: "PopCata",
  data() {
    return {
      refreshLoading: false
    };
  },
  computed: {
    index() {
      return this.$store.state.readingBook.index;
    },
    isNight() {
      return this.$store.state.config.theme == 6;
    },
    catalog() {
      return this.$store.state.readingBook.catalog || [];
    },
    popCataVisible() {
      return this.$store.state.popCataVisible;
    },
    theme() {
      return this.$store.state.config.theme;
    },
    popupTheme() {
      return {
        background: config.themes[this.theme].popup
      };
    }
  },
  mounted() {},
  watch: {
    popCataVisible() {
      this.$nextTick(() => {
        let index = this.$store.state.readingBook.index;
        let wrapper = this.$refs.cataData;
        jump(this.$refs.cata[index], { container: wrapper, duration: 0 });
      });
    },
    catalog() {
      this.refreshLoading = false;
    }
  },
  methods: {
    isSelected(index) {
      return index == this.$store.state.readingBook.index;
    },
    gotoChapter(note) {
      const index = this.catalog.indexOf(note);
      this.$store.commit("setPopCataVisible", false);
      this.$store.commit("setContentLoading", true);
      this.$emit("getContent", index);
    },
    refreshChapter() {
      this.refreshLoading = true;
      this.$emit("refresh");
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
    color: #606266;
    .progress-percent {
      display: inline-block;
      margin-right: 25px;
    }
    .refresh-btn {
      display: inline-block;
      margin-left: 25px;
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
