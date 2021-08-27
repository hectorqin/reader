<template>
  <div
    class="index-wrapper"
    :class="{
      night: isNight,
      day: !isNight
    }"
  >
    <div class="navigation-wrapper">
      <div class="navigation-title">
        阅读
      </div>
      <div class="navigation-sub-title">
        清风不识字，何故乱翻书
      </div>
      <div class="search-wrapper">
        <el-input
          size="mini"
          placeholder="搜索书籍"
          v-model="search"
          class="search-input"
          @keyup.enter.native="searchBook"
        >
          <i slot="prefix" class="el-input__icon el-icon-search"></i>
        </el-input>
      </div>
      <div class="recent-wrapper">
        <div class="recent-title">
          最近阅读
        </div>
        <div class="reading-recent">
          <el-tag
            type="warning"
            :effect="isNight ? 'dark' : 'light'"
            class="recent-book"
            @click="
              toDetail(
                readingRecent.bookUrl,
                readingRecent.bookName,
                readingRecent.index
              )
            "
            :class="{ 'no-point': readingRecent.bookUrl == '' }"
          >
            {{ readingRecent.bookName }}
          </el-tag>
        </div>
      </div>
      <div class="setting-wrapper">
        <div class="setting-title">
          后端设定
        </div>
        <div class="setting-item">
          <el-tag
            :type="connectType"
            :effect="isNight ? 'dark' : 'light'"
            class="setting-connect"
            :class="{ 'no-point': newConnect }"
            @click="setIP"
          >
            {{ connectStatus }}
          </el-tag>
        </div>
      </div>
      <div class="setting-wrapper">
        <div class="setting-title">
          搜索书源
        </div>
        <div class="setting-item">
          <el-select
            size="mini"
            v-model="bookSourceUrl"
            class="setting-select"
            filterable
            placeholder="请选择搜索书源"
          >
            <el-option
              v-for="(item, index) in bookSourceList"
              :key="'source-' + index"
              :label="item.bookSourceName"
              :value="item.bookSourceUrl"
            >
            </el-option>
          </el-select>
        </div>
        <div class="setting-item">
          <el-tag
            type="info"
            :effect="isNight ? 'dark' : 'light'"
            slot="reference"
            class="setting-btn"
            @click="showManageDialog = true"
          >
            书源管理
          </el-tag>
          <el-popover
            placement="right"
            width="600"
            trigger="click"
            :visible-arrow="false"
            v-model="popExploreVisible"
            popper-class="popper-component"
          >
            <Explore
              ref="popExplore"
              class="popup"
              :popExploreVisible="popExploreVisible"
              :bookSourceUrl="bookSourceUrl"
              :bookSourceList="bookSourceList"
              @showSearchList="showSearchList"
              @close="popExploreVisible = false"
            />
            <el-tag
              type="info"
              :effect="isNight ? 'dark' : 'light'"
              slot="reference"
              class="setting-btn"
            >
              探索书源
            </el-tag>
            <!-- <div class="" slot="reference">探索书源</div> -->
          </el-popover>
          <el-tag
            type="info"
            :effect="isNight ? 'dark' : 'light'"
            slot="reference"
            class="setting-btn"
            @click="uploadBookSource"
          >
            导入书源
          </el-tag>
          <input
            ref="fileRef"
            type="file"
            @change="onBookSourceFileChange"
            style="display:none"
          />
        </div>
      </div>
      <div class="bottom-icons">
        <a href="https://github.com/hectorqin/reader" target="_blank">
          <div class="bottom-icon">
            <img
              v-if="isNight"
              :src="require('../assets/imgs/github.png')"
              alt=""
            />
            <img v-else :src="require('../assets/imgs/github2.png')" alt="" />
          </div>
        </a>
        <span
          class="theme-item"
          :style="themeColor"
          ref="themes"
          @click="toogleNight"
        >
          <i class="el-icon-moon" v-if="!isNight"></i>
          <i class="el-icon-sunny" v-else></i>
        </span>
      </div>
    </div>
    <div class="shelf-wrapper" ref="shelfWrapper">
      <div class="shelf-title">
        {{
          isSearchResult ? (isExploreResult ? "探索结果" : "搜索结果") : "书架"
        }}
        <div class="title-btn" v-if="isSearchResult" @click="backToShelf">
          返回书架
        </div>
        <div class="title-btn" v-if="isExploreResult" @click="loadMoreExplore">
          <i class="el-icon-loading" v-if="exploreLoading"></i>
          {{ exploreLoading ? "加载中..." : "加载更多" }}
        </div>
        <div class="title-btn" v-else @click="refreshShelf">
          <i class="el-icon-loading" v-if="refreshLoading"></i>
          {{ refreshLoading ? "刷新中..." : "刷新" }}
        </div>
      </div>
      <div class="books-wrapper">
        <div class="wrapper">
          <div
            class="book"
            v-for="book in shelf"
            :key="book.bookUrl"
            @click="toDetail(book.bookUrl, book.name, book.durChapterIndex)"
          >
            <div class="cover-img">
              <img class="cover" :src="getCover(book.coverUrl)" alt="" />
            </div>
            <div
              class="info"
              @click="toDetail(book.bookUrl, book.name, book.durChapterIndex)"
            >
              <div class="name">{{ book.name }}</div>
              <div class="sub">
                <div class="author">
                  {{ book.author }}
                </div>
                <div class="dot" v-if="book.totalChapterNum">•</div>
                <div class="size" v-if="book.totalChapterNum">
                  共{{ book.totalChapterNum }}章
                </div>
                <div class="dot" v-if="!isSearchResult">•</div>
                <div class="date" v-if="!isSearchResult">
                  {{ dateFormat(book.lastCheckTime) }}
                </div>
              </div>
              <div class="dur-chapter" v-if="!isSearchResult">
                已读：{{ book.durChapterTitle }}
              </div>
              <div class="last-chapter">
                最新：{{ book.latestChapterTitle }}
              </div>
              <div v-if="isSearchResult">
                <el-tag
                  type="success"
                  :effect="isNight ? 'dark' : 'light'"
                  class="setting-connect"
                  @click.prevent.capture="saveBook(book)"
                >
                  加入书架
                </el-tag>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    <el-dialog title="导入书源" :visible.sync="showImportDialog">
      <div class="source-container">
        <el-checkbox-group
          v-model="checkedSourceIndex"
          @change="handleCheckedSourcesChange"
        >
          <el-checkbox
            v-for="(source, index) in importBookSource"
            :label="index"
            :key="index"
            class="source-checkbox"
            >{{ source.bookSourceName }} {{ source.bookSourceUrl }}</el-checkbox
          >
        </el-checkbox-group>
      </div>
      <div slot="footer" class="dialog-footer">
        <el-checkbox
          :indeterminate="isIndeterminate"
          v-model="checkAll"
          @change="handleCheckAllChange"
          border
          class="float-left"
          >全选</el-checkbox
        >
        <span class="check-tip">已选择 {{ checkedSourceIndex.length }} 个</span>
        <el-button @click="showImportDialog = false">取消</el-button>
        <el-button type="primary" @click="saveBookSourceList">确定</el-button>
      </div>
    </el-dialog>
    <el-dialog title="书源管理" :visible.sync="showManageDialog">
      <div class="source-container">
        <el-table
          :data="bookSourceList"
          height="400"
          @selection-change="handleSelectionChange"
        >
          <el-table-column
            type="selection"
            width="45"
            :selectable="getSourceBook"
          >
          </el-table-column>
          <el-table-column
            property="bookSourceName"
            label="书源名称"
          ></el-table-column>
          <el-table-column
            property="bookSourceUrl"
            label="书源链接"
          ></el-table-column>
          <el-table-column label="书架书籍" width="180">
            <template slot-scope="scope">
              <pre>{{ showSourceBook(scope.row) }}</pre>
            </template>
          </el-table-column>
        </el-table>
      </div>
      <div slot="footer" class="dialog-footer">
        <el-button
          type="primary"
          class="float-left"
          @click="deleteBookSourceList"
          >批量删除</el-button
        >
        <span class="check-tip"
          >已选择 {{ manageSourceSelection.length }} 个</span
        >
        <el-button @click="showManageDialog = false">取消</el-button>
      </div>
    </el-dialog>
  </div>
