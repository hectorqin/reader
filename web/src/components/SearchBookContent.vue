<template>
  <el-dialog
    :visible.sync="show"
    :width="dialogWidth"
    :top="dialogTop"
    :fullscreen="$store.state.miniInterface"
    :class="
      isWebApp && !$store.getters.isNight ? 'status-bar-light-bg-dialog' : ''
    "
    v-if="$store.getters.isNormalPage"
    :before-close="cancel"
    @opened="opend"
  >
    <div class="custom-dialog-title" slot="title">
      <span class="el-dialog__title">
        <span class="title-input">
          <el-input
            size="mini"
            placeholder="搜索书籍内容"
            v-model="keyword"
            class="search-input"
            @keyup.enter.native="searchBookContent(-1)"
          >
            <i slot="prefix" class="el-input__icon el-icon-search"></i>
          </el-input>
        </span>
      </span>
    </div>
    <div class="source-container table-container">
      <el-table
        ref="resultTable"
        :data="searchResultList"
        :height="dialogContentHeight"
        @row-click="clickRow"
      >
        <el-table-column property="chapterTitle" min-width="100px" label="章节">
        </el-table-column>
        <el-table-column
          property="resultText"
          min-width="250px"
          label="搜索结果"
        >
        </el-table-column>
      </el-table>
    </div>
    <div slot="footer" class="dialog-footer">
      <el-button
        type="primary"
        size="medium"
        class="float-left"
        :disabled="loading"
        @click="searchBookContent(lastIndex)"
        >{{ loading ? "加载中" : "加载更多" }}</el-button
      >
      <el-button
        type="primary"
        size="medium"
        class="float-left"
        v-if="lastScrollTop > 0"
        @click="restoreScrollTop"
        >跳转上次位置</el-button
      >
      <el-button size="medium" @click="cancel">取消</el-button>
    </div>
  </el-dialog>
</template>

<script>
import { mapGetters } from "vuex";
import Axios from "../plugins/axios";
import eventBus from "../plugins/eventBus";

export default {
  model: {
    prop: "show",
    event: "setShow"
  },
  name: "SearchBookContent",
  data() {
    return {
      lastScrollTop: 0,
      keyword: "",
      lastIndex: 0,
      searchResultList: [],
      loading: false
    };
  },
  computed: {
    ...mapGetters(["dialogWidth", "dialogTop", "dialogContentHeight"])
  },
  props: ["show", "book"],
  watch: {
    show(isVisible) {
      if (isVisible) {
        //
      }
    },
    book: {
      deep: true,
      handler(newVal, oldVal) {
        if (newVal.bookUrl !== oldVal.bookUrl) {
          this.keyword = "";
          this.lastIndex = -1;
          this.searchResultList = [];
        }
      }
    }
  },
  created() {
    window.searchBookComp = this;
  },
  methods: {
    formatTableField(row, column, cellValue) {
      switch (column.property) {
        default:
          return cellValue;
      }
    },
    opend() {
      this.$nextTick(() => {
        this.restoreScrollTop();
      });
    },
    restoreScrollTop() {
      if (!this.$refs.resultTable || !this.$refs.resultTable.$ready) {
        this.$nextTick(() => {
          this.restoreScrollTop();
        });
        return;
      }
      try {
        this.$refs.resultTable.bodyWrapper.scrollTop = this.lastScrollTop;
      } catch (error) {
        // console.error(error);
        setTimeout(() => {
          this.restoreScrollTop();
        }, 10);
      }
    },
    cancel() {
      this.$emit("setShow", false);
    },
    async searchBookContent(lastIndex) {
      if (this.loading) {
        return;
      }
      this.loading = true;
      Axios.post(this.api + "/searchBookContent", {
        url: this.book.bookUrl,
        keyword: this.keyword,
        lastIndex: lastIndex
      }).then(
        res => {
          this.loading = false;
          if (res.data.isSuccess) {
            this.lastIndex = res.data.data.lastIndex;
            if (lastIndex === -1) {
              this.searchResultList = res.data.data.list;
            } else {
              this.searchResultList = []
                .concat(this.searchResultList)
                .concat(res.data.data.list);
            }
          }
        },
        error => {
          this.loading = false;
          this.$message.error("加载失败 " + (error && error.toString()));
        }
      );
    },
    clickRow(row) {
      this.lastScrollTop = this.$refs.resultTable.bodyWrapper.scrollTop;
      eventBus.$emit("showSearchContent", row);
      this.cancel();
    }
  }
};
</script>
<style lang="stylus" scoped>
.float-left {
  float: left;
}
.title-input {
  display: inline-block;
  width: 75%;
  margin: 0 auto;
  transform: translateX(20%);
}
</style>
