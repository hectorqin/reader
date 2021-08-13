<template>
  <div class="cata-wrapper" :style="popupTheme">
    <div class="title">
      目录
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
      isNight: this.$store.state.config.theme == 6,
      index: this.$store.state.readingBook.index
    };
  },
  computed: {
    catalog() {
      return this.$store.state.readingBook.catalog;
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
    theme(theme) {
      if (theme == 6) {
        this.isNight = true;
      } else {
        this.isNight = false;
      }
    },
    popCataVisible() {
      this.$nextTick(() => {
        let index = this.$store.state.readingBook.index;
        let wrapper = this.$refs.cataData;
        jump(this.$refs.cata[index], { container: wrapper, duration: 0 });
      });
    }
  },
  methods: {
    isSelected(index) {
      return index == this.$store.state.readingBook.index;
    },
    gotoChapter(note) {
      this.index = this.catalog.indexOf(note);
      this.$store.commit("setPopCataVisible", false);
      this.$store.commit("setContentLoading", true);
      this.$emit("getContent", this.index);
    }
  }
};
</script>

<style lang="stylus" scoped>
.cata-wrapper {
  margin: -16px;
  padding: 18px 0 24px 25px;

  // background: #ede7da url('../assets/imgs/themes/popup_1.png') repeat;
  .title {
    font-size: 18px;
    font-weight: 400;
    font-family: FZZCYSK;
    margin: 0 0 20px 0;
    color: #ed4259;
    width: fit-content;
    border-bottom: 1px solid #ed4259;
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