</template>

<script>
import "../assets/fonts/shelffont.css";
import Explore from "../components/Explore.vue";
import Axios from "axios";

export default {
  components: {
    Explore
  },
  data() {
    return {
      search: "",
      bookSourceUrl: "",
      bookSourceList: [],
      isSearchResult: false,
      isExploreResult: false,
      searchResult: [],
      readingRecent: {
        bookName: "尚无阅读记录",
        bookUrl: "",
        index: 0
      },
      refreshLoading: false,
      popExploreVisible: false,
      exploreLoading: false,
      importBookSource: [],
      showImportDialog: false,
      checkAll: false,
      isIndeterminate: false,
      checkedSourceIndex: [],

      showManageDialog: false,
      manageSourceSelection: []
    };
  },
  watch: {
    bookSourceUrl(val) {
      localStorage.setItem("bookSourceUrl", val);
      if (this.isSearchResult && val) {
        this.searchBook();
      }
    }
  },
  mounted() {
    try {
      //获取最近阅读书籍
      let readingRecentStr = localStorage.getItem("readingRecent");
      if (readingRecentStr != null) {
        this.readingRecent = JSON.parse(readingRecentStr);
        if (typeof this.readingRecent.index == "undefined") {
          this.readingRecent.index = 0;
        }
      }
      this.bookSourceUrl = localStorage.getItem("bookSourceUrl") || "";
    } catch (error) {
      //
    }
    this.loadBookshelf()
      .then(() => {
        if (!this.bookSourceList.length) {
          // 加载书源列表
          this.loadBookSource();
        }
      })
      .catch(() => {});
  },
  methods: {
    setIP() {
      this.$prompt("请输入接口地址 ( 如：127.0.0.1:9527 )", "提示", {
        confirmButtonText: "确定",
        cancelButtonText: "取消",
        // inputPattern: /^((2[0-4]\d|25[0-5]|[1]?\d\d?)\.){3}(2[0-4]\d|25[0-5]|[1]?\d\d?):([1-9]|[1-9][0-9]|[1-9][0-9][0-9]|[1-9][0-9][0-9][0-9]|[1-6][0-5][0-5][0-3][0-5])$/,
        // inputErrorMessage: "url 形式不正确",
        beforeClose: (action, instance, done) => {
          if (action === "confirm") {
            this.$store.commit("setNewConnect", true);
            instance.confirmButtonLoading = true;
            instance.confirmButtonText = "校验中……";
            this.loadBookshelf(instance.inputValue)
              .then(() => {
                instance.confirmButtonLoading = false;
                done();
              })
              .catch(() => {
                instance.confirmButtonLoading = false;
                instance.confirmButtonText = "确定";
              });
          } else {
            done();
          }
        }
      })
        .then(({ value }) => {
          localStorage.url = value;
          this.$message({
            type: "success",
            message: "与" + value + "连接成功"
          });
        })
        .catch(() => {});
    },
    loadBookSource() {
      if (!localStorage.url) {
        this.$message.error("请先设置后端 url 与端口");
        this.$store.commit("setConnectStatus", "点击设置后端 url 与 端口");
        this.$store.commit("setNewConnect", false);
        this.$store.commit("setConnectType", "danger");
        return;
      }
      Axios.get("http://" + localStorage.url + "/getSources", {
        timeout: 3000
      }).then(
        res => {
          this.loading.close();
          if (res.data.isSuccess) {
            //
            this.bookSourceList = res.data.data;
            if (this.bookSourceList.length) {
              this.bookSourceUrl =
                this.bookSourceUrl || this.bookSourceList[0].bookSourceUrl;
            }
          } else {
            this.$message.error(res.data.errorMsg);
          }
        },
        () => {
          //
          this.loading.close();
          this.$message.error("后端连接失败");
        }
      );
    },
    searchBook() {
      if (!localStorage.url) {
        this.$message.error("请先设置后端 url 与端口");
        this.$store.commit("setConnectStatus", "点击设置后端 url 与 端口");
        this.$store.commit("setNewConnect", false);
        this.$store.commit("setConnectType", "danger");
        return;
      }
      if (!this.search) {
        this.$message.error("请输入关键词进行搜索");
        return;
      }
      this.loading = this.$loading({
        target: this.$refs.shelfWrapper,
        lock: true,
        text: "正在搜索书籍",
        spinner: "el-icon-loading",
        background: this.isNight ? "#121212" : "rgb(247,247,247)"
      });

      Axios.get("http://" + localStorage.url + "/searchBook", {
        timeout: 3000,
        params: {
          key: this.search,
          bookSourceUrl: this.bookSourceUrl
        }
      }).then(
        res => {
          this.loading.close();
          if (res.data.isSuccess) {
            //
            this.isSearchResult = true;
            this.searchResult = res.data.data;
          } else {
            this.$message.error(res.data.errorMsg);
          }
        },
        () => {
          //
          this.loading.close();
          this.$message.error("后端连接失败");
        }
      );
    },
    loadBookshelf(api, refresh) {
      api = api || localStorage.url;
      if (!api) {
        this.$message.error("请先设置后端 url 与端口");
        this.$store.commit("setConnectStatus", "点击设置后端 url 与 端口");
        this.$store.commit("setNewConnect", false);
        this.$store.commit("setConnectType", "danger");
        return Promise.reject(false);
      }

      this.loading = this.$loading({
        target: this.$refs.shelfWrapper,
        lock: true,
        text: refresh ? "正在刷新书籍信息" : "正在获取书籍信息",
        spinner: "el-icon-loading",
        background: this.isNight ? "#121212" : "rgb(247,247,247)"
      });

      return Axios.get(
        "http://" + api + "/getBookshelf?refresh=" + (refresh ? 1 : 0),
        refresh
          ? {}
          : {
              timeout: 3000
            }
      )
        .then(response => {
          if (response.data.isSuccess) {
            this.loading.close();
            this.$store.commit("setConnectType", "success");
            // this.$store.commit("increaseBookNum", response.data.data.length);
            this.$store.commit(
              "addBooks",
              response.data.data.sort(function(a, b) {
                var x = a["durChapterTime"] || 0;
                var y = b["durChapterTime"] || 0;
                return y - x;
              })
            );
            this.$store.commit(
              "setConnectStatus",
              "已连接 " + localStorage.url
            );
            this.$store.commit("setNewConnect", false);
          } else {
            this.$message.error(response.data.errorMsg);
          }
        })
        .catch(error => {
          this.loading.close();
          this.$store.commit("setConnectType", "danger");
          this.$store.commit("setConnectStatus", "点击设置后端 url 与 端口");
          this.$message.error("后端连接失败");
          this.$store.commit("setNewConnect", false);
          throw error;
        });
    },
    refreshShelf() {
      return this.loadBookshelf(null, true);
    },
    toDetail(bookUrl, bookName, chapterIndex) {
      if (this.isSearchResult) {
        // this.$message.error("请先加入书架");
        // return;
      }
      chapterIndex = chapterIndex || 0;
      sessionStorage.setItem("bookUrl", bookUrl);
      sessionStorage.setItem("bookName", bookName);
      sessionStorage.setItem("chapterIndex", chapterIndex);
      this.readingRecent = {
        bookName: bookName,
        bookUrl: bookUrl,
        index: chapterIndex
      };
      localStorage.setItem("readingRecent", JSON.stringify(this.readingRecent));
      this.$router.push({
        path: "/chapter"
      });
    },
    saveBook(book) {
      if (!localStorage.url) {
        this.$message.error("请先设置后端 url 与端口");
        this.$store.commit("setConnectStatus", "点击设置后端 url 与 端口");
        this.$store.commit("setNewConnect", false);
        this.$store.commit("setConnectType", "danger");
        return;
      }
      if (!book || !book.bookUrl || !book.origin) {
        this.$message.error("书籍信息错误");
        return;
      }
      Axios.post("http://" + localStorage.url + "/saveBook", book).then(
        res => {
          if (res.data.isSuccess) {
            //
            this.$message.success("加入书架成功");
          } else {
            this.$message.error(res.data.errorMsg);
          }
        },
        () => {
          //
          this.$message.error("后端连接失败");
        }
      );
    },
    dateFormat(t) {
      let time = new Date().getTime();
      let int = parseInt((time - t) / 1000);
      let str = "";

      Date.prototype.format = function(fmt) {
        var o = {
          "M+": this.getMonth() + 1, //月份
          "d+": this.getDate(), //日
          "h+": this.getHours(), //小时
          "m+": this.getMinutes(), //分
          "s+": this.getSeconds(), //秒
          "q+": Math.floor((this.getMonth() + 3) / 3), //季度
          S: this.getMilliseconds() //毫秒
        };
        if (/(y+)/.test(fmt)) {
          fmt = fmt.replace(
            RegExp.$1,
            (this.getFullYear() + "").substr(4 - RegExp.$1.length)
          );
        }
        for (var k in o) {
          if (new RegExp("(" + k + ")").test(fmt)) {
            fmt = fmt.replace(
              RegExp.$1,
              RegExp.$1.length == 1
                ? o[k]
                : ("00" + o[k]).substr(("" + o[k]).length)
            );
          }
        }
        return fmt;
      };

      if (int <= 30) {
        str = "刚刚";
      } else if (int < 60) {
        str = int + "秒前";
      } else if (int < 3600) {
        str = parseInt(int / 60) + "分钟前";
      } else if (int < 86400) {
        str = parseInt(int / 3600) + "小时前";
      } else if (int < 2592000) {
        str = parseInt(int / 86400) + "天前";
      } else {
        str = new Date(t).format("yyyy-MM-dd hh:mm");
      }
      return str;
    },
    getCover(coverUrl) {
      if (coverUrl) {
        return "http://" + localStorage.url + "/cover?path=" + coverUrl;
      }
      return null;
    },
    backToShelf() {
      this.isSearchResult = false;
      this.isExploreResult = false;
      this.searchResult = [];
    },
    toogleNight() {
      let config = this.config;
      if (this.isNight) {
        config.theme = 0;
      } else {
        config.theme = 6;
      }
      this.$store.commit("setConfig", config);
      localStorage.setItem("config", JSON.stringify(config));
    },
    showSearchList(data) {
      this.isSearchResult = true;
      this.isExploreResult = true;
      this.exploreLoading = false;
      this.searchResult = data;
    },
    loadMoreExplore() {
      this.exploreLoading = true;
      this.$refs.popExplore.loadMore();
    },
    uploadBookSource() {
      this.$refs.fileRef.dispatchEvent(new MouseEvent("click"));
    },
    onBookSourceFileChange(event) {
      const rawFile = event.target.files && event.target.files[0];
      this.$refs.fileRef.value = null;
      const reader = new FileReader();
      reader.onload = e => {
        const data = e.target.result;
        try {
          this.importBookSource = JSON.parse(data);
          this.showImportDialog = true;
        } catch (error) {
          this.$message.error("导入书源出错");
        }
      };
      reader.readAsText(rawFile);
    },
    handleCheckAllChange(val) {
      this.checkedSourceIndex = val
        ? this.importBookSource.map((v, i) => i)
        : [];
      this.isIndeterminate = false;
    },
    handleCheckedSourcesChange(value) {
      let checkedCount = value.length;
      this.checkAll = checkedCount === this.importBookSource.length;
      this.isIndeterminate =
        checkedCount > 0 && checkedCount < this.importBookSource.length;
    },
    saveBookSourceList() {
      if (!localStorage.url) {
        this.$message.error("请先设置后端 url 与端口");
        this.$store.commit("setConnectStatus", "点击设置后端 url 与 端口");
        this.$store.commit("setNewConnect", false);
        this.$store.commit("setConnectType", "danger");
        return;
      }
      if (!this.checkedSourceIndex.length) {
        this.$message.error("请选择需要导入的源");
        return;
      }
      const sourceList = this.checkedSourceIndex.map(
        v => this.importBookSource[v]
      );
      Axios.post(
        "http://" + localStorage.url + "/saveSources",
        sourceList
      ).then(
        res => {
          if (res.data.isSuccess) {
            //
            this.$message.success("导入书源成功");
            this.loadBookSource();
            this.showImportDialog = false;
          } else {
            this.$message.error(res.data.errorMsg);
          }
        },
        () => {
          //
          this.$message.error("后端连接失败");
        }
      );
    },
    getSourceBook(bookSource) {
      const res = [];
      (this.$store.state.shelf || []).forEach(v => {
        if (v.origin === bookSource.bookSourceUrl) {
          res.push(v.name);
        }
      });
      return !res.length;
    },
    showSourceBook(bookSource) {
      const res = [];
      (this.$store.state.shelf || []).forEach(v => {
        if (v.origin === bookSource.bookSourceUrl) {
          res.push(v.name);
        }
      });
      return res.join("\n");
    },
    handleSelectionChange(val) {
      this.manageSourceSelection = val;
    },
    deleteBookSourceList() {
      if (!this.manageSourceSelection.length) {
        this.$message.error("请选择需要导入的源");
        return;
      }
      Axios.post(
        "http://" + localStorage.url + "/deleteSources",
        this.manageSourceSelection
      ).then(
        res => {
          if (res.data.isSuccess) {
            //
            this.$message.success("删除书源成功");
            this.loadBookSource();
            this.showManageDialog = false;
          } else {
            this.$message.error(res.data.errorMsg);
          }
        },
        () => {
          //
          this.$message.error("后端连接失败");
        }
      );
    }
  },
  computed: {
    config() {
      return this.$store.state.config;
    },
    isNight() {
      return this.$store.state.config.theme == 6;
    },
    themeColor() {
      if (this.$store.state.config.theme == 6) {
        return {
          background: "#f7f7f7"
        };
      } else {
        return {
          background: "#222"
        };
      }
    },
    shelf() {
      return this.isSearchResult ? this.searchResult : this.$store.state.shelf;
    },
    connectStatus() {
      return this.$store.state.connectStatus;
    },
    connectType() {
      return this.$store.state.connectType;
    },
    newConnect() {
      return this.$store.state.newConnect;
    }
  }
};
</script>

