<template>
  <div
    class="index-wrapper"
    :class="{
      night: isNight,
      day: !isNight
    }"
  >
    <div class="navigation-wrapper" :class="navigationClass">
      <div class="navigation-inner-wrapper">
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
            @keyup.enter.native="searchBook(1)"
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
              :class="{ 'no-point': connecting }"
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
              :width="popupWidth"
              trigger="click"
              :visible-arrow="false"
              v-model="popExploreVisible"
              popper-class="popper-component"
            >
              <Explore
                ref="popExplore"
                class="popup"
                :visible="popExploreVisible"
                :bookSourceUrl="bookSourceUrl"
                :bookSourceList="bookSourceList"
                @showSearchList="showSearchList"
                @close="popExploreVisible = false"
              />
              <el-tag
                type="info"
                :effect="isNight ? 'dark' : 'light'"
                slot="reference"
                ref="exploreBtn"
                class="setting-btn"
                @click="showNavigation = false"
              >
                探索书源
              </el-tag>
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
    <div
      class="shelf-wrapper"
      ref="shelfWrapper"
      @click="showNavigation = false"
    >
      <div class="shelf-title">
        <i class="el-icon-menu" v-if="showMenu" @click.stop="toggleMenu"></i>
        {{
          isSearchResult ? (isExploreResult ? "探索结果" : "搜索结果") : "书架"
        }}
        ({{ shelf.length }})
        <div class="title-btn" v-if="isSearchResult" @click="backToShelf">
          返回书架
        </div>
        <div class="title-btn" v-if="isSearchResult" @click="loadMore">
          <i class="el-icon-loading" v-if="LoadingMore"></i>
          {{ LoadingMore ? "加载中..." : "加载更多" }}
        </div>
        <div
          class="title-btn"
          v-else-if="!isSearchResult"
          @click="refreshShelf"
        >
          <i class="el-icon-loading" v-if="refreshLoading"></i>
          {{ refreshLoading ? "刷新中..." : "刷新" }}
        </div>
        <div class="title-btn" @click="showExplorePop">
          书海
        </div>
      </div>
      <div class="books-wrapper" ref="bookList">
        <div class="wrapper">
          <div
            class="book"
            :style="showNavigation ? { minWidth: '360px !important' } : {}"
            v-for="book in shelf"
            :key="book.bookUrl"
            @click="toDetail(book.bookUrl, book.name, book.durChapterIndex)"
          >
            <div class="cover-img">
              <img class="cover" v-lazy="getCover(book.coverUrl)" alt="" />
            </div>
            <div
              class="info"
              @click="toDetail(book.bookUrl, book.name, book.durChapterIndex)"
            >
              <div class="book-operation">
                <i
                  class="el-icon-info"
                  v-if="showMenu"
                  @click.stop="toggleBookIntroPop(book)"
                ></i>
                <i
                  class="el-icon-close"
                  v-if="!isSearchResult"
                  @click.stop="deleteBook(book)"
                ></i>
              </div>
              <el-popover
                :title="book.name"
                placement="top"
                width="300"
                trigger="hover"
                popper-class="popper-intro"
                v-model="popIntroVisible[book.name]"
              >
                <div class="book-intro" v-html="renderBookIntro(book)"></div>
                <div class="name" slot="reference">
                  {{ book.name }}
                </div>
              </el-popover>
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
                  @click.stop="saveBook(book)"
                >
                  加入书架
                </el-tag>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    <el-dialog
      title="导入书源"
      :visible.sync="showImportDialog"
      :width="dialogWidth"
      :top="dialogTop"
    >
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
    <el-dialog
      title="书源管理"
      :visible.sync="showManageDialog"
      :width="dialogWidth"
      :top="dialogTop"
    >
      <div class="source-container">
        <el-table
          :data="bookSourceList"
          height="400"
          @selection-change="handleSelectionChange"
        >
          <el-table-column
            type="selection"
            width="25"
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
          <el-table-column label="书架书籍">
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
import Explore from "../components/Explore.vue";
import Axios from "../plugins/axios";
import noCover from "../assets/imgs/noCover.jpeg";

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
      searchPage: 1,
      refreshLoading: false,
      popExploreVisible: false,
      LoadingMore: false,
      importBookSource: [],
      showImportDialog: false,
      checkAll: false,
      isIndeterminate: false,
      checkedSourceIndex: [],

      showManageDialog: false,
      manageSourceSelection: [],
      showNavigation: false,

      navigationClass: "",

      popIntroVisible: {},

      connecting: false,

      lastScrollTop: 0
    };
  },
  watch: {
    bookSourceUrl(val) {
      window.localStorage && window.localStorage.setItem("bookSourceUrl", val);
      if (this.isSearchResult && val) {
        this.searchBook(1);
      }
    },
    searchResult(val) {
      if (this.isSearchResult && val.length) {
        this.$nextTick(() => {
          this.$refs.bookList.scrollTop = this.lastScrollTop;
        });
      }
    },
    showMenu(val) {
      if (!val) {
        this.navigationClass = "";
      } else if (!this.showNavigation) {
        this.navigationClass = "navigation-hidden";
      }
    },
    showNavigation(val) {
      if (!val) {
        this.navigationClass = "navigation-out";
        setTimeout(() => {
          this.navigationClass = "navigation-hidden";
        }, 300);
      } else {
        this.navigationClass = "navigation-in";
      }
    },
    loginAuth(val) {
      if (val) {
        this.init();
      }
    }
  },
  mounted() {
    document.title = "阅读";
    this.bookSourceUrl =
      (window.localStorage && window.localStorage.getItem("bookSourceUrl")) ||
      "";
    this.navigationClass =
      this.showMenu && !this.showNavigation ? "navigation-hidden" : "";
    window.shelfPage = this;
    this.init();
  },
  methods: {
    init() {
      this.loadBookshelf()
        .then(() => {
          // 连接后端成功，加载自定义样式
          window.customCSSLoad ||
            window.loadLink(this.$store.getters.customCSSUrl, () => {
              window.customCSSLoad = true;
            });
          if (!this.bookSourceList.length) {
            // 加载书源列表
            this.loadBookSource();
          }
        })
        .catch(() => {});
    },
    setIP() {
      this.$prompt("请输入接口地址 ( 如：localhost:8080/reader3 )", "提示", {
        confirmButtonText: "确定",
        cancelButtonText: "取消",
        // inputPattern: /^((2[0-4]\d|25[0-5]|[1]?\d\d?)\.){3}(2[0-4]\d|25[0-5]|[1]?\d\d?):([1-9]|[1-9][0-9]|[1-9][0-9][0-9]|[1-9][0-9][0-9][0-9]|[1-6][0-5][0-5][0-3][0-5])$/,
        // inputErrorMessage: "url 形式不正确",
        beforeClose: (action, instance, done) => {
          if (action === "confirm") {
            this.connecting = true;
            instance.confirmButtonLoading = true;
            instance.confirmButtonText = "校验中……";
            var inputUrl = instance.inputValue.replace(/\/*$/g, "");
            this.loadBookshelf(inputUrl)
              .then(() => {
                this.connecting = false;
                instance.confirmButtonLoading = false;
                done();
                window.localStorage &&
                  window.localStorage.setItem("api_prefix", inputUrl);
                this.$store.commit("setApi", inputUrl);
                if (!this.bookSourceList.length) {
                  // 加载书源列表
                  this.loadBookSource();
                }
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
          this.$message({
            type: "success",
            message: "与" + value + "连接成功"
          });
        })
        .catch(() => {});
    },
    loadBookSource() {
      if (!this.api) {
        this.$message.error("请先设置后端接口地址");
        this.$store.commit("setConnected", false);
        return;
      }
      Axios.get(this.api + "/getSources", {
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
          }
        },
        () => {
          //
          this.loading.close();
          this.$message.error("后端连接失败");
        }
      );
    },
    searchBook(page) {
      if (!this.api) {
        this.$message.error("请先设置后端接口地址");
        this.$store.commit("setConnected", false);
        return;
      }
      if (page) {
        this.searchPage = page;
      }
      page = this.searchPage;
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

      Axios.get(this.api + "/searchBook", {
        timeout: 30000,
        params: {
          key: this.search,
          bookSourceUrl: this.bookSourceUrl,
          page: page
        }
      }).then(
        res => {
          this.loading.close();
          this.LoadingMore = false;
          if (res.data.isSuccess) {
            //
            this.isSearchResult = true;
            if (page === 1) {
              this.searchResult = res.data.data;
            } else {
              var data = [].concat(this.searchResult);
              var length = data.length;
              res.data.data.forEach(v => {
                if (!this.searchResultMap[v.bookUrl]) {
                  data.push(v);
                }
              });
              this.searchResult = data;
              if (data.length === length) {
                this.$message.error("没有更多啦");
              }
            }
          } else {
            this.$message.error(res.data.errorMsg);
          }
        },
        res => {
          //
          this.loading.close();
          this.$message.error(
            ((res || {}).data || {}).errorMsg || "后端连接失败"
          );
        }
      );
    },
    loadBookshelf(api, refresh) {
      api = api || this.api;
      if (!api) {
        this.$message.error("请先设置后端接口地址");
        this.$store.commit("setConnected", false);
        return Promise.reject(false);
      }

      this.loading = this.$loading({
        target: this.$refs.shelfWrapper,
        lock: true,
        text: refresh ? "正在刷新书籍信息" : "正在获取书籍信息",
        spinner: "el-icon-loading",
        background: this.isNight ? "#121212" : "rgb(247,247,247)"
      });

      if (
        !api.startsWith("http://") &&
        !api.startsWith("https://") &&
        !api.startsWith("//")
      ) {
        api = "//" + api;
      }

      return Axios.get(
        api + "/getBookshelf?refresh=" + (refresh ? 1 : 0),
        refresh
          ? {}
          : {
              timeout: 3000
            }
      )
        .then(response => {
          this.loading.close();
          this.$store.commit("setConnected", true);
          if (response.data.isSuccess) {
            // this.$store.commit("increaseBookNum", response.data.data.length);
            this.popIntroVisible = response.data.data.reduce((c, v) => {
              c[v.name] = false;
              return c;
            }, {});
            this.$store.commit(
              "setShelfBooks",
              response.data.data.sort(function(a, b) {
                var x = a["durChapterTime"] || 0;
                var y = b["durChapterTime"] || 0;
                return y - x;
              })
            );
          }
        })
        .catch(error => {
          this.loading.close();
          this.$store.commit("setConnected", false);
          this.$message.error("后端连接失败 " + (error && error.toString()));
          throw error;
        });
    },
    refreshShelf() {
      return this.loadBookshelf(null, true);
    },
    toDetail(bookUrl, bookName, chapterIndex) {
      if (!bookUrl) {
        return;
      }
      if (this.isSearchResult) {
        // this.$message.error("请先加入书架");
        // return;
      }
      this.$store.commit("setReadingBook", {
        bookName: bookName,
        bookUrl: bookUrl,
        index: chapterIndex || 0
      });
      this.$router.push({
        path: "/reader"
      });
    },
    saveBook(book) {
      if (!this.api) {
        this.$message.error("请先设置后端接口地址");
        this.$store.commit("setConnected", false);
        return;
      }
      if (!book || !book.bookUrl || !book.origin) {
        this.$message.error("书籍信息错误");
        return;
      }
      Axios.post(this.api + "/saveBook", book).then(
        res => {
          if (res.data.isSuccess) {
            //
            this.$message.success("加入书架成功");
            this.loadBookshelf();
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
    async deleteBook(book) {
      if (!this.api) {
        this.$message.error("请先设置后端接口地址");
        this.$store.commit("setConnected", false);
        return;
      }
      if (!book || !book.name || !book.bookUrl || !book.origin) {
        this.$message.error("书籍信息错误");
        return;
      }
      const res = await this.$confirm(
        "此操作将删除书籍信息以及阅读进度, 是否继续?",
        "提示",
        {
          confirmButtonText: "确定",
          cancelButtonText: "取消",
          type: "warning"
        }
      ).catch(() => {
        return false;
      });
      if (!res) {
        return;
      }
      Axios.post(this.api + "/deleteBook", book).then(
        res => {
          if (res.data.isSuccess) {
            //
            this.$message.success("删除成功");
            this.loadBookshelf();
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
        return this.api + "/cover?path=" + coverUrl;
      }
      return noCover;
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
    },
    showSearchList(data) {
      this.isSearchResult = true;
      this.isExploreResult = true;
      this.LoadingMore = false;
      this.searchResult = data;
    },
    loadMore() {
      this.lastScrollTop = this.$refs.bookList.scrollTop;
      this.LoadingMore = true;
      if (this.isExploreResult) {
        this.$refs.popExplore.loadMore();
      } else {
        this.searchBook(this.searchPage + 1);
      }
    },
    uploadBookSource() {
      this.$refs.fileRef.dispatchEvent(new MouseEvent("click"));
    },
    onBookSourceFileChange(event) {
      const rawFile = event.target.files && event.target.files[0];
      // console.log("rawFile", rawFile);
      const reader = new FileReader();
      reader.onload = e => {
        const data = e.target.result;
        try {
          this.importBookSource = JSON.parse(data);
          this.showImportDialog = true;
        } catch (error) {
          this.$message.error("书源文件错误");
        }
      };
      reader.onerror = () => {
        // console.log("FileReader error", e);
        // FileReader 读取出错，只能上传读取了
        let param = new FormData();
        param.append("file", rawFile);
        Axios.post(this.api + "/readSourceFile", param, {
          headers: { "Content-Type": "multipart/form-data" }
        }).then(
          res => {
            if (res.data.isSuccess) {
              //
              let sourceList = [];
              res.data.data.forEach(v => {
                try {
                  const data = JSON.parse(v);
                  if (Array.isArray(data)) {
                    sourceList = sourceList.concat(data);
                  }
                } catch (error) {
                  //
                }
              });
              if (sourceList.length) {
                this.importBookSource = sourceList;
                this.showImportDialog = true;
              } else {
                this.$message.error("书源文件错误");
              }
            } else {
              this.$message.error(res.data.errorMsg);
            }
          },
          () => {
            //
            this.$message.error("后端连接失败");
          }
        );
      };
      reader.readAsText(rawFile);
      this.$refs.fileRef.value = null;
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
      if (!this.api) {
        this.$message.error("请先设置后端接口地址");
        this.$store.commit("setConnected", false);
        return;
      }
      if (!this.checkedSourceIndex.length) {
        this.$message.error("请选择需要导入的源");
        return;
      }
      const sourceList = this.checkedSourceIndex.map(
        v => this.importBookSource[v]
      );
      Axios.post(this.api + "/saveSources", sourceList).then(
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
      (this.$store.state.shelfBooks || []).forEach(v => {
        if (v.origin === bookSource.bookSourceUrl) {
          res.push(v.name);
        }
      });
      return !res.length;
    },
    showSourceBook(bookSource) {
      const res = [];
      (this.$store.state.shelfBooks || []).forEach(v => {
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
      Axios.post(this.api + "/deleteSources", this.manageSourceSelection).then(
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
    },
    toggleMenu() {
      if (this.showMenu) {
        this.showNavigation = !this.showNavigation;
      }
    },
    showExplorePop() {
      setTimeout(() => {
        this.popExploreVisible = true;
      }, 100);
    },
    renderBookIntro(book) {
      const intro = (book.intro || "暂无简介").split("\n");
      return intro
        .map(v => {
          return `<p>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;${v.replace(
            /^\s+/g,
            ""
          )}</p>`;
        })
        .join("");
    },
    toggleBookIntroPop(book) {
      setTimeout(() => {
        for (const i in this.popIntroVisible) {
          if (Object.hasOwnProperty.call(this.popIntroVisible, i)) {
            if (i !== book.name) {
              this.popIntroVisible[i] = false;
            }
          }
        }
        this.popIntroVisible[book.name] = !this.popIntroVisible[book.name];
      }, 100);
    }
  },
  computed: {
    config() {
      return this.$store.state.config;
    },
    isNight() {
      return this.$store.getters.isNight;
    },
    themeColor() {
      if (this.$store.getters.isNight) {
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
      return this.isSearchResult
        ? this.searchResult
        : this.$store.state.shelfBooks;
    },
    searchResultMap() {
      return this.searchResult.reduce((c, v) => {
        c[v.bookUrl] = v;
        return c;
      }, {});
    },
    connectStatus() {
      return this.$store.state.connected
        ? `已连接` + this.api
        : this.connecting
        ? "正在连接后端服务器……"
        : "点击设置后端接口前缀";
    },
    connectType() {
      return this.$store.state.connected ? "success" : "danger";
    },
    showMenu() {
      return this.$store.state.miniInterface;
    },
    dialogWidth() {
      return this.showMenu ? "85%" : "50%";
    },
    dialogTop() {
      return this.showMenu ? "5vh" : "15vh";
    },
    popupWidth() {
      return this.showMenu ? this.$store.state.windowSize.width : "600";
    },
    readingRecent() {
      return this.$store.state.readingBook &&
        this.$store.state.readingBook.bookName
        ? this.$store.state.readingBook
        : {
            bookName: "尚无阅读记录",
            bookUrl: "",
            index: 0
          };
    },
    loginAuth() {
      return this.$store.state.loginAuth;
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
    height: 100vh;
    box-sizing: border-box;
    background-color: #F7F7F7;
    position: relative;

    .navigation-inner-wrapper {
      padding: 48px 36px 66px 36px;
      height: 100vh;
      max-height: 100vh;
      overflow-y: auto;
      box-sizing: border-box;
    }

    .navigation-title {
      font-size: 24px;
      font-weight: 600;
      font-family: -apple-system, "Noto Sans", "Helvetica Neue", Helvetica, "Nimbus Sans L", Arial, "Liberation Sans", "PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC", "Source Han Sans SC", "Source Han Sans CN", "Microsoft YaHei", "Wenquanyi Micro Hei", "WenQuanYi Zen Hei", "ST Heiti", SimHei, "WenQuanYi Zen Hei Sharp", sans-serif;
    }

    .navigation-sub-title {
      font-size: 16px;
      font-weight: 500;
      font-family: -apple-system, "Noto Sans", "Helvetica Neue", Helvetica, "Nimbus Sans L", Arial, "Liberation Sans", "PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC", "Source Han Sans SC", "Source Han Sans CN", "Microsoft YaHei", "Wenquanyi Micro Hei", "WenQuanYi Zen Hei", "ST Heiti", SimHei, "WenQuanYi Zen Hei Sharp", sans-serif;
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
        font-family: -apple-system, "Noto Sans", "Helvetica Neue", Helvetica, "Nimbus Sans L", Arial, "Liberation Sans", "PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC", "Source Han Sans SC", "Source Han Sans CN", "Microsoft YaHei", "Wenquanyi Micro Hei", "WenQuanYi Zen Hei", "ST Heiti", SimHei, "WenQuanYi Zen Hei Sharp", sans-serif;
      }

      .reading-recent {
        margin: 18px 0;

        .recent-book {
          cursor: pointer;
          max-width: 100%;
          overflow: hidden;
          text-overflow: ellipsis;
        }
      }
    }

    .setting-wrapper {
      margin-top: 36px;

      .setting-title {
        font-size: 14px;
        color: #b1b1b1;
        font-family: -apple-system, "Noto Sans", "Helvetica Neue", Helvetica, "Nimbus Sans L", Arial, "Liberation Sans", "PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC", "Source Han Sans SC", "Source Han Sans CN", "Microsoft YaHei", "Wenquanyi Micro Hei", "WenQuanYi Zen Hei", "ST Heiti", SimHei, "WenQuanYi Zen Hei Sharp", sans-serif;
      }

      .no-point {
        pointer-events: none;
      }

      .setting-connect {
        cursor: pointer;
        max-width: 100%;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .setting-item {
        padding-top: 16px;
      }

      .setting-btn {
        margin-right: 15px;
        margin-bottom: 15px;
        cursor: pointer;
      }

      .setting-select {
        width: 100%;
      }
    }

    .bottom-icons {
      position: absolute;
      bottom: 30px;
      width: 188px;
      left: 36px;
      align-items: center;
      display: flex;
      flex-direction: row;
      justify-content: space-between;
      pointer-events: none;

      .bottom-icon {
        height: 36px;
        pointer-events: all;
        img {
          width: 36px;
          height: 36px;
        }
      }

      .theme-item {
        line-height: 32px;
        width: 36px;
        height: 36px;
        border-radius: 100%;
        display: inline-block;
        cursor: pointer;
        text-align: center;
        vertical-align: middle;
        pointer-events: all;

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
    display: flex;
    flex-direction: column;

    .shelf-title {
      font-size: 20px;
      font-weight: 600;
      font-family: -apple-system, "Noto Sans", "Helvetica Neue", Helvetica, "Nimbus Sans L", Arial, "Liberation Sans", "PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC", "Source Han Sans SC", "Source Han Sans CN", "Microsoft YaHei", "Wenquanyi Micro Hei", "WenQuanYi Zen Hei", "ST Heiti", SimHei, "WenQuanYi Zen Hei Sharp", sans-serif;
      margin-bottom: 15px;

      .el-icon-menu {
        cursor: pointer;
      }

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
      flex: 1;
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
            position: relative;
            display: flex;
            flex-direction: column;
            justify-content: space-around;
            align-items: left;
            height: 112px;
            margin-left: 20px;
            flex: 1;

            .book-operation {
              position: absolute;
              right: 5px;
              top: 5px;
              font-size: 24px;
              color: #969ba3;

              i {
                margin-left: 10px;
              }
            }

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
              color: #969ba3;

              .dot {
                margin: 0 7px;
              }
            }

            .intro, .dur-chapter, .last-chapter {
              color: #6b6b6b;
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
  .book .info .book-operation {
    color: #6b6b6b !important;
  }
  .book .info .sub {
    color: #6b6b6b !important;
  }
  .book .info .intro, .book .info .dur-chapter, .book .info .last-chapter {
    color: #969ba3 !important;
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
  >>>.el-table {
    background-color: transparent;
  }
  >>>.el-table--enable-row-hover .el-table__body tr:hover>td {
    background-color: #333;
  }
  >>>.check-tip {
    color: #bbb;
  }

  >>> .el-table__body-wrapper::-webkit-scrollbar {
    background-color: #333 !important;
  }

  >>> .el-dialog__wrapper::-webkit-scrollbar {
    background-color: #333 !important;
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

.source-container::-webkit-scrollbar {
  width: 0 !important;
}
.navigation-inner-wrapper::-webkit-scrollbar {
  width: 0 !important;
}
>>> .el-table__body-wrapper::-webkit-scrollbar {
  width: 0 !important;
}
>>> .el-dialog__wrapper::-webkit-scrollbar {
  width: 0 !important;
}
@media screen and (max-width: 750px) {
  .index-wrapper {
    overflow-x: hidden;

    >>>.navigation-wrapper {
      .navigation-inner-wrapper {
        padding: 20px 36px 66px 36px;
      }
    }
    >>>.shelf-wrapper {
      padding: 0;

      .shelf-title {
        padding: 20px 24px 0 24px;
      }

      .books-wrapper {
        .wrapper {
          display: flex;
          flex-direction: column;

          .book {
            box-sizing: border-box;
            width: 100%;
            margin-bottom: 0;
            padding: 10px 20px;
          }
        }
      }
    }
  }
}
</style>
<style>
.navigation-hidden {
  margin-left: -260px;
}
.navigation-in {
  margin-left: 0px;
  transition: margin-left 0.3s;
}
.navigation-out {
  margin-left: -260px;
  transition: margin-left 0.3s;
}
.popper-intro {
  padding: 15px;
}
.book-intro {
  line-height: 1.6;
}
.night-theme .popper-intro {
  background: #121212;
  color: #bbb !important;
  border: none;
}
.night-theme .popper-intro.el-popper[x-placement^="bottom"] .popper__arrow,
.night-theme
  .popper-intro.el-popper[x-placement^="bottom"]
  .popper__arrow::after {
  border-bottom-color: #121212 !important;
}
.night-theme .popper-intro.el-popper[x-placement^="top"] .popper__arrow,
.night-theme .popper-intro.el-popper[x-placement^="top"] .popper__arrow::after {
  border-top-color: #121212 !important;
}
.night-theme .el-popover__title {
  color: #ddd !important;
}
</style>
