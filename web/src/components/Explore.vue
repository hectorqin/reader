<template>
  <div class="cata-wrapper" :style="popupTheme">
    <div class="title-zone">
      <div class="title">书海</div>
      <div :class="{ 'title-btn': true }">
        <span class="source-count"
          >共{{ bookSourceListNew.length }}个可用书源</span
        >
      </div>
    </div>
    <div
      class="data-wrapper"
      ref="sourceList"
      :class="{ night: isNight, day: !isNight }"
    >
      <div class="cata">
        <el-collapse class="source-collapse" ref="sourceList">
          <el-collapse-item
            v-for="(source, index) in bookSourceListNew"
            :title="source.bookSourceName"
            :name="index"
            :key="'source-' + index"
            ref="source"
          >
            <el-tag
              type="info"
              :effect="isNight ? 'dark' : 'light'"
              class="explore-btn"
              v-for="(group, indexG) in source.exploreGroup"
              :key="'group-' + indexG"
              @click="exploreBookSource(group.url, source.index, 1)"
            >
              {{ group.name }}
            </el-tag>
          </el-collapse-item>
        </el-collapse>
      </div>
    </div>
  </div>
</template>

<script>
import jump from "../plugins/jump";
import config from "../plugins/config";
import Axios from "axios";
export default {
  name: "Explore",
  data() {
    return {
      isNight: this.$store.state.config.theme == 6,
      page: 1,
      ruleFindUrl: "",
      sourceIndex: -1,
      exploreList: []
    };
  },
  props: ["popExploreVisible", "bookSourceUrl", "bookSourceList"],
  computed: {
    theme() {
      return this.$store.state.config.theme;
    },
    popupTheme() {
      return {
        background: config.themes[this.theme].popup
      };
    },
    bookSourceListNew() {
      const list = [];
      this.bookSourceList.forEach((source, index) => {
        const exploreGroup = this.getExploreGroup(source);
        if (exploreGroup.length) {
          list.push({
            bookSourceName: source.bookSourceName,
            exploreGroup,
            index
          });
        }
      });
      // console.log(list);
      return list;
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
    popExploreVisible(isVisible) {
      if (isVisible) {
        //
      }
    }
  },
  methods: {
    isSelected(bookSource) {
      return bookSource.bookSourceUrl == this.bookSourceUrl;
    },
    getExploreGroup(bookSource) {
      if (!bookSource.exploreUrl) {
        return [];
      }
      const result = bookSource.exploreUrl.split("\n").map(v => {
        v = v.split("::");
        return {
          name: v[0],
          url: v[1]
        };
      });
      return result;
    },
    exploreBookSource(url, index, page) {
      this.page = page || 1;
      this.ruleFindUrl = url;
      this.sourceIndex = index;
      Axios.get("http://" + localStorage.url + `/exploreBook`, {
        params: {
          ruleFindUrl: url,
          bookSourceIndex: index,
          page
        }
      }).then(
        res => {
          if (res.data.isSuccess) {
            //
            if (page === 1) {
              this.exploreList = res.data.data;
            } else {
              this.exploreList = [].concat(this.exploreList, res.data.data);
            }
            // console.log(this.exploreList);
            this.$emit("showSearchList", this.exploreList);
          } else {
            this.$message.error(res.data.errorMsg);
          }
        },
        err => {
          throw err;
        }
      );
    },
    loadMore() {
      this.page = this.page + 1;
      this.exploreBookSource(this.ruleFindUrl, this.sourceIndex, this.page);
    },
    jumpToActive() {
      this.$nextTick(() => {
        let index = -1;
        this.bookSourceListNew.some((v, i) => {
          if (v.bookSourceUrl == this.bookSourceUrl) {
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
      margin-right: 25px;
      color: #606266;
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

      .source-collapse {
        width: 100%;
        border: none;
      }

      .explore-btn {
        margin-right: 15px;
        margin-bottom: 5px;
        cursor: pointer;
      }
    }
  }

  .data-wrapper::-webkit-scrollbar {
    width: 0 !important;
  }

  >>>.el-collapse-item__header {
    background: transparent;
    color: #606266;
  }

  >>>.el-collapse-item__wrap {
    background: transparent;
    color: #606266;
  }

  >>>.el-collapse-item__content {
    color: #606266;
    padding: 10px;
  }

  .night {
    >>>.el-collapse-item__header {
      border-bottom: 1px solid #666;
    }
    >>>.el-collapse-item__wrap {
      border-bottom: 1px solid #666;
    }
  }

  .day {
    >>>.el-collapse-item__header {
      border-bottom: 1px solid #f2f2f2;
    }
    >>>.el-collapse-item__wrap {
      border-bottom: 1px solid #f2f2f2;
    }
  }
}
</style>