<style lang="stylus" scoped>
.index-wrapper {
  height: 100%;
  width: 100%;
  display: flex;
  flex-direction: row;

  .navigation-wrapper {
    width: 260px;
    min-width: 260px;
    padding: 48px 36px;
    background-color: #F7F7F7;

    .navigation-title {
      font-size: 24px;
      font-weight: 500;
      font-family: FZZCYSK;
    }

    .navigation-sub-title {
      font-size: 16px;
      font-weight: 300;
      font-family: FZZCYSK;
      margin-top: 16px;
      color: #b1b1b1;
    }

    .search-wrapper {
      .search-input {
        border-radius: 50%;
        margin-top: 24px;

        >>> .el-input__inner {
          border-radius: 50px;
          border-color: #E3E3E3;
        }
      }
    }

    .recent-wrapper {
      margin-top: 36px;

      .recent-title {
        font-size: 14px;
        color: #b1b1b1;
        font-family: FZZCYSK;
      }

      .reading-recent {
        margin: 18px 0;

        .recent-book {
          font-size: 10px;
          // font-weight: 400;
          // margin: 12px 0;
          // font-weight: 500;
          // color: #6B7C87;
          cursor: pointer;
          // padding: 6px 18px;
        }
      }
    }

    .setting-wrapper {
      margin-top: 36px;

      .setting-title {
        font-size: 14px;
        color: #b1b1b1;
        font-family: FZZCYSK;
      }

      .no-point {
        pointer-events: none;
      }

      .setting-connect {
        font-size: 8px;
        // color: #6B7C87;
        cursor: pointer;
      }

      .setting-item {
        padding-top: 16px;
      }

      .setting-btn {
        margin-right: 15px;
        cursor: pointer;
      }

      .setting-select {
        width: 100%;
      }
    }

    .bottom-icons {
      position: absolute;
      bottom: 0;
      padding-bottom: 30px;
      width: 260px;
      align-items: center;
      display: flex;
      flex-direction: row;

      .bottom-icon {
        height: 36px;
        img {
          width: 36px;
          height: 36px;
        }
      }

      .theme-item {
        line-height: 32px;
        width: 36px;
        height: 36px;
        margin-right: 16px;
        border-radius: 100%;
        display: inline-block;
        cursor: pointer;
        text-align: center;
        vertical-align: middle;
        margin-left: 150px;

        .el-icon-moon {
          color: #f7f7f7;
          line-height: 34px;
        }
        .el-icon-sunny {
          color: #121212;
          line-height: 34px;
        }
      }
    }
  }

  .shelf-wrapper {
    padding: 48px 48px;
    width: 100%;
    background-color: #fff;

    .shelf-title {
      font-size: 20px;
      font-weight: 500;
      font-family: FZZCYSK;
      margin-bottom: 15px;

      .title-btn {
        font-size: 14px;
        line-height: 28px;
        float: right;
        cursor: pointer;
        user-select: none;
        margin-left: 15px;

        >>>.el-icon-loading {
          font-size: 16px;
        }
      }
    }

    >>>.el-icon-loading {
      font-size: 36px;
      color: #B5B5B5;
    }

    >>>.el-loading-text {
      font-weight: 500;
      color: #B5B5B5;
    }

    .books-wrapper {
      height: 100%;
      overflow-x: hidden;
      overflow-y: scroll;

      .wrapper {
        display: grid ;
        grid-template-columns: repeat(auto-fill, 380px);
        justify-content: space-around;
        grid-gap: 10px;

        .book {
          user-select: none;
          display: flex;
          cursor: pointer;
          margin-bottom: 18px;
          padding: 24px 24px;
          width: 360px;
          flex-direction: row;
          justify-content: space-around;

          .cover-img {
            width: 84px;
            height: 112px;

            .cover {
              width: 84px;
              height: 112px;
            }
          }

          .info {
            display: flex;
            flex-direction: column;
            justify-content: space-around;
            align-items: left;
            height: 112px;
            margin-left: 20px;
            flex: 1;

            .name {
              width: fit-content;
              font-size: 16px;
              font-weight: 700;
              color: #33373D;
            }

            .sub {
              display: flex;
              flex-direction: row;
              font-size: 12px;
              font-weight: 600;
              color: #6b6b6b;

              .dot {
                margin: 0 7px;
              }
            }

            .intro, .dur-chapter, .last-chapter {
              color: #969ba3;
              font-size: 13px;
              margin-top: 3px;
              font-weight: 500;
              word-wrap: break-word;
              overflow: hidden;
              text-overflow: ellipsis;
              display: -webkit-box;
              -webkit-box-orient: vertical;
              -webkit-line-clamp: 1;
              text-align: left;
            }
          }
        }

        .book:hover {
          background: rgba(0, 0, 0, 0.1);
          transition-duration: 0.5s;
        }
      }

      .wrapper:last-child {
        margin-right: auto;
      }
    }

    .books-wrapper::-webkit-scrollbar {
      width: 0 !important;
    }
  }
}

