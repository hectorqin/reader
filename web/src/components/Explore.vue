<template>
  <div class="popup-wrapper" :style="popupTheme">
    <div class="title-zone">
      <div class="title">书海</div>
      <div :class="{ 'title-btn': true }">
        <span class="source-count">
          共{{ bookSourceListNew.length }}个可用书源
        </span>
        <i
          class="el-icon-close close-btn"
          v-if="$store.state.miniInterface"
          @click.stop="close"
        ></i>
      </div>
    </div>
    <div
      class="data-wrapper"
      ref="sourceList"
      :class="{ night: $store.getters.isNight, day: !$store.getters.isNight }"
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
            <div
              class="explore-group"
              v-for="(group, indexG) in source.exploreGroup"
              :key="'group-' + indexG"
            >
              <el-tag
                type="info"
                :effect="$store.getters.isNight ? 'dark' : 'light'"
                class="explore-btn"
                v-for="(item, indexI) in group"
                :key="'group-' + indexI"
                @click="
                  exploreBookSource(item.url, source.bookSourceUrl, 1, index)
                "
              >
                {{ item.name }}
              </el-tag>
            </div>
          </el-collapse-item>
        </el-collapse>
      </div>
    </div>
  </div>
</template>

<script>
import jump from "../plugins/jump";
import Axios from "../plugins/axios";
export default {
  name: "Explore",
  data() {
    return {
      page: 1,
      ruleFindUrl: "",
      bookSourceUrl: "",
      displayIndex: -1,
      exploreList: []
    };
  },
  props: ["visible", "bookSourceList"],
  computed: {
    theme() {
      return this.$store.state.config.theme;
    },
    popupTheme() {
      return {
        background: this.$store.getters.currentThemeConfig.popup
      };
    },
    bookSourceListNew() {
      const list = [];
      this.bookSourceList.forEach(source => {
        const exploreGroup = this.getExploreGroup(source);
        if (exploreGroup.length) {
          list.push({
            bookSourceName: source.bookSourceName,
            exploreGroup,
            bookSourceUrl: source.bookSourceUrl
          });
        }
      });
      // console.log(list);
      return list;
    }
  },
  mounted() {
    window.explorePop = this;
  },
  watch: {
    visible(isVisible) {
      if (isVisible && this.displayIndex >= 0) {
        this.$nextTick(() => {
          jump(this.$refs.source[this.displayIndex].$el, {
            container: this.$refs.sourceList,
            duration: 0
          });
        });
      }
    }
  },
  methods: {
    getExploreGroup(bookSource) {
      if (!bookSource.exploreUrl) {
        return [];
      }
      const result = [];
      let zone = [];
      bookSource.exploreUrl
        .replace(/\r\n/g, "\n")
        .split("\n")
        .forEach(v => {
          if (!v) {
            if (zone.length) {
              // 出现空行，分割为一块
              result.push(zone);
              zone = [];
            }
          } else {
            v = v.split("::");
            zone.push({
              name: v[0],
              url: v[1]
            });
          }
        });
      if (zone.length) {
        result.push(zone);
      }
      // console.log(bookSource.bookSourceName, result);
      return result;
    },
    exploreBookSource(url, sourceUrl, page, displayIndex) {
      this.page = page || 1;
      this.ruleFindUrl = url;
      this.bookSourceUrl = sourceUrl;
      this.displayIndex = displayIndex;
      Axios.get(this.api + `/exploreBook`, {
        params: {
          ruleFindUrl: url,
          bookSourceUrl: sourceUrl,
          page
        }
      }).then(
        res => {
          if (res.data.isSuccess) {
            //
            if (page === 1) {
              this.exploreList = res.data.data;
            } else {
              // this.exploreList = [].concat(this.exploreList, res.data.data);
              var data = [].concat(this.exploreList);
              var map = data.reduce((c, v) => {
                c[v.bookUrl] = v;
                return c;
              }, {});
              var length = data.length;
              res.data.data.forEach(v => {
                if (!map[v.bookUrl]) {
                  data.push(v);
                }
              });
              this.exploreList = data;
              if (data.length === length) {
                this.$message.error("没有更多啦");
              }
            }
            // console.log(this.exploreList);
            this.$emit("showSearchList", this.exploreList);
          }
        },
        error => {
          this.$message.error("探索失败 " + (error && error.toString()));
          throw error;
        }
      );
    },
    loadMore() {
      this.page = this.page + 1;
      this.exploreBookSource(
        this.ruleFindUrl,
        this.bookSourceUrl,
        this.page,
        this.displayIndex
      );
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
    },
    close() {
      this.$emit("close");
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
    .source-count {
      display: inline-block;
      margin-right: 25px;
      color: #606266;
    }
    .close-btn {
      font-size: 20px;
      vertical-align: middle;
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

      .explore-group {
        display: flex;
        justify-content: space-between;
        margin-bottom: 2px;
        padding-top: 2px;
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
    >>>.explore-group {
      border-bottom: 1px dashed #333;
    }
  }

  .day {
    >>>.el-collapse-item__header {
      border-bottom: 1px solid #EBEEF5;
    }
    >>>.el-collapse-item__wrap {
      border-bottom: 1px solid #EBEEF5;
    }
    >>>.explore-group {
      border-bottom: 1px dashed #efefef;
    }
  }
}
</style>
