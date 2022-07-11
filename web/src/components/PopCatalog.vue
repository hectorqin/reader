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
          class="span-btn"
          v-if="book.origin === 'loc_book'"
          @click="changeRule"
        >
          修改规则
        </span>
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
          :key="note.index"
          @click="gotoChapter(note)"
          ref="cata"
        >
          <div
            :class="{
              'log-text': true,
              cached: cachedCataMap[note.index]
            }"
          >
            {{ note.title }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import jump from "../plugins/jump";
import Axios from "../plugins/axios";
import Vue from "vue";

export default {
  name: "PopCata",
  data() {
    return {
      refreshLoading: false,
      asc: true,
      cachedCataMap: {},
      tocUrl: ""
    };
  },
  props: ["visible"],
  computed: {
    book() {
      return this.$store.getters.readingBook;
    },
    index() {
      return this.$store.getters.readingBook.index;
    },
    catalog() {
      return this.$store.getters.readingBook.catalog || [];
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
    },
    tocRuleList() {
      if (!this.book || !this.book.originName) {
        return [];
      }
      if (this.book.originName.toLowerCase().endsWith(".txt")) {
        // txt
        return this.$store.state.txtTocRules;
      } else {
        // epub
        return [
          { name: "根据 Spin 获取章节，使用 Toc 补充章节名", rule: "spin+toc" },
          { name: "根据 Spin 获取章节，强制使用 Toc 章节名", rule: "spin<toc" },
          { name: "根据 Spin 获取章节", rule: "spin" },
          { name: "根据 Toc 获取章节，使用 Spin 补充章节名", rule: "toc+spin" },
          { name: "根据 Toc 获取章节，强制使用 Spin 章节名", rule: "toc<spin" },
          { name: "根据 Toc 获取章节", rule: "toc" }
        ];
      }
    }
  },
  mounted() {
    window.popcatalogComp = this;
  },
  watch: {
    visible(isVisible) {
      if (isVisible) {
        this.computeCachedCata();
        this.$nextTick(() => {
          this.jumpToCurrent();
        });
      }
    },
    catalog() {
      this.refreshLoading = false;
      this.computeCachedCata();
    },
    index() {
      this.computeCachedCata();
    },
    asc() {
      this.jumpToCurrent();
    }
  },
  methods: {
    isSelected(index) {
      if (this.asc) {
        return index == this.$store.getters.readingBook.index;
      } else {
        return (
          this.catalog.length - 1 - index ==
          this.$store.getters.readingBook.index
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
    async changeRule() {
      const res = await this.$msgbox({
        title: "修改目录规则",
        message: this.renderComp(),
        showCancelButton: true,
        confirmButtonText: "确定",
        cancelButtonText: "取消"
      }).catch(action => {
        return action === "close" ? "close" : false;
      });
      if (res === "confirm") {
        //
        if (this.tocUrl === this.book.tocUrl) {
          this.$message.error("未修改规则");
          return;
        }
        const shelfBook = this.$store.getters.shelfBooks.find(
          v => v.bookUrl === this.book.bookUrl
        );
        shelfBook.tocUrl = this.tocUrl;
        return Axios.post(this.api + "/saveBook", shelfBook).then(
          res => {
            if (res.data.isSuccess) {
              this.$message.success("操作成功");
              this.$store.commit("updateShelfBook", res.data.data);
              this.refreshLoading = true;
              this.$emit("refresh");
            }
          },
          error => {
            this.$message.error("操作失败" + (error && error.toString()));
          }
        );
      } else {
        return false;
      }
    },
    renderComp() {
      var tocRuleList = this.tocRuleList;
      this.tocUrl = this.book.tocUrl;
      var catalog = this;
      Vue.component("custComp2", {
        render() {
          window.custComp2 = this;
          return (
            <div style={{ textAlign: "center" }}>
              <span>请选择规则：</span>
              <el-select
                size="mini"
                vModel={this.selectedRule}
                filterable={true}
                placeholder="未分组"
                vOn:change={this.change}
              >
                {tocRuleList.map((rule, index) => {
                  return (
                    <el-option
                      key={"rule-" + index}
                      label={rule.name}
                      value={rule.rule}
                    ></el-option>
                  );
                })}
              </el-select>
              <el-input
                type="textarea"
                rows={3}
                style={{ marginTop: "10px" }}
                vModel={this.selectedRule}
                size="small"
                vOn:change={this.change}
              />
            </div>
          );
        },
        data() {
          return {
            selectedRule: catalog.tocUrl
          };
        },
        methods: {
          change() {
            catalog.tocUrl = this.selectedRule;
          }
        }
      });
      var custComp2 = Vue.component("custComp2");
      return this.$createElement(custComp2);
    },
    jumpToCurrent(index) {
      if (typeof index === "undefined") {
        index = this.asc
          ? this.$store.getters.readingBook.index
          : this.catalog.length - 1 - this.$store.getters.readingBook.index;
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
    },
    computeCachedCata() {
      const cacheMap = {};
      const cachePrefix =
        "localCache@" +
        this.$store.getters.readingBook.name +
        "_" +
        this.$store.getters.readingBook.author +
        "@" +
        this.$store.getters.readingBook.bookUrl +
        "@chapterContent-";
      window.$cacheStorage
        .iterate(function(value, key) {
          if (key.startsWith(cachePrefix)) {
            try {
              let index = parseInt(key.replace(cachePrefix, ""));
              cacheMap[index] = true;
            } catch (error) {
              //
              // console.error(error);
            }
          }
        })
        .then(() => {
          this.cachedCataMap = cacheMap;
        })
        .catch(function() {});
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

      .cached {
        color: #444;
      }

      .selected .log-text {
        color: #EB4259 !important;
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

    >>>.cached {
      color: #bbb !important;
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