.night {
  >>>.navigation-wrapper {
    background-color: #121212;
    border-right: 1px solid #555;
  }
  >>>.navigation-title {
    color: #bbb;
  }
  >>>.shelf-title {
    color: #bbb;
  }
  >>>.shelf-wrapper {
    background-color: #222;
  }
  >>>.el-input__inner {
    background-color: #444;
    border: 1px solid #444 !important;
    color: #aaa;
  }
  .book .info .name {
    color: #bbb !important;
  }
  >>>.el-dialog {
    background-color: #222;
  }
  >>>.el-dialog__title {
    color: #bbb;
  }
  >>>.el-table {
    background-color: transparent;
  }

  >>.el-table__expanded-cell {
    background-color: transparent;
  }
  >>>.el-table th, >>>.el-table tr{
    background-color: #222 !important;
  }
  >>>.el-table td {
    border-bottom: 1px solid #555;
  }
  >>>.el-table th.is-leaf {
    border-bottom: 1px solid #555;
  }
  >>>.el-table--border::after {
    background-color: transparent;
  }
  >>>.el-table--group::after {
    background-color: transparent;
  }
  >>>.el-table::before {
    background-color: transparent;
  }
  >>>.el-table--enable-row-hover .el-table__body tr:hover>td {
    background-color: #333;
  }
  >>>.check-tip {
    color: #bbb;
  }
}

.source-container {
  max-height: 400px;
  overflow-y: auto;
  padding: 0 10px;

  >>>.source-checkbox {
    display: block;
    padding: 8px 0;
    width: 100%;
  }

  pre {
    margin: 0;
  }
}
.float-left {
  float: left;
}

.check-tip {
  display: inline-block;
  float: left;
  line-height: 40px;
  margin-left: 10px;
}
</style>
